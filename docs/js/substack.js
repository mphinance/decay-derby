/**
 * Substack — Generate formatted post content from daily picks + trades
 */
const Substack = (() => {

  function render() {
    const state = Portfolio.getState();
    const data = Screener.getData();
    const container = document.getElementById('substackExport');

    const dateStr = data ? data.date : new Date().toISOString().slice(0, 10);
    const picks = data ? data.picks.slice(0, 5) : [];

    // Build post content
    let post = `TDPro Puts — ${dateStr}\n\n`;
    post += `Portfolio: ${Portfolio.formatCurrency(state.startingCapital)} | `;
    post += `Deployed: ${Portfolio.formatCurrency(state.capitalDeployed)} (${state.allocationPct.toFixed(0)}%) | `;
    post += `Premium Banked: ${Portfolio.formatCurrency(state.premiumCollected)}\n\n`;

    if (state.premiumCollected >= Portfolio.PREMIUM_TARGET) {
      post += `🎯 PREMIUM TARGET HIT! ${Portfolio.formatCurrency(state.premiumCollected)} collected (${Portfolio.formatPct(state.weeklyROC)} ROC). Pausing to reassess.\n\n`;
    }

    post += `---\n\n`;
    post += `Today's Picks (from TDPro CSP Screener)\n\n`;

    picks.forEach((p, i) => {
      const free = i < 3;
      if (free) {
        post += `${i + 1}. ${p.symbol} — $${p.price.toFixed(2)}\n`;
        post += `   Sell ${p.strike} Put, ${p.expiry} (${p.dte} DTE)\n`;
        post += `   Premium: $${p.premium.toFixed(2)} | ROC: ${p.weekly_roc.toFixed(2)}%/wk | Capital: $${p.capital_required}\n`;
        post += `   Score: ${p.score.toFixed(0)} | RSI: ${p.rsi.toFixed(0)} | Sector: ${p.sector}\n\n`;
      } else {
        post += `${i + 1}. [PREMIUM] ${p.symbol} — Subscribe for this pick!\n\n`;
      }
    });

    post += `---\n\n`;

    // Active positions update
    if (state.activeTrades.length > 0) {
      post += `Active Positions:\n\n`;
      state.activeTrades.forEach(t => {
        post += `• ${t.symbol} ${t.strike}P exp ${t.expiry} — Premium: $${(t.premium * 100).toFixed(0)} (${((t.premium * 100 / t.collateral) * 100).toFixed(1)}% ROC)\n`;
      });
      post += `\n`;
    }

    // Closed trades this week
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentClosed = state.closedTrades.filter(t => t.closedAt > weekAgo);
    if (recentClosed.length > 0) {
      post += `This Week's Results:\n\n`;
      recentClosed.forEach(t => {
        const icon = t.status === 'won' ? '✅' : t.status === 'assigned' ? '📦' : '❌';
        post += `${icon} ${t.symbol} ${t.strike}P — ${t.status.toUpperCase()}\n`;
      });
      post += `\n`;
    }

    post += `---\n\nNot financial advice. $10K port, selling puts, tracking the wheel. Follow along at traderdaddy.pro\n`;

    container.innerHTML = `
      <div class="export-preview" id="exportText">${escapeHtml(post)}</div>
      <div class="export-actions">
        <button class="btn btn-primary" onclick="Substack.copy()">📋 Copy to Clipboard</button>
        <button class="btn btn-ghost" onclick="Substack.download()">⬇ Download .txt</button>
      </div>
      <div style="margin-top:16px">
        <div class="form-hint">
          First 3 picks shown free. Picks 4-5 locked behind "premium" paywall text.
          Edit as needed before posting to Substack.
        </div>
      </div>`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function copy() {
    const text = document.getElementById('exportText').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.export-actions .btn-primary');
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.textContent = '📋 Copy to Clipboard', 2000);
    });
  }

  function download() {
    const text = document.getElementById('exportText').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tdpro-puts-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { render, copy, download };
})();
