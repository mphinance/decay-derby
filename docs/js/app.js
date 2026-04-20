/**
 * App — Main controller, tab routing, dashboard rendering
 */
const App = (() => {
  // Timezone-safe local date formatting (avoids UTC conversion bugs at evening hours)
  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Snap to nearest weekday (forward to Monday on weekends)
  function nearestWeekday() {
    const d = new Date();
    const dow = d.getDay();
    if (dow === 0) d.setDate(d.getDate() + 1); // Sunday → Monday
    if (dow === 6) d.setDate(d.getDate() + 2); // Saturday → Monday
    return localDateStr(d);
  }
  let currentDate = nearestWeekday();

  function init() {
    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Trade log filters
    document.querySelectorAll('.trade-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.trade-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Tracker.renderTradeLog(btn.dataset.filter);
      });
    });

    // First time visitor auto-load portfolio showcase
    if (!localStorage.getItem('decay_derby_visited')) {
      localStorage.setItem('decay_derby_visited', 'true');
      if (Tracker.getTrades().length === 0) {
        Tracker.loadTDPortfolio();
      }
    }

    refresh();
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    // Lazy render tabs
    if (tab === 'picks') loadPicks();
    if (tab === 'trades') Tracker.renderTradeLog('all');
    if (tab === 'export') Substack.render();
  }

  async function loadPicks() {
    document.getElementById('picksDate').textContent = currentDate;
    const data = await Screener.loadDay(currentDate);
    Screener.render(data);
  }

  function prevDay() {
    const d = new Date(currentDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    // Skip weekends
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    currentDate = localDateStr(d);
    loadPicks();
  }

  function nextDay() {
    const d = new Date(currentDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    currentDate = localDateStr(d);
    loadPicks();
  }

  function refresh() {
    renderDashboard();
    // Also refresh current tab if needed
    const activeTab = document.querySelector('.tab-btn.active')?.dataset?.tab;
    if (activeTab === 'picks') loadPicks();
    if (activeTab === 'trades') Tracker.renderTradeLog('all');
    if (activeTab === 'export') Substack.render();
  }

  function renderDashboard() {
    const state = Portfolio.getState();
    const { sectors, totalDeployed } = Portfolio.getSectorExposure();

    // Metrics grid
    document.getElementById('dashMetrics').innerHTML = `
      <div class="metric-card accent-cyan">
        <div class="metric-label">Portfolio Value</div>
        <div class="metric-value value-neutral">${Portfolio.formatCurrency(state.startingCapital)}</div>
        <div class="metric-sub">${Portfolio.formatCurrency(state.capitalDeployed)} deployed</div>
      </div>

      <div class="metric-card accent-green">
        <div class="metric-label">Available Capital</div>
        <div class="metric-value ${state.availableCapital < 1000 ? 'value-negative' : 'value-positive'}">
          ${Portfolio.formatCurrency(state.availableCapital)}
        </div>
        <div class="metric-sub">${(100 - state.allocationPct).toFixed(0)}% free</div>
        <div class="progress-bar">
          <div class="progress-fill green" style="width:${100 - state.allocationPct}%"></div>
        </div>
      </div>

      <div class="metric-card accent-gold">
        <div class="metric-label">Premium Collected</div>
        <div class="metric-value value-positive">${Portfolio.formatCurrency(state.premiumCollected)}</div>
        <div class="metric-sub">${Portfolio.formatPct(state.weeklyROC)} ROC on port</div>
        <div class="progress-bar">
          <div class="progress-fill gold" style="width:${state.premiumProgress}%"></div>
        </div>
        <div class="metric-sub">${Portfolio.formatCurrency(state.premiumCollected)} / ${Portfolio.formatCurrency(state.premiumTarget)} target</div>
      </div>

      <div class="metric-card accent-purple">
        <div class="metric-label">Active Wheels</div>
        <div class="metric-value value-neutral">${state.activeCount}</div>
        <div class="metric-sub">${state.allocationPct.toFixed(0)}% allocated</div>
      </div>

      <div class="metric-card accent-cyan">
        <div class="metric-label">Win Rate</div>
        <div class="metric-value ${state.winRate >= 70 ? 'value-positive' : state.winRate >= 50 ? 'value-neutral' : 'value-negative'}">
          ${state.wins + state.losses > 0 ? Portfolio.formatPct(state.winRate) : '—'}
        </div>
        <div class="metric-sub">${state.wins}W / ${state.losses}L of ${state.totalTrades} total</div>
      </div>
    `;

    // Sector allocation
    const sectorDiv = document.getElementById('sectorAllocation');
    if (Object.keys(sectors).length > 0) {
      let barHtml = '<div class="sector-alloc">';
      let legendHtml = '<div class="sector-legend">';

      Object.entries(sectors).sort((a, b) => b[1].capital - a[1].capital).forEach(([name, data]) => {
        const color = Portfolio.getSectorColor(name);
        const widthPct = totalDeployed > 0 ? (data.capital / totalDeployed) * 100 : 0;
        barHtml += `<div class="sector-alloc-segment" style="width:${widthPct}%;background:${color}" title="${name}: ${widthPct.toFixed(0)}%"></div>`;
        legendHtml += `
          <div class="sector-legend-item">
            <span class="sector-legend-dot" style="background:${color}"></span>
            ${name.split(' ')[0]} ${data.pct.toFixed(0)}% (${Portfolio.formatCurrency(data.capital)})
            ${data.pct > 40 ? '<span style="color:var(--gold)">⚠ Heavy</span>' : ''}
          </div>`;
      });

      barHtml += '</div>';
      legendHtml += '</div>';

      sectorDiv.innerHTML = `
        <div style="margin-bottom:20px">
          <div class="section-title" style="margin-bottom:8px">📊 Sector Exposure</div>
          ${barHtml}${legendHtml}
        </div>`;
    } else {
      sectorDiv.innerHTML = '';
    }

    // Active positions
    const activeDiv = document.getElementById('activePositions');
    document.getElementById('activeCount').textContent = `${state.activeCount} position${state.activeCount !== 1 ? 's' : ''}`;

    if (state.activeTrades.length === 0) {
      activeDiv.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎡</div>
          <div class="empty-state-text">No active wheels</div>
          <div class="empty-state-sub" style="margin-top:6px;font-size:0.7rem;color:var(--text-muted)">
            Go to Today's Picks to start selling puts
          </div>
        </div>`;
    } else {
      activeDiv.innerHTML = state.activeTrades.map(t => {
        const daysLeft = Math.ceil((new Date(t.expiry) - new Date()) / 86400000);
        const premTotal = Portfolio.formatCurrency(t.premium * (t.contracts || 1) * 100);
        const portPct = ((t.collateral / Portfolio.STARTING_CAPITAL) * 100).toFixed(1);

        return `
          <div class="trade-card">
            <div class="trade-card-header">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="trade-ticker">${t.symbol}</span>
                <span class="sector-badge ${Portfolio.getSectorClass(t.sector)}">${(t.sector || '').split(' ')[0]}</span>
                <span class="trade-status status-active">${t.type || 'CSP'}</span>
              </div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:${daysLeft <= 3 ? 'var(--gold)' : 'var(--text-secondary)'}">
                ${daysLeft > 0 ? daysLeft + 'd left' : 'EXPIRING'}
                ${daysLeft <= 0 ? ' <span class="pulse">⏰</span>' : ''}
              </div>
            </div>
            <div class="trade-meta">
              <div class="trade-meta-item"><span class="trade-meta-label">Strike</span> ${Portfolio.formatCurrency(t.strike)}</div>
              <div class="trade-meta-item"><span class="trade-meta-label">Premium</span> <span style="color:var(--green)">${premTotal}</span></div>
              <div class="trade-meta-item"><span class="trade-meta-label">Expiry</span> ${t.expiry}</div>
              <div class="trade-meta-item"><span class="trade-meta-label">Collateral</span> ${Portfolio.formatCurrency(t.collateral)}</div>
              <div class="trade-meta-item"><span class="trade-meta-label">Port</span> ${portPct}%</div>
            </div>
            <div class="trade-actions">
              <button class="btn btn-sm btn-primary" onclick="Tracker.showActionModal('${t.id}')">Update</button>
            </div>
          </div>`;
      }).join('');
    }

    // Weekly summary
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const weekTrades = Tracker.getTrades().filter(t => t.openedAt > weekAgo);
    const weekWins = weekTrades.filter(t => t.status === 'won');
    const weekPremium = weekWins.reduce((s, t) => s + t.premium * (t.contracts || 1) * 100, 0);

    // Build cumulative premium mini-chart
    const allTrades = Tracker.getTrades()
      .filter(t => t.status === 'won' || t.status === 'closed')
      .sort((a, b) => (a.closedAt || a.openedAt).localeCompare(b.closedAt || b.openedAt));

    let chartHtml = '';
    if (allTrades.length > 0) {
      let cumulative = 0;
      const maxTarget = Math.max(Portfolio.PREMIUM_TARGET, state.premiumCollected * 1.2);
      const bars = allTrades.map(t => {
        const prem = t.premium * (t.contracts || 1) * 100;
        cumulative += prem;
        const heightPct = Math.min((cumulative / maxTarget) * 100, 100);
        const date = (t.closedAt || t.openedAt || '').slice(5, 10);
        return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:20px;max-width:40px">
          <div style="font-size:0.5rem;color:var(--text-muted);margin-bottom:2px">${Portfolio.formatCurrency(cumulative)}</div>
          <div style="width:100%;background:var(--bg-dark);border-radius:2px;height:60px;display:flex;align-items:flex-end">
            <div style="width:100%;height:${heightPct}%;background:linear-gradient(180deg,var(--green),var(--cyan));border-radius:2px;min-height:2px"></div>
          </div>
          <div style="font-size:0.45rem;color:var(--text-muted);margin-top:2px">${t.symbol}</div>
        </div>`;
      });

      chartHtml = `
        <div class="metric-card accent-green" style="margin-top:12px">
          <div class="metric-label">Cumulative Premium</div>
          <div style="display:flex;gap:4px;align-items:flex-end;margin-top:8px;padding:0 4px">
            ${bars.join('')}
          </div>
          <div style="margin-top:6px;height:1px;background:var(--border)"></div>
          <div style="display:flex;justify-content:space-between;font-size:0.55rem;color:var(--text-muted);margin-top:4px">
            <span>$0</span>
            <span style="color:var(--gold)">Target: ${Portfolio.formatCurrency(Portfolio.PREMIUM_TARGET)}</span>
          </div>
        </div>`;
    }

    document.getElementById('weeklySummary').innerHTML = `
      <div class="metrics-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <div class="metric-card accent-green">
          <div class="metric-label">Opened</div>
          <div class="metric-value value-neutral">${weekTrades.length}</div>
        </div>
        <div class="metric-card accent-green">
          <div class="metric-label">Wins</div>
          <div class="metric-value value-positive">${weekWins.length}</div>
        </div>
        <div class="metric-card accent-gold">
          <div class="metric-label">Premium This Week</div>
          <div class="metric-value value-positive">${Portfolio.formatCurrency(weekPremium)}</div>
        </div>
        <div class="metric-card accent-cyan">
          <div class="metric-label">Week ROC</div>
          <div class="metric-value value-positive">${Portfolio.formatPct((weekPremium / Portfolio.STARTING_CAPITAL) * 100)}</div>
        </div>
      </div>
      ${chartHtml}`;
  }

  // Init on load
  document.addEventListener('DOMContentLoaded', init);

  return { init, refresh, switchTab, prevDay, nextDay, localDateStr };
})();
