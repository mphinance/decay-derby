/**
 * Screener — loads daily JSON picks and renders the picks table
 */
const Screener = (() => {
  let currentData = null;
  let sortCol = 'score';
  let sortDir = 'desc';
  let filterGrade = 'all';   // 'all' | 'A' | 'B' | 'C'
  let filterAffordable = false;
  let filterSector = 'all';
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

    // Weekly pause banner
    const paused = state.premiumCollected >= Portfolio.PREMIUM_TARGET;
    const pauseBanner = document.getElementById('pauseBanner');
    if (pauseBanner) {
      pauseBanner.style.display = paused ? 'block' : 'none';
      if (paused) {
        pauseBanner.innerHTML = `
          <div style="background:linear-gradient(135deg,rgba(255,200,0,0.15),rgba(255,200,0,0.05));border:1px solid var(--gold);border-radius:var(--radius);padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
            <span style="font-size:1.5rem">🏆</span>
            <div>
              <div style="font-weight:700;color:var(--gold)">Weekly target hit! ${Portfolio.formatCurrency(state.premiumCollected)} collected</div>
              <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:2px">You've crossed the 1% threshold. Pause, reassess, and decide if you want to keep rolling or bank it.</div>
            </div>
          </div>`;
      }
    }

    // Apply filters
    sortedPicks = [...data.picks].filter(p => {
      if (filterGrade !== 'all' && p.grade !== filterGrade) return false;
      if (filterAffordable && !Portfolio.canAfford(p.collateral || p.strike * 100)) return false;
      if (filterSector !== 'all' && p.sector !== filterSector) return false;
      return true;
    });

    // Sort
    sortedPicks.sort((a, b) => {
      const va = a[sortCol] ?? 0;
      const vb = b[sortCol] ?? 0;
      if (typeof va === 'string') return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
      return sortDir === 'desc' ? vb - va : va - vb;
    });

    // Unique sectors for filter
    const sectors = ['all', ...new Set(data.picks.map(p => p.sector).filter(Boolean))];

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
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="font-size:0.65rem;color:var(--text-muted);font-family:'JetBrains Mono',monospace">FILTER:</span>
        ${['all','A','B','C'].map(g => `<button class="filter-chip${filterGrade===g?' active':''}" data-filter-grade="${g}" type="button">${g==='all'?'All Grades':'Grade '+g}</button>`).join('')}
        <span style="width:1px;height:16px;background:var(--border);margin:0 4px"></span>
        <button class="filter-chip${filterAffordable?' active':''}" data-filter-affordable type="button">💰 Can Afford</button>
        <span style="width:1px;height:16px;background:var(--border);margin:0 4px"></span>
        <select class="filter-chip" id="sectorFilter" style="padding:3px 8px;cursor:pointer">
          ${sectors.map(s => `<option value="${s}"${filterSector===s?' selected':''}>${s==='all'?'All Sectors':s.split(' ')[0]}</option>`).join('')}
        </select>
        ${filterGrade!=='all'||filterAffordable||filterSector!=='all'
          ? `<button class="filter-chip" data-filter-clear type="button" style="color:var(--gold)">✕ Clear</button>`
          : ''}
        <span style="margin-left:auto;font-size:0.65rem;color:var(--text-muted)">${sortedPicks.length} of ${data.picks.length} picks</span>
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
    const stats = data.stats || data.summary || {};
    html += `<div style="margin-top:12px;font-size:0.65rem;color:var(--text-muted);font-family:'JetBrains Mono',monospace">
      ${(stats.total_candidates || data.picks.length)} scanned · ${data.picks.length} passed filters · Avg ROC: ${(stats.avg_weekly_roc||0).toFixed(2)}%/wk
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

    // Filter chip events (on the capitalBar container)
    const bar = document.getElementById('capitalBar');
    if (bar) {
      bar.addEventListener('click', (e) => {
        const g = e.target.closest('[data-filter-grade]');
        if (g) { filterGrade = g.dataset.filterGrade; render(data); return; }
        if (e.target.closest('[data-filter-affordable]')) { filterAffordable = !filterAffordable; render(data); return; }
        if (e.target.closest('[data-filter-clear]')) { filterGrade='all'; filterAffordable=false; filterSector='all'; render(data); return; }
      });
      const sel = bar.querySelector('#sectorFilter');
      if (sel) sel.addEventListener('change', (e) => { filterSector = e.target.value; render(data); });
    }
  }

  function getData() { return currentData; }

  return { loadDay, render, getData };
})();
