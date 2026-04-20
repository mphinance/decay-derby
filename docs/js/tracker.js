/**
 * Tracker — Trade lifecycle, localStorage persistence, wheel state machine
 */
const Tracker = (() => {
  const STORAGE_KEY = 'decay_derby_trades';
  const BACKUP_KEY = 'decay_derby_trades_backup';
  let mutationCount = 0;

  function getTrades() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn('Trades data corrupted (not array), restoring from backup');
        return _restoreFromBackup();
      }
      return parsed;
    } catch (e) {
      console.error('Failed to read trades:', e);
      return _restoreFromBackup();
    }
  }

  function _restoreFromBackup() {
    try {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (backup) {
        const data = JSON.parse(backup);
        if (Array.isArray(data)) {
          localStorage.setItem(STORAGE_KEY, backup);
          console.info('Restored', data.length, 'trades from backup');
          return data;
        }
      }
    } catch (e) { console.error('Backup also corrupted:', e); }
    return [];
  }

  function saveTrades(trades) {
    try {
      const json = JSON.stringify(trades);
      localStorage.setItem(STORAGE_KEY, json);

      // Auto-backup every 5 mutations
      mutationCount++;
      if (mutationCount % 5 === 0) {
        localStorage.setItem(BACKUP_KEY, json);
        console.info(`Auto-backup saved (${trades.length} trades, mutation #${mutationCount})`);
      }
    } catch (e) {
      console.error('Failed to save trades:', e);
      if (e.name === 'QuotaExceededError') {
        alert('localStorage is full! Please export your trades (Trade Log → Export) and clear some browser data.');
      }
    }
  }

  function addTrade(trade) {
    const trades = getTrades();
    trade.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    trade.openedAt = new Date().toISOString();
    trade.status = 'active';
    trade.type = trade.type || 'CSP';
    trade.contracts = parseInt(trade.contracts) || 1;
    trade.fees = parseFloat(trade.fees) || 0;
    trade.collateral = trade.strike * 100 * trade.contracts;
    trades.push(trade);
    saveTrades(trades);
    return trade;
  }

  function updateTrade(id, updates) {
    const trades = getTrades();
    const idx = trades.findIndex(t => t.id === id);
    if (idx === -1) return null;
    Object.assign(trades[idx], updates);
    saveTrades(trades);
    return trades[idx];
  }

  function deleteTrade(id) {
    const trades = getTrades().filter(t => t.id !== id);
    saveTrades(trades);
  }

  // State transitions
  function expireTrade(id) {
    const trade = getTrades().find(t => t.id === id);
    if (!trade) return null;
    const pnl = (trade.premium * 100 * trade.contracts) - (trade.fees || 0);
    return updateTrade(id, {
      status: 'won',
      closedAt: new Date().toISOString(),
      closeReason: 'expired',
      pnl,
    });
  }

  function closeTrade(id, closePrice, closeFees) {
    const trade = getTrades().find(t => t.id === id);
    if (!trade) return null;
    const totalFees = (trade.fees || 0) + (closeFees || 0);
    const pnl = ((trade.premium - closePrice) * 100 * trade.contracts) - totalFees;
    return updateTrade(id, {
      status: pnl >= 0 ? 'won' : 'loss',
      closedAt: new Date().toISOString(),
      closeReason: 'closed',
      closePrice,
      fees: totalFees,
      pnl,
    });
  }

  function assignTrade(id) {
    const trade = getTrades().find(t => t.id === id);
    if (!trade) return null;

    const pnl = (trade.premium * 100 * trade.contracts) - (trade.fees || 0);
    
    // Mark CSP as assigned
    updateTrade(id, {
      status: 'assigned',
      closedAt: new Date().toISOString(),
      closeReason: 'assigned',
      pnl,
    });

    // Auto-transition: open Covered Call template for this symbol
    // Strike defaults to CSP strike (cost basis target)
    _showCoveredCallTemplate(trade);

    return trade;
  }

  function _showCoveredCallTemplate(cspTrade) {
    const form = document.getElementById('tradeForm');
    const suggestedStrike = cspTrade.strike; // Sell CC at cost basis

    form.innerHTML = `
      <div class="form-group">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:1.4rem;font-weight:700;color:var(--gold)">${cspTrade.symbol}</span>
          <span class="trade-status status-assigned">ASSIGNED → CC</span>
        </div>
        <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:16px">
          You now own 100 shares at $${cspTrade.strike.toFixed(2)}. Sell a covered call to start the wheel!
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">CC Strike (cost basis: $${cspTrade.strike.toFixed(2)})</label>
          <input type="number" class="form-input" id="f-cc-strike" value="${suggestedStrike}" step="0.5">
        </div>
        <div class="form-group">
          <label class="form-label">CC Premium (per share)</label>
          <input type="number" class="form-input" id="f-cc-premium" step="0.01" placeholder="0.15">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Expiry</label>
          <input type="date" class="form-input" id="f-cc-expiry">
        </div>
        <div class="form-group">
          <label class="form-label">Contracts</label>
          <input type="number" class="form-input" id="f-cc-contracts" value="${cspTrade.contracts || 1}" min="1" max="10">
        </div>
      </div>
      <div class="form-hint" style="margin-bottom:12px">
        The wheel continues! Sell the CC at or above your cost basis ($${cspTrade.strike.toFixed(2)}) to recover the assignment.
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" type="button" onclick="Tracker.confirmCoveredCall('${cspTrade.symbol}', '${cspTrade.sector}', '${cspTrade.name || cspTrade.symbol}')">🔄 Open Covered Call</button>
        <button class="btn btn-ghost" type="button" onclick="Tracker.closeModal()">Skip for now</button>
      </div>
    `;

    document.getElementById('tradeModal').classList.add('active');
  }

  function confirmCoveredCall(symbol, sector, name) {
    const form = document.getElementById('tradeForm');
    const strike = parseFloat(form.querySelector('#f-cc-strike').value);
    const premium = parseFloat(form.querySelector('#f-cc-premium').value);
    const expiry = form.querySelector('#f-cc-expiry').value;
    const contracts = parseInt(form.querySelector('#f-cc-contracts').value) || 1;

    if (!strike || !premium || !expiry) {
      alert('Fill in strike, premium, and expiry');
      return;
    }

    addTrade({
      symbol, sector, name, strike, premium, expiry, contracts,
      type: 'CC', // Covered Call
    });
    closeModal();
    App.refresh();
  }

  // UI: Open trade from screener pick
  function openTradeFromPick(pick) {
    const form = document.getElementById('tradeForm');

    // Pre-trade sector impact analysis
    const { sectors, totalDeployed } = Portfolio.getSectorExposure();
    const currentSectorCap = sectors[pick.sector]?.capital || 0;
    const newCollateral = pick.strike * 100;
    const projectedSectorCap = currentSectorCap + newCollateral;
    const projectedTotalDeployed = totalDeployed + newCollateral;
    const currentPct = totalDeployed > 0 ? (currentSectorCap / Portfolio.STARTING_CAPITAL) * 100 : 0;
    const projectedPct = (projectedSectorCap / Portfolio.STARTING_CAPITAL) * 100;
    const isHeavy = projectedPct > 40;

    const sectorImpactHtml = `
      <div style="padding:10px 12px;border-radius:var(--radius-sm);margin-bottom:12px;font-size:0.7rem;
        background:${isHeavy ? 'var(--gold-bg)' : 'var(--bg-dark)'};
        border:1px solid ${isHeavy ? 'rgba(240,180,0,0.3)' : 'var(--border)'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:var(--text-muted)">Sector Impact: <strong style="color:var(--text-primary)">${pick.sector}</strong></span>
          <span style="color:${isHeavy ? 'var(--gold)' : 'var(--green)'}">
            ${currentPct.toFixed(0)}% → ${projectedPct.toFixed(0)}%
            ${isHeavy ? ' ⚠ HEAVY' : ' ✓'}
          </span>
        </div>
        <div style="height:4px;background:var(--bg-deepest);border-radius:2px;margin-top:6px;overflow:hidden">
          <div style="height:100%;width:${Math.min(projectedPct, 100)}%;background:${isHeavy ? 'var(--gold)' : 'var(--green)'};border-radius:2px;transition:width 0.3s"></div>
        </div>
      </div>`;

    form.innerHTML = `
      <div class="form-group">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <span style="font-size:1.4rem;font-weight:700;color:var(--gold)">${pick.symbol}</span>
          <span class="sector-badge ${Portfolio.getSectorClass(pick.sector)}">${pick.sector}</span>
          ${Portfolio.isSectorHeavy(pick.sector) ? '<span class="sector-warn">⚠ Heavy</span>' : ''}
        </div>
      </div>
      ${sectorImpactHtml}
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Strike</label>
          <input type="number" class="form-input" id="f-strike" value="${pick.strike}" step="0.5">
        </div>
        <div class="form-group">
          <label class="form-label">Premium (per share)</label>
          <input type="number" class="form-input" id="f-premium" value="${pick.premium}" step="0.01">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Expiry</label>
          <input type="date" class="form-input" id="f-expiry" value="${pick.expiry}">
        </div>
        <div class="form-group">
          <label class="form-label">Contracts</label>
          <input type="number" class="form-input" id="f-contracts" value="1" min="1" max="100">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Fees (total, e.g. $0.65)</label>
        <input type="number" class="form-input" id="f-fees" value="0.65" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">Collateral Required</label>
        <div id="f-collateral" style="font-family:'JetBrains Mono',monospace;font-size:1.1rem;font-weight:700;color:var(--cyan)">
          ${Portfolio.formatCurrency(pick.strike * 100)}
        </div>
        <div class="form-hint">
          Premium collected: ${Portfolio.formatCurrency(pick.premium * 100)}
          · ROC: ${pick.weekly_roc}%/wk
          · Port alloc: ${((pick.strike * 100 / Portfolio.STARTING_CAPITAL) * 100).toFixed(1)}%
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn btn-success" type="button" onclick="Tracker.confirmTrade('${pick.symbol}', '${pick.sector}', '${pick.name}')">✅ I Sold This Put</button>
        <button class="btn btn-ghost" type="button" onclick="Tracker.closeModal()">Cancel</button>
      </div>
    `;

    // Update collateral on strike/contract change
    ['f-strike', 'f-contracts'].forEach(id => {
      form.querySelector('#' + id).addEventListener('input', () => {
        const s = parseFloat(form.querySelector('#f-strike').value) || 0;
        const c = parseInt(form.querySelector('#f-contracts').value) || 1;
        form.querySelector('#f-collateral').textContent = Portfolio.formatCurrency(s * 100 * c);
      });
    });

    document.getElementById('tradeModal').classList.add('active');
  }

  function confirmTrade(symbol, sector, name) {
    const form = document.getElementById('tradeForm');
    const strike = parseFloat(form.querySelector('#f-strike').value);
    const premium = parseFloat(form.querySelector('#f-premium').value);
    const expiry = form.querySelector('#f-expiry').value;
    const contracts = parseInt(form.querySelector('#f-contracts').value) || 1;
    const fees = parseFloat(form.querySelector('#f-fees').value) || 0;

    if (!strike || !premium || !expiry) {
      alert('Fill in all fields');
      return;
    }

    addTrade({ symbol, sector, name, strike, premium, expiry, contracts, fees });
    closeModal();
    App.refresh();
  }

  function closeModal() {
    document.getElementById('tradeModal').classList.remove('active');
  }

  // Trade action modal (expire, assign, close)
  function showActionModal(tradeId) {
    const trade = getTrades().find(t => t.id === tradeId);
    if (!trade) return;

    document.getElementById('actionModalTitle').textContent = `${trade.symbol} — ${trade.type}`;
    const form = document.getElementById('actionForm');

    form.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:0.8rem;color:var(--text-secondary)">
          Strike: ${Portfolio.formatCurrency(trade.strike)} · Premium: ${Portfolio.formatCurrency(trade.premium)}
          · Expiry: ${trade.expiry}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-success" onclick="Tracker.expireTrade('${tradeId}');Tracker.closeActionModal();App.refresh()">
          ✅ Expired Worthless (Win!)
        </button>
        <button class="btn btn-primary" onclick="Tracker.showClosePrice('${tradeId}')">
          🔄 Bought to Close
        </button>
        <button class="btn btn-danger" onclick="Tracker.assignTrade('${tradeId}');Tracker.closeActionModal();App.refresh()">
          📦 Got Assigned
        </button>
        <hr style="border-color:var(--border);margin:8px 0">
        <button class="btn btn-ghost btn-sm" onclick="Tracker.deleteTrade('${tradeId}');Tracker.closeActionModal();App.refresh()">
          🗑 Delete Trade
        </button>
      </div>
      <div id="closePriceSection" style="display:none;margin-top:16px">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Close Price (per share)</label>
            <input type="number" class="form-input" id="f-close-price" step="0.01" placeholder="0.05">
          </div>
          <div class="form-group">
            <label class="form-label">Close Fees</label>
            <input type="number" class="form-input" id="f-close-fees" value="0.65" step="0.01">
          </div>
        </div>
        <button class="btn btn-primary" onclick="Tracker.doClose('${tradeId}')">Confirm Close</button>
      </div>
    `;

    document.getElementById('actionModal').classList.add('active');
  }

  function showClosePrice(tradeId) {
    document.getElementById('closePriceSection').style.display = 'block';
  }

  function doClose(tradeId) {
    const price = parseFloat(document.getElementById('f-close-price').value);
    const fees = parseFloat(document.getElementById('f-close-fees').value) || 0;
    if (isNaN(price)) { alert('Enter close price'); return; }
    closeTrade(tradeId, price, fees);
    closeActionModal();
    App.refresh();
  }

  function closeActionModal() {
    document.getElementById('actionModal').classList.remove('active');
  }

  // Manual trade entry
  function showManualEntry() {
    const form = document.getElementById('tradeForm');
    form.innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Symbol</label>
          <input type="text" class="form-input" id="f-symbol" placeholder="ONDS">
        </div>
        <div class="form-group">
          <label class="form-label">Sector</label>
          <select class="form-input" id="f-sector">
            <option value="Electronic Technology">Electronic Technology</option>
            <option value="Technology Services">Technology Services</option>
            <option value="Finance">Finance</option>
            <option value="Producer Manufacturing">Producer Mfg</option>
            <option value="Non-Energy Minerals">Non-Energy Minerals</option>
            <option value="Retail Trade">Retail Trade</option>
            <option value="Energy Minerals">Energy Minerals</option>
            <option value="Communications">Communications</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Strike</label>
          <input type="number" class="form-input" id="f-strike" step="0.5" placeholder="9.50">
        </div>
        <div class="form-group">
          <label class="form-label">Premium (per share)</label>
          <input type="number" class="form-input" id="f-premium" step="0.01" placeholder="0.26">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Expiry</label>
          <input type="date" class="form-input" id="f-expiry">
        </div>
        <div class="form-group">
          <label class="form-label">Contracts</label>
          <input type="number" class="form-input" id="f-contracts" value="1" min="1">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Fees (total)</label>
        <input type="number" class="form-input" id="f-fees" value="0.65" step="0.01">
      </div>
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn btn-success" onclick="Tracker.confirmManual()">✅ Add Trade</button>
        <button class="btn btn-ghost" onclick="Tracker.closeModal()">Cancel</button>
      </div>
    `;
    document.getElementById('tradeModal').classList.add('active');
  }

  function showEditModal(tradeId) {
    const trade = getTrades().find(t => t.id === tradeId);
    if (!trade) return;

    const form = document.getElementById('tradeForm');
    form.innerHTML = `
      <div style="font-size:1.2rem;font-weight:700;margin-bottom:16px;color:var(--gold)">Edit Trade: ${trade.symbol}</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Symbol</label>
          <input type="text" class="form-input" id="f-symbol" value="${trade.symbol}">
        </div>
        <div class="form-group">
          <label class="form-label">Strike</label>
          <input type="number" class="form-input" id="f-strike" step="0.5" value="${trade.strike}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Upfront Premium</label>
          <input type="number" class="form-input" id="f-premium" step="0.01" value="${trade.premium}">
        </div>
        <div class="form-group">
          <label class="form-label">Total Fees</label>
          <input type="number" class="form-input" id="f-fees" step="0.01" value="${trade.fees || 0}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Contracts</label>
          <input type="number" class="form-input" id="f-contracts" min="1" value="${trade.contracts || 1}">
        </div>
        ${trade.closePrice !== undefined ? `
        <div class="form-group">
          <label class="form-label">Close Price</label>
          <input type="number" class="form-input" id="f-close-price" step="0.01" value="${trade.closePrice}">
        </div>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn btn-success" type="button" onclick="Tracker.saveTradeEdit('${trade.id}')">💾 Save Changes</button>
        <button class="btn btn-ghost" type="button" onclick="Tracker.closeModal()">Cancel</button>
      </div>
    `;
    document.getElementById('tradeModal').classList.add('active');
  }

  function saveTradeEdit(id) {
    const form = document.getElementById('tradeForm');
    const symbol = form.querySelector('#f-symbol').value.toUpperCase();
    const strike = parseFloat(form.querySelector('#f-strike').value);
    const premium = parseFloat(form.querySelector('#f-premium').value);
    const fees = parseFloat(form.querySelector('#f-fees').value) || 0;
    const contracts = parseInt(form.querySelector('#f-contracts').value) || 1;
    const closePriceInput = form.querySelector('#f-close-price');
    
    const trade = getTrades().find(t => t.id === id);
    if (!trade) return;

    trade.symbol = symbol;
    trade.strike = strike;
    trade.premium = premium;
    trade.fees = fees;
    trade.contracts = contracts;
    trade.collateral = strike * 100 * contracts;
    
    if (closePriceInput) {
      trade.closePrice = parseFloat(closePriceInput.value) || 0;
    }
    
    if (trade.status !== 'active') {
       if (trade.closeReason === 'closed') {
         trade.pnl = ((trade.premium - trade.closePrice) * 100 * trade.contracts) - (trade.fees || 0);
         trade.status = trade.pnl >= 0 ? 'won' : 'loss';
       } else {
         trade.pnl = (trade.premium * 100 * trade.contracts) - (trade.fees || 0);
       }
    }
    
    updateTrade(id, trade);
    closeModal();
    App.refresh();
  }

  function confirmManual() {
    const form = document.getElementById('tradeForm');
    const symbol = form.querySelector('#f-symbol').value.toUpperCase();
    const sector = form.querySelector('#f-sector').value;
    const strike = parseFloat(form.querySelector('#f-strike').value);
    const premium = parseFloat(form.querySelector('#f-premium').value);
    const expiry = form.querySelector('#f-expiry').value;
    const contracts = parseInt(form.querySelector('#f-contracts').value) || 1;
    const fees = parseFloat(form.querySelector('#f-fees').value) || 0;

    if (!symbol || !strike || !premium || !expiry) {
      alert('Fill in all fields');
      return;
    }

    addTrade({ symbol, sector, name: symbol, strike, premium, expiry, contracts, fees });
    closeModal();
    App.refresh();
  }

  // Export / Import / Showcase
  async function loadTDPortfolio() {
    try {
      const res = await fetch('data/portfolio.json');
      if (!res.ok) throw new Error('Failed to load portfolio.json');
      const data = await res.json();
      if (Array.isArray(data)) {
        saveTrades(data);
        App.refresh();
      }
    } catch (e) {
      console.warn('Could not load TD portfolio showcase:', e);
    }
  }

  function exportTrades() {
    const data = JSON.stringify(getTrades(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decay-derby-trades-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importTrades() {
    document.getElementById('importModal').classList.add('active');
  }

  function doImport() {
    try {
      const data = JSON.parse(document.getElementById('importData').value);
      if (Array.isArray(data)) {
        saveTrades(data);
        document.getElementById('importModal').classList.remove('active');
        App.refresh();
      } else {
        alert('Invalid format — expected JSON array');
      }
    } catch (e) {
      alert('Invalid JSON: ' + e.message);
    }
  }

  // Render trade log
  function renderTradeLog(filter = 'all') {
    const trades = getTrades();
    const filtered = filter === 'all' ? trades : trades.filter(t => t.status === filter);
    const container = document.getElementById('tradeLog');

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-text">No trades yet</div>
          <div class="empty-state-sub" style="margin-top:6px;font-size:0.7rem;color:var(--text-muted)">
            Head to Today's Picks and sell some puts!
          </div>
        </div>`;
      return;
    }

    container.innerHTML = filtered.map(t => {
      const statusClass = t.status === 'active' ? 'status-active' :
        t.status === 'won' ? 'status-won' :
        t.status === 'assigned' ? 'status-assigned' : 'status-loss';
      const statusLabel = t.status.charAt(0).toUpperCase() + t.status.slice(1);
      const premiumTotal = Portfolio.formatCurrency(t.premium * (t.contracts || 1) * 100);
      const portPct = ((t.collateral / Portfolio.STARTING_CAPITAL) * 100).toFixed(1);
      const daysHeld = Math.floor((new Date(t.closedAt || Date.now()) - new Date(t.openedAt)) / 86400000);

      return `
        <div class="trade-card">
          <div class="trade-card-header">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="trade-ticker">${t.symbol}</span>
              <span class="sector-badge ${Portfolio.getSectorClass(t.sector)}">${t.sector || ''}</span>
            </div>
            <span class="trade-status ${statusClass}">${statusLabel}</span>
          </div>
          <div class="trade-meta">
            <div class="trade-meta-item">
              <span class="trade-meta-label">Strike</span> ${Portfolio.formatCurrency(t.strike)}
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">Contracts</span> ${t.contracts}
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">${t.status==='active' ? 'Prem Collect' : 'Net P/L'}</span>
              <span style="color:${t.status!=='active' && t.pnl<0 ? 'var(--red)' : 'var(--green)'}">
                ${t.status==='active' ? premiumTotal : Portfolio.formatCurrency(t.pnl)}
              </span>
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">Fees</span> ${Portfolio.formatCurrency(t.fees || 0)}
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">Expiry</span> ${t.expiry}
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">Collateral</span> ${Portfolio.formatCurrency(t.collateral)}
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">Port %</span> ${portPct}%
            </div>
            <div class="trade-meta-item">
              <span class="trade-meta-label">Days</span> ${daysHeld}
            </div>
          </div>
          <div class="trade-actions" style="margin-top:12px;display:flex;gap:8px">
            ${t.status === 'active' ? `<button class="btn btn-sm btn-primary" onclick="Tracker.showActionModal('${t.id}')">Update</button>` : ''}
            <button class="btn btn-sm btn-ghost" onclick="Tracker.showEditModal('${t.id}')">Edit</button>
            <button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="if(confirm('Are you sure you want to delete this trade?')) { Tracker.deleteTrade('${t.id}'); App.refresh(); }">🗑</button>
          </div>
        </div>`;
    }).join('');
  }

  return {
    getTrades, saveTrades, addTrade, updateTrade, deleteTrade,
    expireTrade, closeTrade, assignTrade, confirmCoveredCall,
    openTradeFromPick, confirmTrade, closeModal,
    showActionModal, showClosePrice, doClose, closeActionModal,
    showManualEntry, confirmManual, showEditModal, saveTradeEdit,
    exportTrades, importTrades, doImport, loadTDPortfolio,
    renderTradeLog,
  };
})();
