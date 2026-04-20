/**
 * Screener — Load daily picks JSON, display with capital-aware filtering
 *
 * Architect fixes applied:
 * - Event delegation instead of inline onclick (XSS prevention)
 * - Picks stored in module, referenced by index
 */
const Screener = (() => {
  let currentData = null;
  let sortCol = 'score';
  let sortDir = 'desc';
  let sortedPicks = []; // Store sorted picks for event delegation

  async function loadDay(dateStr) {
    try {
      let resp = await fetch(`data/daily/${dateStr}.json`);

      // Fallback: if Monday and no data yet, try previous Friday
      if (!resp.ok) {
        const d = new Date(dateStr + 'T12:00:00');
        if (d.getDay() === 1) { // Monday
          d.setDate(d.getDate() - 3); // → Friday
          const fri = App.localDateStr ? App.localDateStr(d) : dateStr;
          resp = await fetch(`data/daily/${fri}.json`);
        }
      }

      // Final fallback: try latest.json manifest
      if (!resp.ok) {
        try {
          const latest = await fetch('data/latest.json');
          if (latest.ok) {
            const manifest = await latest.json();
            if (manifest.latest && manifest.latest !== dateStr) {
              resp = await fetch(`data/daily/${manifest.latest}.json`);
            }
          }
        } catch (e) { /* no manifest available */ }
      }

      if (!resp.ok) return null;
      currentData = await resp.json();
      return currentData;
    } catch (e) {
      console.warn('Screener load failed:', e);
      return null;
    }
  }

  function render(data) {
    if (!data || !data.picks) {
      document.getElementById('picksTable').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-text">No screener data for this date</div>
          <div class="empty-state-sub" style="margin-top:6px;font-size:0.7rem;color:var(--text-muted)">
            The screener runs daily at market open. Check back tomorrow!
          </div>
        </div>`;
      return;
    }

    const state = Portfolio.getState();
    sortedPicks = [...data.picks];

    // Sort
    sortedPicks.sort((a, b) => {
      const va = a[sortCol] ?? 0;
      const vb = b[sortCol] ?? 0;
      if (typeof va === 'string') return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
      return sortDir === 'desc' ? vb - va : va - vb;
    });

    // Capital bar
    const size = Portfolio.suggestedPositionSize();
    document.getElementById('capitalBar').innerHTML = `
      <div class="metric-card accent-cyan" style="padding:12px 16px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <span class="metric-label">Available Capital</span>
            <span style="font-family:'JetBrains Mono',monospace;font-size:1.1rem;font-weight:700;margin-left:8px">
              ${Portfolio.formatCurrency(state.availableCapital)}
            </span>
            <span style="font-size:0.7rem;color:var(--text-muted);margin-left:8px">
              of ${Portfolio.formatCurrency(state.startingCapital)}
            </span>
          </div>
          <div style="font-size:0.7rem;color:var(--text-secondary)">
            Target position: ${Portfolio.formatCurrency(size.min)} — ${Portfolio.formatCurrency(size.max)}
            <span style="color:var(--text-muted)">(10-30%)</span>
          </div>
        </div>
      </div>`;

    // Picks table
    const thClass = (col) => {
      if (sortCol !== col) return '';
      return sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc';
    };

    const trades = Tracker.getTrades();

    let html = `
      <table class="data-table" id="picksDataTable">
        <thead>
          <tr>
            <th class="${thClass('score')}" data-sort="score">Score</th>
            <th class="${thClass('symbol')}" data-sort="symbol">Symbol</th>
            <th class="hide-mobile">Sector</th>
            <th class="${thClass('price')}" data-sort="price">Price</th>
            <th class="${thClass('strike')}" data-sort="strike">Strike</th>
            <th class="${thClass('premium')}" data-sort="premium">Prem</th>
            <th class="${thClass('weekly_roc')}" data-sort="weekly_roc">ROC/wk</th>
            <th class="${thClass('capital_required')}" data-sort="capital_required">Capital</th>
            <th class="hide-mobile" data-sort="dte">DTE</th>
            <th class="hide-mobile" data-sort="rsi">RSI</th>
            <th>Alloc%</th>
            <th></th>
          </tr>
        </thead>
        <tbody>`;

    sortedPicks.forEach((p, idx) => {
      const affordable = Portfolio.canAfford(p.capital_required);
      const sectorHeavy = Portfolio.isSectorHeavy(p.sector);
      const alreadyTraded = trades.some(t =>
        t.symbol === p.symbol && t.status === 'active' && t.expiry === p.expiry
      );
      const allocPct = ((p.capital_required / Portfolio.STARTING_CAPITAL) * 100).toFixed(1);

      let rowClass = '';
      if (!affordable) rowClass = 'row-unaffordable';
      else if (sectorHeavy) rowClass = 'row-sector-heavy';

      const scoreWidth = Math.min(p.score, 100);
      const rocColor = p.weekly_roc >= 2.5 ? 'var(--green)' : p.weekly_roc >= 1.5 ? 'var(--cyan)' : 'var(--text-secondary)';

      html += `
        <tr class="${rowClass}">
          <td class="col-score">
            ${p.score.toFixed(0)}
            <span class="score-bar"><span class="score-bar-fill" style="width:${scoreWidth}%"></span></span>
          </td>
          <td class="col-symbol">
            ${p.symbol}
            ${alreadyTraded ? '<span style="color:var(--green);font-size:0.65rem;margin-left:4px">✓</span>' : ''}
          </td>
          <td class="hide-mobile">
            <span class="sector-badge ${Portfolio.getSectorClass(p.sector)}">${p.sector.split(' ')[0]}</span>
            ${sectorHeavy ? '<span class="sector-warn">⚠</span>' : ''}
          </td>
          <td>${Portfolio.formatCurrency(p.price)}</td>
          <td>${Portfolio.formatCurrency(p.strike)}</td>
          <td style="color:var(--green)">${Portfolio.formatCurrency(p.premium)}</td>
          <td class="col-roc" style="color:${rocColor}">${p.weekly_roc.toFixed(2)}%</td>
          <td>${Portfolio.formatCurrency(p.capital_required)}</td>
          <td class="hide-mobile">${p.dte}d</td>
          <td class="hide-mobile">${p.rsi.toFixed(0)}</td>
          <td>${allocPct}%</td>
          <td>
            ${affordable && !alreadyTraded
              ? `<button class="btn btn-success btn-sm" data-sell-idx="${idx}" type="button">✅ Sell</button>`
              : alreadyTraded
                ? '<span style="color:var(--green);font-size:0.65rem">Sold</span>'
                : '<span style="color:var(--text-muted);font-size:0.65rem">Over cap</span>'
            }
          </td>
        </tr>`;
    });

    html += '</tbody></table>';

    // Summary line
    html += `<div style="margin-top:12px;font-size:0.65rem;color:var(--text-muted);font-family:'JetBrains Mono',monospace">
      ${data.summary.total_scanned.toLocaleString()} stocks scanned · ${data.picks.length} passed filters · Avg ROC: ${data.summary.avg_weekly_roc.toFixed(2)}%/wk
    </div>`;

    document.getElementById('picksTable').innerHTML = html;

    // Event delegation: sort headers
    const table = document.getElementById('picksDataTable');
    if (table) {
      table.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const col = th.dataset.sort;
        if (sortCol === col) {
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          sortCol = col;
          sortDir = 'desc';
        }
        render(data);
      });

      // Event delegation: sell buttons
      table.querySelector('tbody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-sell-idx]');
        if (!btn) return;
        const idx = parseInt(btn.dataset.sellIdx);
        if (sortedPicks[idx]) {
          Tracker.openTradeFromPick(sortedPicks[idx]);
        }
      });
    }
  }

  function getData() { return currentData; }

  return { loadDay, render, getData };
})();
