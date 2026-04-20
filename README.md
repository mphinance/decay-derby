# 💀 Decay Derby

> *A $10K cash-secured put & wheel strategy tracker. Selling theta. Tracking the grind.*

**Live site:** https://mphinance.github.io/decay-derby/

---

## What Is This?

Decay Derby is a week-long experiment in selling cash-secured puts (CSPs) on volatile $10–30 stocks. Every day we allocate 10–30% of the portfolio into a new put position, collect premium, and track the whole thing publicly.

- **Portfolio:** $10,000
- **Daily allocation:** 10–30% per trade
- **Weekly target:** $100 (1% of portfolio)
- **Strategy:** CSP → assignment → Covered Call (the Wheel)

Picks come from the [TDPro CSP/Wheel Screener](https://www.traderdaddy.pro/screeners/csp-wheel), validated against an automated daily scanner that runs at 6:30 AM ET.

---

## App Features

- **Today's Picks** — live screener data with sort + filter by grade/sector/affordability
- **Trade Tracker** — log every CSP, close/expire/assign with one click
- **Wheel Auto-Transition** — assigned CSP automatically opens a Covered Call template
- **Dashboard** — cumulative premium chart, allocation gauge, weekly target tracker
- **Substack Export** — one-click post generator with "My Pick" commentary

---

## Project Structure

```
decay-derby/
├── docs/                    # GitHub Pages root
│   ├── index.html           # Single-page app
│   ├── css/styles.css       # Ghost Alpha dark theme
│   ├── js/
│   │   ├── app.js           # Main controller + dashboard
│   │   ├── screener.js      # Today's picks table
│   │   ├── tracker.js       # Trade lifecycle + wheel state
│   │   ├── portfolio.js     # Capital math + sector logic
│   │   └── substack.js      # Post generator
│   └── data/
│       ├── latest.json      # Manifest → most recent screener date
│       └── daily/           # YYYY-MM-DD.json per trading day
├── screener/
│   ├── csp_scanner.py       # Python screener (price → technical → options chain)
│   └── requirements.txt
└── .github/workflows/
    └── daily_screener.yml   # Runs Mon–Fri 6:30 AM ET
```

---

## Screener Pipeline

The Python screener runs automatically via GitHub Actions every weekday morning:

1. **Stage 1 — Price Filter:** Batch price check across ~50 tickers, keeps $9.50–$30 range
2. **Stage 2 — Technical Scoring:** RSI, ATR%, relative volume (favors oversold + high IV)
3. **Stage 3 — Options Chain:** yfinance options dive, best OTM put, liquidity check, weekly ROC

**Scoring (max 20 pts):**

| Category | Max Pts |
|---|---|
| ATR % (high IV = fat premium) | 3 |
| RSI (oversold = lower assignment risk) | 3 |
| Relative Volume | 2 |
| Weekly ROC | 4 |
| Liquidity (OI + spread) | 2 |

**Grades:** A = 14+, B = 10+, C = 6+, D = below 6

---

## Running the Screener Locally

```bash
cd screener
pip install -r requirements.txt

# Today's picks (writes to docs/data/daily/YYYY-MM-DD.json)
python csp_scanner.py

# Specific date
python csp_scanner.py --date 2026-04-21

# Dry run (no file write)
python csp_scanner.py --dry-run
```

---

## The Rules

1. $10,000 starting capital — no adding funds
2. Max 30% in any single trade
3. Pause and reassess when weekly premium hits $100 (1%)
4. All picks free this week — no paywall BS while we're testing this live
5. If assigned, sell a covered call. That's the wheel. Keep spinning.

---

*Not financial advice. Just a guy selling puts and tracking it publicly.*  
*Follow along on [Substack](https://mphinance.substack.com)*
