# Architect Review — Round 1 (Self-Review)

> Note: External Gemini API key was revoked. Review conducted by lead agent.

## 🔴 Priority Issues (Must Fix)

### 1. XSS via JSON in onclick attributes (screener.js)
`sellPut()` injects `JSON.stringify(pick)` directly into an `onclick` attribute. If a company name contains quotes or HTML chars, the handler breaks or becomes exploitable. **Fix: Use event delegation + data-index attributes.**

### 2. Timezone-sensitive date logic (app.js)
`nearestWeekday()` uses `new Date()` (local) then `.toISOString()` (UTC). At 6pm Sunday CT (= Monday 00:xx UTC), the date could jump to Monday prematurely. **Fix: Use local date components instead of ISO.**

### 3. No localStorage error handling (tracker.js)
If localStorage is corrupted, full, or contains invalid JSON, the entire app crashes. **Fix: Wrap in try/catch with graceful fallback.**

### 4. No auto-backup on trade mutations
Single point of failure — if localStorage is cleared, all trade history is lost. **Fix: Auto-download backup JSON after every 5th mutation.**

## 🟡 Structural Recommendations

### 5. Event delegation for table interactions
Inline onclick handlers are a maintenance hazard. Use a single event listener on the table body.

### 6. State computation is redundant
`Portfolio.getState()` is called separately by Dashboard, Screener, and Tracker. Should compute once per render cycle.

### 7. Add cumulative premium mini-chart
Even a simple CSS bar chart showing premium growth over time would make the dashboard feel complete.

### 8. Running P/L on active trades
Show unrealized P/L based on current premium vs. what you'd need to buy-to-close (estimate from screener data or manual input).

## 🟢 Polish Items

### 9. Print/screenshot CSS
Add `@media print` styles for clean Substack screenshots.

### 10. Keyboard navigation
Arrow keys for date nav on picks tab. Enter to confirm modal.

## Implementation Plan

1. ✅ Fix XSS — event delegation in screener.js
2. ✅ Fix timezone — local date math in app.js  
3. ✅ Error boundaries — tracker.js localStorage
4. ✅ Auto-backup — tracker.js mutation hook
5. ✅ Cumulative premium chart — dashboard CSS chart
6. ✅ Print styles — styles.css
