#!/usr/bin/env python3
"""
Decay Derby — CSP Screener (Phase 2)
=====================================
Generates daily cash-secured put candidates for the $10K wheel strategy.

Pipeline:
  Stage 1 — TradingView broad sweep (price $10-30, options volume)
  Stage 2 — Technical filter (RSI, ADX, ATR squeeze scoring)
  Stage 3 — yfinance options chain deep dive (strike, premium, ROC)
  Stage 4 — Liquidity check (volume, OI, bid-ask)
  Stage 5 — Sector classification + allocation guard
  Output  — docs/data/daily/YYYY-MM-DD.json + docs/data/latest.json

Scoring (max 20 pts):
  ADX Strength:      0-4 pts  (15+ trending)
  RSI Oversold:      0-3 pts  (< 30 to < 40)
  ATR Squeeze:       0-3 pts  (coiled vol)
  Relative Volume:   0-2 pts  (elevated interest)
  Premium Quality:   0-4 pts  (ROC 2%+/wk)
  Liquidity:         0-2 pts  (OI, spread)
  Sector Diversity:  0-2 pts  (not already heavy in portfolio)

Usage:
    python screener/csp_scanner.py                  # today
    python screener/csp_scanner.py --date 2026-04-21
    python screener/csp_scanner.py --dry-run        # no file write
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

# ─── path setup ───────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
DOCS_DATA = PROJECT_ROOT / "docs" / "data" / "daily"
DOCS_LATEST = PROJECT_ROOT / "docs" / "data" / "latest.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("csp_scanner")

# ─── config ───────────────────────────────────────────────────────────────────
STARTING_CAPITAL = 10_000
MIN_PRICE = 9.50   # slightly below $10 so near-boundary stocks (e.g. ONDS) don't drop out
MAX_PRICE = 30.0
MIN_ALLOC = 0.10   # 10% of portfolio
MAX_ALLOC = 0.30   # 30% of portfolio
MIN_WEEKLY_ROC = 1.5   # % minimum weekly return on collateral
TARGET_DTE_MIN = 3
TARGET_DTE_MAX = 14    # 1-2 week expiries (theta burn)
MIN_DELTA_ABS = 0.05   # at least .05 delta (not OTM trash)
MAX_DELTA_ABS = 0.40   # not too close to ATM
MAX_RESULTS = 14       # picks per day

# ─── sector map (matches JS portfolio.js) ─────────────────────────────────────
SECTOR_MAP = {
    "Technology": "Electronic Technology",
    "Consumer Cyclical": "Retail Trade",
    "Consumer Defensive": "Retail Trade",
    "Financial Services": "Finance",
    "Healthcare": "Health Technology",
    "Energy": "Energy Minerals",
    "Basic Materials": "Non-Energy Minerals",
    "Communication Services": "Communications",
    "Industrials": "Producer Manufacturing",
    "Real Estate": "Finance",
    "Utilities": "Producer Manufacturing",
}

# ─── TradingView universe ──────────────────────────────────────────────────────
# Candidate pool for CSP screening. These are stocks that have historically
# appeared on TDPro CSP/Wheel screener in the $10-30 range.
# The GitHub Action can expand this list over time.
UNIVERSE = [
    # Biotech / Health (high IV, good premium)
    "SIGA", "ONDS", "ACHR", "JOBY", "RKLB", "LUNR",
    # Speculative tech (volatile, good wheel candidates)
    "IONQ", "QUBT", "RGTI", "QBTS", "ARQQ",
    # EV / clean energy
    "BLNK", "CHPT", "PSNY",
    # Miners / metals
    "EXK", "HL",
    # Finance / REIT
    "GPMT", "RITM", "ACRE", "TPVG",
    # Retail / consumer
    "TLRY", "CGC", "ACB",
    # Defense / industrial
    "KTOS", "AVAV", "ATRO", "SPCE",
    # Additional high-IV candidates
    "CLOV", "OPEN", "UWMC",
    "HOOD", "SOFI", "LCID",
    "OUST", "LIDR",
    "PAYO", "BITF", "HUT", "MARA", "RIOT",
    "CLSK", "BTBT", "CIFR", "SOS",
    "CPRX", "ACMR", "VNET", "RCON",
]
# Deduplicate
UNIVERSE = list(dict.fromkeys(UNIVERSE))


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Price filter (fast yfinance batch)
# ─────────────────────────────────────────────────────────────────────────────

def stage1_price_filter(tickers: list[str]) -> list[dict]:
    """Fetch current prices + basic info. Keep only $10-30 range."""
    import yfinance as yf

    log.info("Stage 1: Price filter — %d tickers", len(tickers))
    results = []

    # Batch download for speed
    batch_size = 20
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        try:
            data = yf.download(
                " ".join(batch),
                period="5d",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )

            for ticker in batch:
                try:
                    if len(batch) == 1:
                        close_series = data["Close"]
                    else:
                        close_series = data[ticker]["Close"]

                    price = float(close_series.dropna().iloc[-1])

                    if MIN_PRICE <= price <= MAX_PRICE:
                        # Quick volume check from last 5 days
                        if len(batch) == 1:
                            vol_series = data["Volume"]
                        else:
                            vol_series = data[ticker]["Volume"]
                        avg_vol = float(vol_series.dropna().mean())

                        results.append({
                            "symbol": ticker,
                            "price": round(price, 2),
                            "avg_vol": int(avg_vol),
                            "close_series": close_series.dropna().tolist(),
                        })
                        log.debug("  ✓ %s @ $%.2f", ticker, price)
                    else:
                        log.debug("  ✗ %s @ $%.2f (out of range)", ticker, price)

                except (KeyError, IndexError, ValueError) as e:
                    log.debug("  ✗ %s: %s", ticker, e)
                    continue

        except Exception as e:
            log.warning("  Batch %d-%d failed: %s", i, i + batch_size, e)

        time.sleep(0.3)  # rate limit courtesy

    log.info("  → %d in price range", len(results))
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Technical scoring
# ─────────────────────────────────────────────────────────────────────────────

def _rsi(closes: list[float], period: int = 14) -> float:
    """Pure-Python RSI."""
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(0.0, d))
        losses.append(max(0.0, -d))
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        ag = (ag * (period - 1) + gains[i]) / period
        al = (al * (period - 1) + losses[i]) / period
    return round(100 - (100 / (1 + ag / al))) if al > 0 else 100.0


def _atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    """ATR as % of price."""
    if len(highs) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(highs)):
        trs.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))
    atr_abs = sum(trs[-period:]) / period
    return round(atr_abs / closes[-1] * 100, 2) if closes[-1] > 0 else 0.0


def stage2_technical_score(candidates: list[dict]) -> list[dict]:
    """Fetch OHLCV history and score each candidate."""
    import yfinance as yf

    log.info("Stage 2: Technical scoring — %d candidates", len(candidates))
    scored = []

    for c in candidates:
        ticker = c["symbol"]
        try:
            tk = yf.Ticker(ticker)
            hist = tk.history(period="60d", interval="1d", auto_adjust=True)
            if hist.empty or len(hist) < 20:
                log.debug("  ✗ %s: insufficient history", ticker)
                continue

            closes = hist["Close"].tolist()
            highs = hist["High"].tolist()
            lows = hist["Low"].tolist()
            volumes = hist["Volume"].tolist()

            rsi_val = _rsi(closes)
            atr_pct = _atr(highs, lows, closes)

            # Relative volume (last bar vs 20-day avg)
            rel_vol = round(volumes[-1] / (sum(volumes[-20:]) / 20), 2) if volumes else 1.0

            # Score: tuned for CSP (we WANT oversold, high ATR, not trending hard)
            score = 0
            reasons = []

            # RSI: oversold = good for put selling (stock oversold, bounce likely)
            if rsi_val < 30:
                score += 3; reasons.append(f"RSI {rsi_val} (deeply oversold)")
            elif rsi_val < 40:
                score += 2; reasons.append(f"RSI {rsi_val} (oversold)")
            elif rsi_val < 50:
                score += 1; reasons.append(f"RSI {rsi_val} (below midline)")

            # ATR: high ATR = elevated IV = better premium
            if atr_pct > 5.0:
                score += 3; reasons.append(f"ATR {atr_pct}% (very high vol)")
            elif atr_pct > 3.5:
                score += 2; reasons.append(f"ATR {atr_pct}% (elevated vol)")
            elif atr_pct > 2.0:
                score += 1; reasons.append(f"ATR {atr_pct}% (moderate vol)")

            # Relative volume
            if rel_vol >= 1.5:
                score += 2; reasons.append(f"RelVol {rel_vol}x (elevated)")
            elif rel_vol >= 1.0:
                score += 1; reasons.append(f"RelVol {rel_vol}x (normal)")

            scored.append({
                **c,
                "rsi": rsi_val,
                "atr_pct": atr_pct,
                "rel_vol": rel_vol,
                "tech_score": score,
                "reasons": reasons,
            })
            log.debug("  ✓ %s score=%d rsi=%.1f atr=%.1f%%", ticker, score, rsi_val, atr_pct)

        except Exception as e:
            log.debug("  ✗ %s: %s", ticker, e)

        time.sleep(0.2)

    # Sort by tech score descending, take top 25 for options dive
    scored.sort(key=lambda x: x["tech_score"], reverse=True)
    log.info("  → %d scored, taking top 25 for options dive", len(scored))
    return scored[:25]


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Options chain deep dive
# ─────────────────────────────────────────────────────────────────────────────

def _find_best_put(chain_df, spot: float, target_delta_max: float = MAX_DELTA_ABS) -> dict | None:
    """Find the best CSP strike: highest premium with delta < target."""
    import pandas as pd

    if chain_df is None or chain_df.empty:
        return None

    puts = chain_df.copy()
    if "contractType" in puts.columns:
        puts = puts[puts["contractType"] == "put"]

    # yfinance options chain columns: strike, lastPrice, bid, ask, volume, openInterest, impliedVolatility
    puts = puts.dropna(subset=["bid", "ask", "strike"])
    puts = puts[puts["strike"] < spot * 1.02]  # only OTM/ATM puts
    puts = puts[puts["strike"] >= spot * 0.70]  # not too far OTM

    if puts.empty:
        return None

    # Estimate delta via Black-Scholes approximation (N(-d1) for put)
    # Using IV from chain + simple moneyness proxy
    best = None
    best_premium = -1

    for _, row in puts.iterrows():
        strike = float(row["strike"])
        bid = float(row.get("bid", 0))
        ask = float(row.get("ask", 0))
        try:
            oi_raw = row.get("openInterest", 0)
            oi = int(oi_raw) if oi_raw is not None and not (isinstance(oi_raw, float) and math.isnan(oi_raw)) else 0
        except (ValueError, TypeError):
            oi = 0
        try:
            vol_raw = row.get("volume", 0)
            vol = int(vol_raw) if vol_raw is not None and not (isinstance(vol_raw, float) and math.isnan(vol_raw)) else 0
        except (ValueError, TypeError):
            vol = 0
        iv = float(row.get("impliedVolatility", 0))

        if bid <= 0 or ask <= 0:
            continue

        mid = round((bid + ask) / 2, 2)
        spread = round(ask - bid, 2)
        spread_pct = spread / mid if mid > 0 else 999

        # Liquidity gate
        liquidity_ok = not (vol < 10 and oi < 100)
        liquidity_warn = not liquidity_ok or spread_pct > 0.30

        # Simple delta proxy: use moneyness
        moneyness = strike / spot
        # Put delta approximation: deeper OTM = lower abs delta
        delta_proxy = round((1 - moneyness) * 2.5, 2) if moneyness < 1 else 0.5
        delta_proxy = min(0.5, max(0.02, delta_proxy))

        if delta_proxy > target_delta_max:
            continue  # too close to ATM (high assignment risk)
        if delta_proxy < MIN_DELTA_ABS:
            continue  # too far OTM (trash premium)

        if mid > best_premium:
            best_premium = mid
            best = {
                "strike": strike,
                "premium": mid,
                "bid": bid,
                "ask": ask,
                "spread": spread,
                "volume": vol,
                "open_interest": oi,
                "iv": round(iv * 100, 1),
                "delta": -round(delta_proxy, 2),  # puts have negative delta
                "liquidity_warn": liquidity_warn,
            }

    return best


def stage3_options_dive(candidates: list[dict], target_date: date) -> list[dict]:
    """Fetch options chains and find best CSP strike/premium for each."""
    import yfinance as yf

    log.info("Stage 3: Options dive — %d candidates", len(candidates))
    results = []
    today = date.today()

    for c in candidates:
        ticker = c["symbol"]
        try:
            tk = yf.Ticker(ticker)
            expirations = tk.options
            if not expirations:
                log.debug("  ✗ %s: no options", ticker)
                continue

            # Find expiry in target DTE window
            best_expiry = None
            for exp_str in expirations:
                try:
                    exp_date = date.fromisoformat(exp_str)
                    dte = (exp_date - today).days
                    if TARGET_DTE_MIN <= dte <= TARGET_DTE_MAX:
                        best_expiry = exp_str
                        break
                    elif dte > TARGET_DTE_MAX:
                        # Take the closest one even if slightly outside window
                        if best_expiry is None:
                            best_expiry = exp_str
                        break
                except ValueError:
                    continue

            if not best_expiry:
                # Fall back to nearest expiry
                best_expiry = expirations[0] if expirations else None

            if not best_expiry:
                continue

            exp_date = date.fromisoformat(best_expiry)
            dte = (exp_date - today).days
            weeks_to_exp = max(dte / 7, 0.14)

            chain = tk.option_chain(best_expiry)
            spot = c["price"]

            best_put = _find_best_put(chain.puts, spot)
            if not best_put:
                log.debug("  ✗ %s: no suitable put found", ticker)
                continue

            # Premium metrics
            collateral = best_put["strike"] * 100
            premium_total = best_put["premium"] * 100
            roc = round((premium_total / collateral) * 100, 2)
            weekly_roc = round(roc / weeks_to_exp, 2)
            port_alloc = round((collateral / STARTING_CAPITAL) * 100, 1)

            # Skip if premium is garbage or allocation out of range
            if weekly_roc < MIN_WEEKLY_ROC:
                log.debug("  ✗ %s: weekly ROC %.2f%% too low", ticker, weekly_roc)
                continue

            if not (MIN_ALLOC * 100 <= port_alloc <= MAX_ALLOC * 100):
                log.debug("  ✗ %s: alloc %.1f%% out of range", ticker, port_alloc)
                continue

            # Premium score (added to tech score)
            prem_score = 0
            if weekly_roc >= 4.0:
                prem_score = 4
            elif weekly_roc >= 3.0:
                prem_score = 3
            elif weekly_roc >= 2.5:
                prem_score = 2
            elif weekly_roc >= 2.0:
                prem_score = 1

            # Liquidity score
            liq_score = 0 if best_put["liquidity_warn"] else 2
            if best_put["open_interest"] >= 500:
                liq_score = min(liq_score + 1, 2)

            total_score = c["tech_score"] + prem_score + liq_score

            # Sector info
            try:
                info = tk.info
                raw_sector = info.get("sector", "Unknown")
                sector = SECTOR_MAP.get(raw_sector, raw_sector)
                name = info.get("shortName", ticker)[:40]
            except Exception:
                sector = "Unknown"
                name = ticker

            results.append({
                "symbol": ticker,
                "name": name,
                "sector": sector,
                "price": spot,
                "rsi": c["rsi"],
                "atr_pct": c["atr_pct"],
                "rel_vol": c["rel_vol"],
                "strike": best_put["strike"],
                "premium": best_put["premium"],
                "expiry": best_expiry,
                "dte": dte,
                "weekly_roc": weekly_roc,
                "port_alloc": port_alloc,
                "collateral": collateral,
                "delta": best_put["delta"],
                "iv": best_put["iv"],
                "volume": best_put["volume"],
                "open_interest": best_put["open_interest"],
                "bid": best_put["bid"],
                "ask": best_put["ask"],
                "spread": best_put["spread"],
                "liquidity_warn": best_put["liquidity_warn"],
                "score": total_score,
                "reasons": c["reasons"],
                "grade": _grade(total_score),
            })
            log.info("  ✓ %s $%.2f → %s $%.2f put @ $%.2f (%.2f%%/wk) score=%d",
                     ticker, spot, best_expiry, best_put["strike"],
                     best_put["premium"], weekly_roc, total_score)

        except Exception as e:
            log.warning("  ✗ %s: %s", ticker, e)

        time.sleep(0.5)  # respect yfinance rate limits

    results.sort(key=lambda x: x["score"], reverse=True)
    log.info("  → %d trade setups found", len(results))
    return results[:MAX_RESULTS]


def _grade(score: int) -> str:
    """A/B/C/D grade from total score."""
    if score >= 14:
        return "A"
    elif score >= 10:
        return "B"
    elif score >= 6:
        return "C"
    else:
        return "D"


# ─────────────────────────────────────────────────────────────────────────────
# Output
# ─────────────────────────────────────────────────────────────────────────────

def write_output(picks: list[dict], target_date: date, dry_run: bool = False) -> None:
    """Write daily JSON + update latest.json manifest."""
    date_str = target_date.isoformat()
    payload = {
        "date": date_str,
        "generated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "portfolio": {
            "starting_capital": STARTING_CAPITAL,
            "target_premium": STARTING_CAPITAL * 0.01,  # 1% = $100
        },
        "picks": picks,
        "stats": {
            "total_candidates": len(UNIVERSE),
            "picks_found": len(picks),
            "avg_weekly_roc": round(
                sum(p["weekly_roc"] for p in picks) / len(picks), 2
            ) if picks else 0,
        },
    }

    if dry_run:
        log.info("DRY RUN — output:\n%s", json.dumps(payload, indent=2))
        return

    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    out_path = DOCS_DATA / f"{date_str}.json"

    # Write atomically: temp file → rename
    tmp_path = out_path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2))
    tmp_path.rename(out_path)
    log.info("✅ Written: %s (%d picks)", out_path, len(picks))

    # Update latest.json manifest atomically
    manifest = {"latest": date_str, "generated_at": payload["generated_at"]}
    tmp_manifest = DOCS_LATEST.with_suffix(".tmp")
    tmp_manifest.write_text(json.dumps(manifest, indent=2))
    tmp_manifest.rename(DOCS_LATEST)
    log.info("✅ Manifest updated: %s", DOCS_LATEST)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def _nearest_trading_day(d: date) -> date:
    """If date is weekend, advance to Monday."""
    while d.weekday() >= 5:  # 5=Sat, 6=Sun
        d += timedelta(days=1)
    return d


def run(target_date: date, dry_run: bool = False) -> int:
    """Full pipeline. Returns number of picks found."""
    log.info("=" * 60)
    log.info("Decay Derby CSP Scanner — %s", target_date)
    log.info("Portfolio: $%s | Range: $%.0f-$%.0f", f"{STARTING_CAPITAL:,}", MIN_PRICE, MAX_PRICE)
    log.info("=" * 60)

    # Stage 1: price filter
    candidates = stage1_price_filter(UNIVERSE)
    if not candidates:
        log.warning("No candidates in price range — writing empty output")
        write_output([], target_date, dry_run)
        return 0

    # Stage 2: technical scoring
    scored = stage2_technical_score(candidates)
    if not scored:
        log.warning("No candidates passed technical filter")
        write_output([], target_date, dry_run)
        return 0

    # Stage 3: options chain dive
    picks = stage3_options_dive(scored, target_date)

    # Write output
    write_output(picks, target_date, dry_run)
    log.info("Done! %d picks for %s", len(picks), target_date)
    return len(picks)


def main():
    parser = argparse.ArgumentParser(description="Decay Derby CSP Screener")
    parser.add_argument("--date", help="Target date YYYY-MM-DD (default: next trading day)")
    parser.add_argument("--dry-run", action="store_true", help="Print output, don't write files")
    args = parser.parse_args()

    if args.date:
        try:
            target = date.fromisoformat(args.date)
        except ValueError:
            log.error("Invalid date format: %s (use YYYY-MM-DD)", args.date)
            sys.exit(1)
    else:
        target = _nearest_trading_day(date.today())

    picks = run(target, dry_run=args.dry_run)
    sys.exit(0 if picks >= 0 else 1)


if __name__ == "__main__":
    main()
