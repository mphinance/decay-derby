/**
 * Substack — Generate formatted post content from daily picks + trades
 */
const Substack = (() => {

  function render() {
    const state = Portfolio.getState();
    const data = Screener.getData();
    const container = document.getElementById('substackExport');

    const dateStr = data ? data.date : App.localDateStr();
    const picks = data ? data.picks : [];
    const targetHit = state.premiumCollected >= Portfolio.PREMIUM_TARGET;

    container.innerHTML = `
      <div style="margin-bottom:20px">
        <div class="metric-label" style="margin-bottom:8px;color:var(--cyan)">MY PICK THIS WEEK</div>
        <textarea id="myPickNote" class="form-input" rows="4" placeholder="e.g. Going with ONDS — RSI 52, IV crushed after the announcement, $10 put at $0.45 gives me 4.55% ROC with only 10% port allocation. If I get assigned at $9.55 net I'm happy to wheel it..."
          style="width:100%;resize:vertical;font-size:0.8rem;line-height:1.5">${_savedNote()}</textarea>
        <div class="form-hint">This note drops into the post as your commentary. Edit freely.</div>
      </div>

      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" type="button" onclick="Substack.generate()">⚡ Generate Post</button>
        <div class="form-hint" style="align-self:center">All picks are free this week 🎉</div>
      </div>

      <div id="generatedPost" style="display:none">
        <div class="export-preview" id="exportText"></div>
        <div class="export-actions" style="margin-top:12px">
          <button class="btn btn-primary" type="button" onclick="Substack.copy()">📋 Copy to Clipboard</button>
          <button class="btn btn-ghost" type="button" onclick="Substack.download()">⬇ Download .txt</button>
        </div>
      </div>`;

    // Auto-save note on type
    document.getElementById('myPickNote').addEventListener('input', (e) => {
      try { localStorage.setItem('decay_derby_pick_note', e.target.value); } catch(_) {}
    });
  }

  function _savedNote() {
    try { return localStorage.getItem('decay_derby_pick_note') || ''; } catch(_) { return ''; }
  }

  function generate() {
    const state = Portfolio.getState();
    const data = Screener.getData();
    const picks = data ? data.picks : [];
    const dateStr = data ? data.date : App.localDateStr();
    const note = document.getElementById('myPickNote')?.value?.trim() || '';
    const targetHit = state.premiumCollected >= Portfolio.PREMIUM_TARGET;

    let post = `TDPro Puts All Week! — ${dateStr}\n\n`;

    // My Pick commentary
    if (note) {
      post += `🎯 My Pick This Week\n\n${note}\n\n`;
      post += `---\n\n`;
    }

    // Port summary
    post += `Portfolio Snapshot\n\n`;
    post += `• Starting capital: ${Portfolio.formatCurrency(state.startingCapital)}\n`;
    post += `• Deployed: ${Portfolio.formatCurrency(state.capitalDeployed)} (${state.allocationPct.toFixed(0)}%)\n`;
    post += `• Premium banked: ${Portfolio.formatCurrency(state.premiumCollected)}\n`;
    post += `• Weekly target: ${Portfolio.formatCurrency(Portfolio.PREMIUM_TARGET)} (1% of port)\n\n`;

    if (targetHit) {
      post += `🏆 WEEKLY TARGET HIT! ${Portfolio.formatCurrency(state.premiumCollected)} collected (${state.weeklyROC ? state.weeklyROC.toFixed(2) : '?'}% ROC). Pausing to reassess.\n\n`;
    }

    post += `---\n\n`;

    // Active positions
    if (state.activeTrades.length > 0) {
      post += `Active Positions\n\n`;
      state.activeTrades.forEach(t => {
        const netPrem = (t.premium * 100 * (t.contracts || 1)) - (t.fees || 0);
        post += `• ${t.contracts || 1}x ${t.symbol} ${t.strike}P exp ${t.expiry} — $${netPrem.toFixed(0)} premium (${((netPrem / t.collateral) * 100).toFixed(1)}% ROC)\n`;
      });
      post += `\n`;
    }

    // Closed this week
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentClosed = state.closedTrades.filter(t => t.closedAt > weekAgo);
    if (recentClosed.length > 0) {
      post += `This Week's Results\n\n`;
      recentClosed.forEach(t => {
        const icon = t.status === 'won' ? '✅' : t.status === 'assigned' ? '📦' : '❌';
        const pnl = t.pnl !== undefined ? t.pnl : ((t.premium * 100 * (t.contracts || 1)) - (t.closePrice ? t.closePrice * 100 * (t.contracts || 1) : 0) - (t.fees || 0));
        post += `${icon} ${t.contracts || 1}x ${t.symbol} ${t.strike}P — ${t.status.toUpperCase()} (${pnl >= 0 ? '+' : ''}${Portfolio.formatCurrency(pnl)})\n`;
      });
      post += `\n`;
    }

    post += `---\n\nToday's Picks (from TDPro CSP Screener) — ALL FREE THIS WEEK 🎉\n\n`;

    picks.forEach((p, i) => {
      const collateral = p.collateral || (p.strike * 100);
      post += `${i + 1}. ${p.symbol} — $${p.price.toFixed(2)}\n`;
      post += `   Sell ${p.strike} Put, exp ${p.expiry} (${p.dte} DTE)\n`;
      post += `   Premium: $${p.premium.toFixed(2)} | ROC: ${p.weekly_roc.toFixed(2)}%/wk | Collateral: $${collateral.toFixed(0)}\n`;
      post += `   Score: ${p.score} | Grade: ${p.grade} | RSI: ${p.rsi.toFixed(0)} | IV: ${p.iv || '?'}% | Sector: ${p.sector}\n\n`;
    });

    post += `---\n\nNot financial advice. $10K port, selling puts, tracking the wheel.\nFollow along at traderdaddy.pro\n`;

    const el = document.getElementById('exportText');
    el.textContent = post;

    const wrapper = document.getElementById('generatedPost');
    wrapper.style.display = 'block';
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function copy() {
    const text = document.getElementById('exportText')?.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.export-actions .btn-primary');
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.textContent = '📋 Copy to Clipboard', 2000);
    });
  }

  function download() {
    const text = document.getElementById('exportText')?.textContent || '';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tdpro-puts-${App.localDateStr()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return { render, generate, copy, download };
})();
