To provide a comprehensive review of the "Decay Derby" codebase, I will first examine the current directory structure to see if there are any existing Python scripts or configurations in the `screener/` directory that might influence the Phase 2 integration strategy. I will also check for any hidden configuration files that might dictate portfolio settings.

Then, I will proceed to generate the Architect Review.

One sentence explanation: I am checking the `screener/` directory to see if any Phase 2 work has already begun before I provide my architectural review.
This review focuses on transitioning "Decay Derby" from a static prototype to a robust, data-driven application.

### 1. Priority Issues (Must Fix)

*   **Fragile Event Handlers (`js/screener.js` L131):** The `sellPut` function injects stringified JSON directly into an `onclick` attribute: `onclick='Screener.sellPut(${JSON.stringify(p)...})'`. This will break if a company name contains a single quote (e.g., *Lowe's*) or special characters. 
    *   *Fix:* Use a data-attribute (e.g., `data-symbol="${p.symbol}"`) and a single event listener on the table body to look up the pick from a local cache by symbol.
*   **Lack of Fetch Error Handling (`js/app.js` L41):** `loadPicks` assumes the JSON for `currentDate` always exists. On Monday mornings before market open, the "nearest weekday" logic will fetch a file that doesn't exist yet, leading to a silent 404 and a broken UI.
    *   *Fix:* Implement a fallback mechanism that tries `D-1` if the current date returns a 404, or adds a "Latest" manifest file (see Phase 2).
*   **Hardcoded Global State (`js/portfolio.js` L5):** `STARTING_CAPITAL` is hardcoded. While $10k is the project target, it makes the "Import" feature confusing if a user tries to import a $15k log into a $10k UI.
    *   *Fix:* Move `STARTING_CAPITAL` to `localStorage` so it persists and is editable via a "Settings" modal.

### 2. Structural Recommendations

*   **Decouple Sector Mapping:** `Portfolio.js` (L12-32) maps full sector names, while `screener.js` (L117) and `app.js` (L157) use `.split(' ')[0]`. This leads to "Finance" vs "Financial" mismatches. 
    *   *Recommendation:* Create a `Utils.getSectorKey(name)` function that slugs the name for CSS classes and lookups.
*   **Modularize UI Updates:** `app.js` calls `renderDashboard`, `Tracker.renderTradeLog`, and `Substack.render` manually in a `refresh()` function.
    *   *Recommendation:* Use a simple Pub/Sub pattern. When `Tracker` saves a trade, it should trigger a `data-updated` event that all tabs listen to. This prevents the "forgot to refresh the other tab" bug.
*   **Standardize Date Handling:** The app uses `ISOString.slice(0, 10)` in some places and `Date.toLocaleDateString` in others.
    *   *Recommendation:* Use a single utility for "Market Date" (EST/EDT) to avoid timezone shifts where a user in California sees "Today's Picks" as "Tomorrow" because it's past 4 PM PT (00:00 UTC).

### 3. Feature Suggestions for V1

*   **Pre-Trade Impact Analysis:** In the "Confirm Trade" modal, show the *projected* sector exposure. (e.g., "This trade will increase Finance exposure from 20% to 35%").
*   **Collateral Safety Buffer:** Add a "Cash Reserve" setting (e.g., 5%). The screener should mark trades "Over Cap" if they dip into this reserve.
*   **The "Wheel" Transition:** Currently, "Assigned" just changes the status. For a true Wheel strategy, an "Assigned" CSP should automatically generate a "Covered Call" entry template in the Trade Log.
*   **Profit/Loss Charting:** A simple Sparkline in the Dashboard showing `Premium Collected` over time (using the `closedAt` dates from the trade log).

### 4. Phase 2 Prep (Screener Integration)

To make the Python screener (Phase 2) effective, the JSON contract should be expanded:

*   **Static Manifest:** The Python script should generate a `latest.json` containing the filename of the most recent screener run. This eliminates date-guessing logic in the JS.
*   **The "Why":** Add `delta` and `iv_rank` to the `picks` object. Users of this strategy prioritize high IV and low Delta; showing these values builds trust in the "Score".
*   **Volume Validation:** Include a `liquidity_score` or `bid_ask_spread` field. Thinly traded options (like `TE` or `ONDS`) can have misleading premiums that are impossible to fill at the mid-price.
*   **Sector Taxonomy:** Ensure the Python script uses the same sector names as the TDPro API to avoid the "Unknown Sector" fallback in the UI.

### Summary of Changes Needed
| File | Action |
| :--- | :--- |
| `portfolio.js` | Move `STARTING_CAPITAL` to a configurable setting. |
| `screener.js` | Replace inline `onclick` with data-attributes + event delegation. |
| `app.js` | Add 404 handling/retry logic for missing daily JSON files. |
| `tracker.js` | Add a "Close all positions" or "Clear data" for testing. |
