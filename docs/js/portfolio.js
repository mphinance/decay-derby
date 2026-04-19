/**
 * Portfolio — Capital tracking, allocation math, sector intelligence
 */
const Portfolio = (() => {
  const STARTING_CAPITAL = 10000;
  const PREMIUM_TARGET = 100; // 1% of port
  const MIN_ALLOC = 0.10;
  const MAX_ALLOC = 0.30;

  const SECTOR_COLORS = {
    'Electronic Technology': '#4dd8ff',
    'Technology Services': '#00d4ff',
    'Finance': '#4dffaa',
    'Producer Manufacturing': '#ffbb55',
    'Non-Energy Minerals': '#b77dff',
    'Retail Trade': '#ff8888',
    'Energy Minerals': '#f5c842',
    'Communications': '#ff88cc',
    'Health Technology': '#88ff88',
  };

  const SECTOR_CSS = {
    'Electronic Technology': 'sector-tech',
    'Technology Services': 'sector-tech',
    'Finance': 'sector-finance',
    'Producer Manufacturing': 'sector-mfg',
    'Non-Energy Minerals': 'sector-minerals',
    'Retail Trade': 'sector-retail',
    'Energy Minerals': 'sector-energy',
    'Communications': 'sector-tech',
  };

  function getState() {
    const trades = Tracker.getTrades();
    const active = trades.filter(t => t.status === 'active' || t.status === 'assigned');
    const closed = trades.filter(t => t.status === 'won' || t.status === 'loss' || t.status === 'closed');

    const capitalDeployed = active.reduce((sum, t) => sum + (t.collateral || 0), 0);
    const availableCapital = STARTING_CAPITAL - capitalDeployed;
    const allocationPct = (capitalDeployed / STARTING_CAPITAL) * 100;

    const premiumCollected = trades
      .filter(t => t.status === 'won' || t.status === 'closed')
      .reduce((sum, t) => sum + (t.premium * (t.contracts || 1) * 100), 0);

    const premiumActive = active
      .filter(t => t.type === 'CSP')
      .reduce((sum, t) => sum + (t.premium * (t.contracts || 1) * 100), 0);

    const wins = closed.filter(t => t.status === 'won').length;
    const losses = closed.filter(t => t.status === 'loss').length;
    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

    const weeklyROC = (premiumCollected / STARTING_CAPITAL) * 100;

    return {
      startingCapital: STARTING_CAPITAL,
      capitalDeployed,
      availableCapital,
      allocationPct,
      premiumCollected,
      premiumActive,
      premiumTarget: PREMIUM_TARGET,
      premiumProgress: Math.min((premiumCollected / PREMIUM_TARGET) * 100, 100),
      activeCount: active.length,
      totalTrades: trades.length,
      wins,
      losses,
      winRate,
      weeklyROC,
      activeTrades: active,
      closedTrades: closed,
    };
  }

  function getSectorExposure() {
    const trades = Tracker.getTrades().filter(t => t.status === 'active' || t.status === 'assigned');
    const sectors = {};
    let totalDeployed = 0;

    trades.forEach(t => {
      const s = t.sector || 'Unknown';
      if (!sectors[s]) sectors[s] = { count: 0, capital: 0 };
      sectors[s].count++;
      sectors[s].capital += (t.collateral || 0);
      totalDeployed += (t.collateral || 0);
    });

    // Calculate percentages
    Object.keys(sectors).forEach(s => {
      sectors[s].pct = totalDeployed > 0 ? (sectors[s].capital / totalDeployed) * 100 : 0;
    });

    return { sectors, totalDeployed };
  }

  function isSectorHeavy(sector) {
    const { sectors } = getSectorExposure();
    if (!sectors[sector]) return false;
    // Flag if >40% in one sector
    return sectors[sector].pct > 40;
  }

  function canAfford(capitalRequired) {
    const { availableCapital } = getState();
    return capitalRequired <= availableCapital;
  }

  function fitsAllocation(capitalRequired) {
    const { availableCapital } = getState();
    const maxForThisTrade = STARTING_CAPITAL * MAX_ALLOC;
    return capitalRequired <= maxForThisTrade && capitalRequired <= availableCapital;
  }

  function suggestedPositionSize() {
    const { availableCapital } = getState();
    return {
      min: Math.floor(availableCapital * MIN_ALLOC),
      max: Math.floor(availableCapital * MAX_ALLOC),
      ideal: Math.floor(availableCapital * 0.20), // 20% sweet spot
    };
  }

  function getSectorColor(sector) {
    return SECTOR_COLORS[sector] || '#9999bb';
  }

  function getSectorClass(sector) {
    return SECTOR_CSS[sector] || 'sector-default';
  }

  function formatCurrency(val) {
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(val) {
    return val.toFixed(2) + '%';
  }

  return {
    getState, getSectorExposure, isSectorHeavy, canAfford,
    fitsAllocation, suggestedPositionSize, getSectorColor,
    getSectorClass, formatCurrency, formatPct,
    STARTING_CAPITAL, PREMIUM_TARGET, SECTOR_COLORS,
  };
})();
