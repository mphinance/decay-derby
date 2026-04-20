I will start by exploring the codebase to understand the current implementation of the modules and how the agreed-upon changes can be integrated.
I will read `app.js` to understand the application's lifecycle and `screener.js` to analyze the current trade logic and pick structure.
I will read `2026-04-19.json` to examine the structure of the picks.
I will read `portfolio.js` and `tracker.js` to understand state management and trade opening logic.
I have thoroughly reviewed the current implementation across `app.js`, `screener.js`, `portfolio.js`, and `tracker.js`. I appreciate the proactive fixes for XSS and timezone issues.

Here is the finalized action plan and responses to your questions.

### 1. Finalized Priority & Action Plan

**Phase 1: Data Resilience & Navigation (Immediate)**
*   **`latest.json` Manifest:** Create a `docs/data/latest.json` that looks like `{"latest": "2026-04-21"}`. 
*   **Fetch Logic Update:** Update `Screener.loadDay` to first try the requested date, then fallback to Friday if it's a Monday 404. If the app is first opened, it should fetch `latest.json` to determine the starting date rather than just using "today."

**Phase 2: Strategy & UX (Core Logic)**
*   **Wheel Auto-Transition:** Modify `Tracker.assignTrade` to not just close the CSP, but immediately trigger a "New Covered Call" modal for that symbol.
*   **Pre-trade Sector Impact:** Update the trade confirmation modal in `Tracker.openTradeFromPick` to include a warning line if the trade pushes a sector into the "Heavy" (>40%) category.

**Phase 3: Data Enrichment (Next Screener Update)**
*   **Liquidity & Greeks:** Integrate the new fields (Delta, Liquidity Score) into the JSON and table.

---

### 2. Architect's Response to Questions

**Q1: Wheel auto-transition strike selection?**
**A:** Suggest a strike based on the **Assigned Price** (the original CSP strike). For the "Decay Derby" strategy, the goal is often to sell at or above cost basis. Default the CC strike to the CSP strike, but keep the field editable. This ensures the user can quickly roll the wheel while maintaining their cost basis.

**Q2: Delta/IV Rank in JSON?**
**A:** Since we want to keep it lightweight, let's prioritize **Delta** as it's the primary risk gauge for the strategy. For IV, use **IV Percentile** (current IV vs 52-week high/low) if available from your data source, as it's a more intuitive "buy/sell" signal than raw IV. If the screener uses `yfinance`, Delta can be pulled from the options chain; otherwise, a simple Black-Scholes approximation in the screener script is sufficient for v1.

**Q3: Liquidity Score threshold?**
**A:** Given these are $10-30 stocks, bid-ask spreads can be wide. Let's use a **Volume/Open Interest (OI)** proxy rather than just spread. 
*   **Threshold:** Flag as "Low Liquidity" if `Volume < 10` AND `OI < 100` on that specific contract.
*   **Action:** Don't filter them out entirely, but add a ⚠️ icon next to the premium in the table to warn the user about potentially difficult fills.

---

### 3. Implementation Directives

#### Update `Screener.loadDay` for 404 Fallback
```javascript
async function loadDay(dateStr) {
  try {
    let resp = await fetch(`data/daily/${dateStr}.json`);
    if (!resp.ok && dateStr === App.getTodayStr()) { // Only fallback on current date
       // Logical fallback: if Monday, try previous Friday
       const d = new Date(dateStr + 'T12:00:00');
       if (d.getDay() === 1) { // Monday
         d.setDate(d.getDate() - 3); // Friday
         const fallbackDate = App.localDateStr(d);
         resp = await fetch(`data/daily/${fallbackDate}.json`);
       }
    }
    if (!resp.ok) return null;
    currentData = await resp.json();
    return currentData;
  } catch (e) {
    return null;
  }
}
```

#### Update `Tracker.confirmTrade` for Sector Impact
Add a check before the button:
```javascript
const currentExposure = Portfolio.getSectorExposure().sectors[sector]?.pct || 0;
const newExposure = (( (Portfolio.getSectorExposure().sectors[sector]?.capital || 0) + (strike * 100 * contracts) ) / Portfolio.STARTING_CAPITAL) * 100;
if (newExposure > 40) {
  // Show warning in the modal: "⚠ This will increase ${sector} to ${newExposure.toFixed(0)}%"
}
```

I'll step back and let you handle the implementation of these items. No further architectural changes are requested for this round.
