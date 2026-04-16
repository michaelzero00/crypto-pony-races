/* ============================================================
   CRYPTO PONY — Game Logic v3
   ============================================================ */

(function () {

  /* --- Constants -------------------------------------------- */
  const RACE_DURATION_SEC = 60;
  const TICK_MS           = 2000;
  const TIMER_TICK_MS     = 1000;
  const URGENT_THRESHOLD  = 10;
  const TRACK_LEFT        = 2;
  const TRACK_RIGHT       = 88;
  const MARKET_FACTOR     = 0.30;
  const RETURN_SCALING    = 350;
  const RACE_TICKS        = RACE_DURATION_SEC * 1000 / TICK_MS; // 30
  const BASE_SPEED        = (TRACK_RIGHT - TRACK_LEFT) * 0.5 / RACE_TICKS;
  const WAGER             = 1.00; // $1 per bet type

  /* --- Token Config ----------------------------------------- */
  const TOKENS = [
    { symbol: 'BTC',  name: 'Bitcoin',   emoji: '🐴', vol: 0.008, color: '#f7931a' },
    { symbol: 'ETH',  name: 'Ethereum',  emoji: '🦄', vol: 0.010, color: '#627eea' },
    { symbol: 'SOL',  name: 'Solana',    emoji: '🏇', vol: 0.018, color: '#9945ff' },
    { symbol: 'BNB',  name: 'BNB',       emoji: '🐎', vol: 0.012, color: '#f3ba2f' },
    { symbol: 'ADA',  name: 'Cardano',   emoji: '🦓', vol: 0.015, color: '#0055ff' },
    { symbol: 'DOGE', name: 'Dogecoin',  emoji: '🐕', vol: 0.025, color: '#c2a633' },
    { symbol: 'XRP',  name: 'Ripple',    emoji: '🌊', vol: 0.011, color: '#00aae4' },
    { symbol: 'AVAX', name: 'Avalanche', emoji: '🔺', vol: 0.020, color: '#e84142' },
  ];

  function volTier(vol) {
    if (vol >= 0.020) return { label: 'WILD',   color: '#ff3366', bars: 4 };
    if (vol >= 0.015) return { label: 'HIGH',   color: '#ff8c00', bars: 3 };
    if (vol >= 0.011) return { label: 'MEDIUM', color: '#ffd700', bars: 2 };
    return                   { label: 'STABLE', color: '#00ff88', bars: 1 };
  }

  /* --- Monte Carlo Odds -------------------------------------- */

  // Storage for precomputed probabilities (filled by precomputeOdds())
  const precomputed = {
    winProb:   new Array(TOKENS.length).fill(0),
    placeProb: new Array(TOKENS.length).fill(0),
    triFreq:   new Map(),   // key: "i,j,k" → count
    numTrials: 0,
  };

  // Simulate a single 60-second race; returns token indices ranked best→worst
  function simulateOneRace() {
    const pos = new Array(TOKENS.length).fill(TRACK_LEFT);
    for (let tick = 0; tick < RACE_TICKS; tick++) {
      const mkt = randNormal() * MARKET_FACTOR;
      TOKENS.forEach((token, i) => {
        const idio = randNormal() * (1 - MARKET_FACTOR);
        const r    = (mkt + idio) * token.vol;
        pos[i]     = Math.min(TRACK_RIGHT, pos[i] + Math.max(0, BASE_SPEED + RETURN_SCALING * r));
      });
    }
    return pos
      .map((p, i) => ({ p, i }))
      .sort((a, b) => b.p - a.p)
      .map(x => x.i);
  }

  // Run numTrials simulated races to populate precomputed odds
  function precomputeOdds(numTrials = 3000) {
    const winCounts   = new Array(TOKENS.length).fill(0);
    const placeCounts = new Array(TOKENS.length).fill(0);
    const triFreq     = new Map();

    for (let t = 0; t < numTrials; t++) {
      const ranked = simulateOneRace();
      winCounts[ranked[0]]++;
      placeCounts[ranked[0]]++;
      placeCounts[ranked[1]]++;
      placeCounts[ranked[2]]++;
      const key = `${ranked[0]},${ranked[1]},${ranked[2]}`;
      triFreq.set(key, (triFreq.get(key) || 0) + 1);
    }

    precomputed.numTrials = numTrials;
    precomputed.triFreq   = triFreq;
    for (let i = 0; i < TOKENS.length; i++) {
      precomputed.winProb[i]   = winCounts[i]   / numTrials;
      precomputed.placeProb[i] = placeCounts[i] / numTrials;
    }
  }

  // Convert a profit multiplier (e.g. 2.5 = 5/2) to a bookmaker fractional string
  function profitToFractional(profit) {
    // Standard fractional odds bookmakers use
    const fracs = [
      [1,5],[1,4],[1,3],[2,5],[1,2],[3,5],[2,3],[4,5],[1,1],
      [5,4],[11,8],[6,4],[13,8],[7,4],[9,4],[5,2],[11,4],[3,1],
      [7,2],[4,1],[9,2],[5,1],[6,1],[7,1],[8,1],[9,1],[10,1],
      [12,1],[14,1],[16,1],[20,1],[25,1],[33,1],[50,1],[66,1],[100,1],
    ];
    let best = fracs[0], bestDiff = Infinity;
    for (const f of fracs) {
      const diff = Math.abs(f[0] / f[1] - profit);
      if (diff < bestDiff) { bestDiff = diff; best = f; }
    }
    return `${best[0]}/${best[1]}`;
  }

  // Display odds string shown on the card (e.g. "5/2")
  function formatOdds(symbol) {
    const i = TOKENS.findIndex(t => t.symbol === symbol);
    if (i === -1 || precomputed.numTrials === 0) return '—';
    const p = precomputed.winProb[i] || 0.001;
    const fairProfit = (1 / p) - 1;
    const marginnedProfit = fairProfit * 0.85;  // 15% house margin
    return profitToFractional(marginnedProfit);
  }

  /* --- Payout Calculations ---------------------------------- */

  // Win: horse must finish 1st. Uses MC win probability with 15% house margin.
  function calcWinPayout(symbol) {
    const i = TOKENS.findIndex(t => t.symbol === symbol);
    if (i === -1) return 0;
    const p             = precomputed.winProb[i] || (1 / TOKENS.length);
    const fairProfit    = (1 / p) - 1;
    const marginnedDecimal = 1 + fairProfit * 0.85;
    return WAGER * marginnedDecimal;
  }

  // Place: top 3. UK each-way standard — 1/4 of win fractional profit.
  function calcPlacePayout(symbol) {
    const i = TOKENS.findIndex(t => t.symbol === symbol);
    if (i === -1) return 0;
    const p             = precomputed.winProb[i] || (1 / TOKENS.length);
    const fairProfit    = (1 / p) - 1;
    const winProfit     = fairProfit * 0.85;    // marginned win profit
    const placeDecimal  = 1 + winProfit / 4;    // 1/4 of win profit, UK style
    return WAGER * placeDecimal;
  }

  // Trifecta: exact 1-2-3. Uses MC trifecta frequency with 25% house margin.
  function calcTrifectaPayout(symbols) {
    if (!symbols || symbols.some(s => !s)) return 0;
    const idxs = symbols.map(s => TOKENS.findIndex(t => t.symbol === s));
    if (idxs.some(i => i === -1)) return 0;

    const key   = idxs.join(',');
    const freq  = precomputed.triFreq.get(key) || 0;
    const n     = precomputed.numTrials || 1;

    // If combination never observed, estimate from win probs (rare combos → big payout)
    let p;
    if (freq === 0) {
      // Approximate: product of individual win probs (loose lower-bound estimate)
      p = Math.max(0.0005, idxs.reduce((acc, i) => acc * (precomputed.winProb[i] || 1 / TOKENS.length), 1));
    } else {
      p = freq / n;
    }

    const fairProfit       = (1 / p) - 1;
    const marginnedDecimal = 1 + fairProfit * 0.75;  // 25% house margin
    return Math.min(WAGER * marginnedDecimal, WAGER * 2000); // cap at $2000
  }

  function isTrifectaComplete() {
    return state.bets.trifecta.every(s => s !== null);
  }

  function hasAnyBet() {
    return !!(state.bets.win || state.bets.place || state.bets.trifecta.some(s => s));
  }

  /* --- State ------------------------------------------------- */
  const state = {
    phase:        'lobby',
    activeBetTab: 'win',        // 'win' | 'place' | 'trifecta'
    bets: {
      win:      null,           // symbol | null
      place:    null,           // symbol | null
      trifecta: [null, null, null],  // [1st, 2nd, 3rd] symbols
    },
    horses:        [],
    raceStartTime: null,
    tickHandle:    null,
    timerHandle:   null,
    rafHandle:     null,        // requestAnimationFrame handle
    lastFrameTime: null,        // timestamp of previous rAF frame
  };

  /* --- Price Simulation -------------------------------------- */

  function randNormal() {
    let u, v;
    do { u = Math.random(); } while (!u);
    do { v = Math.random(); } while (!v);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function generateReturns() {
    const marketShock = randNormal() * MARKET_FACTOR;
    return state.horses.map(horse => {
      const idio = randNormal() * (1 - MARKET_FACTOR);
      return (marketShock + idio) * horse.vol;
    });
  }

  /* --- State Machine ----------------------------------------- */

  function initHorses() {
    state.horses = TOKENS.map(t => ({
      ...t,
      price:       1.0,
      gainPct:     0.0,
      positionPct: TRACK_LEFT,
      velocity:    BASE_SPEED / TICK_MS,  // pct per ms — starts at base cruise speed
    }));
  }

  function startRace() {
    state.phase = 'racing';
    state.raceStartTime = Date.now();
    initHorses();
    showScreen('race-screen');
    buildTrackDOM();
    buildTickerDOM();
    renderLeader();

    // Start continuous rAF render loop (smooth position updates at 60 fps)
    state.lastFrameTime = null;
    state.rafHandle     = requestAnimationFrame(renderLoop);

    // Price ticks every 2 s (set velocities, not positions directly)
    state.tickHandle  = setInterval(priceTick, TICK_MS);
    state.timerHandle = setInterval(updateTimer, TIMER_TICK_MS);
  }

  /* Price tick — runs every TICK_MS. Updates prices and recalculates
     per-horse velocity. Does NOT move horses directly; the rAF loop does. */
  function priceTick() {
    const returns = generateReturns();
    state.horses.forEach((horse, i) => {
      const r = returns[i];
      horse.price    *= (1 + r);
      horse.gainPct   = (horse.price - 1) * 100;
      // Convert per-tick delta → continuous velocity (pct per ms)
      const delta     = Math.max(0, BASE_SPEED + RETURN_SCALING * r);
      horse.velocity  = delta / TICK_MS;
    });
    updateGainLabels();   // update % labels on the horses
    renderTicker();
    renderLeader();
  }

  /* rAF render loop — runs every animation frame (~16 ms at 60 fps).
     Advances each horse by velocity × elapsed time, then syncs the DOM. */
  function renderLoop(now) {
    if (state.phase !== 'racing') return;   // stop if race ended

    if (state.lastFrameTime !== null) {
      // Cap dt to 100 ms so a tab-switch pause doesn't teleport horses
      const dt = Math.min(now - state.lastFrameTime, 100);
      state.horses.forEach(horse => {
        horse.positionPct = Math.min(TRACK_RIGHT, horse.positionPct + horse.velocity * dt);
      });
      updateHorseDOMPositions();
    }

    state.lastFrameTime = state.rafHandle ? now : null;
    state.rafHandle     = requestAnimationFrame(renderLoop);
  }

  function updateTimer() {
    const elapsed   = (Date.now() - state.raceStartTime) / 1000;
    const remaining = Math.max(0, RACE_DURATION_SEC - elapsed);
    const timerEl   = document.getElementById('timer-display');
    timerEl.textContent = formatTime(Math.ceil(remaining));
    if (remaining <= URGENT_THRESHOLD) timerEl.classList.add('urgent');
    if (remaining <= 0) endRace();
  }

  function endRace() {
    clearInterval(state.tickHandle);
    clearInterval(state.timerHandle);
    state.tickHandle = state.timerHandle = null;
    if (state.rafHandle) { cancelAnimationFrame(state.rafHandle); state.rafHandle = null; }
    state.phase = 'results';
    document.querySelectorAll('.horse').forEach(el => el.classList.remove('racing'));
    setTimeout(showResults, 1000);
  }

  /* --- Bet Evaluation --------------------------------------- */

  function evaluateBets(ranked) {
    const results = [];
    let netPnl = 0;

    if (state.bets.win) {
      const horse  = TOKENS.find(t => t.symbol === state.bets.win);
      const rank   = ranked.findIndex(h => h.symbol === state.bets.win);
      const won    = rank === 0;
      const payout = won ? calcWinPayout(state.bets.win) : 0;
      netPnl += payout - WAGER;
      results.push({
        type: 'A · WIN',
        pick: `${horse.emoji} ${horse.symbol} to finish 1st`,
        finish: `Finished #${rank + 1}`,
        won, pnl: payout - WAGER,
      });
    }

    if (state.bets.place) {
      const horse  = TOKENS.find(t => t.symbol === state.bets.place);
      const rank   = ranked.findIndex(h => h.symbol === state.bets.place);
      const won    = rank < 3;
      const payout = won ? calcPlacePayout(state.bets.place) : 0;
      netPnl += payout - WAGER;
      results.push({
        type: 'B · PLACE',
        pick: `${horse.emoji} ${horse.symbol} top 3`,
        finish: `Finished #${rank + 1}`,
        won, pnl: payout - WAGER,
      });
    }

    if (isTrifectaComplete()) {
      const won    = state.bets.trifecta.every((s, i) => ranked[i] && ranked[i].symbol === s);
      const payout = won ? calcTrifectaPayout(state.bets.trifecta) : 0;
      netPnl += payout - WAGER;
      const pickStr   = state.bets.trifecta.map(s => {
        const t = TOKENS.find(t => t.symbol === s);
        return `${t.emoji} ${s}`;
      }).join(' → ');
      const actualStr = ranked.slice(0, 3).map(h => `${h.emoji} ${h.symbol}`).join(' → ');
      results.push({
        type: 'C · TRIFECTA',
        pick: pickStr,
        finish: `Actual: ${actualStr}`,
        won, pnl: payout - WAGER,
      });
    }

    return { results, netPnl };
  }

  function showResults() {
    const ranked = [...state.horses].sort((a, b) => b.positionPct - a.positionPct);
    const winner = ranked[0];

    // Winner banner
    document.getElementById('winner-emoji').textContent = winner.emoji;
    document.getElementById('winner-name').textContent  = winner.symbol;
    document.getElementById('winner-gain').textContent  =
      (winner.gainPct >= 0 ? '+' : '') + winner.gainPct.toFixed(3) + '%';

    // Bet results
    const { results, netPnl } = evaluateBets(ranked);
    const betTable = document.getElementById('bet-results-table');
    betTable.innerHTML = '';

    if (results.length === 0) {
      betTable.innerHTML = '<p class="no-bets-msg">No bets were placed</p>';
    } else {
      results.forEach(r => {
        const row     = document.createElement('div');
        row.className = `bet-result-row ${r.won ? 'bet-won' : 'bet-lost'}`;
        const pnlTxt  = r.pnl >= 0
          ? `+$${r.pnl.toFixed(2)}`
          : `−$${Math.abs(r.pnl).toFixed(2)}`;
        const pnlCls  = r.pnl >= 0 ? 'positive' : 'negative';
        row.innerHTML = `
          <span class="br-type">${r.type}</span>
          <div class="br-middle">
            <span class="br-pick">${r.pick}</span>
            <span class="br-finish">${r.finish}</span>
          </div>
          <span class="br-pnl ${pnlCls}">${pnlTxt}</span>
        `;
        betTable.appendChild(row);
      });
    }

    const netEl  = document.getElementById('bet-net-row');
    const netCls = netPnl > 0 ? 'positive' : netPnl < 0 ? 'negative' : 'neutral';
    const netTxt = netPnl >= 0
      ? `+$${netPnl.toFixed(2)}`
      : `−$${Math.abs(netPnl).toFixed(2)}`;
    netEl.innerHTML = `
      <span class="net-label">NET P&amp;L</span>
      <span class="net-value ${netCls}">${netTxt}</span>
    `;

    // Rankings table
    const table  = document.getElementById('results-table');
    table.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    const allBetSymbols = [
      state.bets.win, state.bets.place, ...state.bets.trifecta,
    ].filter(Boolean);

    ranked.forEach((horse, i) => {
      const row = document.createElement('div');
      row.className = [
        'result-row',
        i === 0 ? 'place-1' : '',
        allBetSymbols.includes(horse.symbol) ? 'user-horse' : '',
      ].filter(Boolean).join(' ');

      const sign     = horse.gainPct >= 0 ? '+' : '';
      const gainClass = horse.gainPct >= 0 ? 'positive' : 'negative';
      row.innerHTML = `
        <span class="result-place">${medals[i] || `#${i + 1}`}</span>
        <span class="result-emoji">${horse.emoji}</span>
        <span class="result-name">${horse.name} <span class="result-symbol">${horse.symbol}</span></span>
        <span class="result-gain ${gainClass}">${sign}${horse.gainPct.toFixed(3)}%</span>
      `;
      table.appendChild(row);
    });

    showScreen('results-screen');
  }

  function resetToLobby() {
    state.phase        = 'lobby';
    state.activeBetTab = 'win';
    state.bets         = { win: null, place: null, trifecta: [null, null, null] };
    initHorses();

    const timerEl = document.getElementById('timer-display');
    timerEl.textContent = '1:00';
    timerEl.classList.remove('urgent');

    showScreen('lobby');
    switchBetTab('win');
    renderCardSelectionState();
    updateBetSummary();
    updateStartButton();
  }

  /* --- Bet Tab Switching ------------------------------------ */

  function switchBetTab(type) {
    state.activeBetTab = type;

    document.querySelectorAll('.bet-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === type);
    });

    const desc = {
      win:      'Pick <strong>one horse</strong> to finish 1st',
      place:    'Pick <strong>one horse</strong> to finish 1st, 2nd or 3rd',
      trifecta: 'Pick the <strong>exact order</strong> of 1st, 2nd, 3rd — click a filled slot to clear it',
    };
    document.getElementById('bet-desc-text').innerHTML = desc[type];
    document.getElementById('trifecta-slots').classList.toggle('hidden', type !== 'trifecta');
    renderCardSelectionState();
  }

  /* --- Horse Selection --------------------------------------- */

  function selectHorseForCurrentBet(symbol) {
    const tab = state.activeBetTab;

    if (tab === 'win') {
      state.bets.win = (state.bets.win === symbol) ? null : symbol;
    } else if (tab === 'place') {
      state.bets.place = (state.bets.place === symbol) ? null : symbol;
    } else {
      // trifecta
      const slots    = state.bets.trifecta;
      const existing = slots.indexOf(symbol);
      if (existing !== -1) {
        slots[existing] = null;
      } else {
        const empty = slots.indexOf(null);
        if (empty !== -1) slots[empty] = symbol;
        // if all 3 full, do nothing — user must clear a slot first
      }
      renderTrifectaSlots();
    }

    renderCardSelectionState();
    updateBetSummary();
    updateStartButton();
  }

  function renderCardSelectionState() {
    const tab    = state.activeBetTab;
    const slots  = state.bets.trifecta;
    const labels = ['1ST', '2ND', '3RD'];
    const bgColors = ['#b8900a', '#888', '#a05020'];
    const fgColors = ['#000',    '#fff', '#fff'   ];

    document.querySelectorAll('.horse-card').forEach(card => {
      const sym = card.dataset.symbol;
      card.classList.remove('selected', 'tri-1', 'tri-2', 'tri-3');

      const badge = card.querySelector('.card-selected-badge');
      badge.textContent       = 'PICKED';
      badge.style.background  = '';
      badge.style.color       = '';

      if (tab === 'win' && state.bets.win === sym) {
        card.classList.add('selected');
      } else if (tab === 'place' && state.bets.place === sym) {
        card.classList.add('selected');
      } else if (tab === 'trifecta') {
        const pos = slots.indexOf(sym);
        if (pos !== -1) {
          card.classList.add('selected', `tri-${pos + 1}`);
          badge.textContent      = labels[pos];
          badge.style.background = bgColors[pos];
          badge.style.color      = fgColors[pos];
        }
      }
    });
  }

  function renderTrifectaSlots() {
    [0, 1, 2].forEach(i => {
      const el    = document.getElementById(`tri-slot-${i}`);
      if (!el) return;
      const sym   = state.bets.trifecta[i];
      const token = sym ? TOKENS.find(t => t.symbol === sym) : null;
      el.classList.toggle('filled', !!token);
      el.querySelector('.slot-horse').textContent = token
        ? `${token.emoji} ${token.symbol}` : '—';
    });
  }

  /* --- Bet Summary ------------------------------------------ */

  function updateBetSummary() {
    const rowsEl = document.getElementById('summary-rows');
    rowsEl.innerHTML = '';
    let totalWager = 0, totalMax = 0;

    function addRow(label, pick, payout) {
      totalWager += WAGER;
      totalMax   += payout;
      const row = document.createElement('div');
      row.className = 'summary-row';
      row.innerHTML = `
        <span class="summary-type">${label}</span>
        <span class="summary-pick">${pick}</span>
        <span class="summary-pays">Pays <strong>$${payout.toFixed(2)}</strong></span>
      `;
      rowsEl.appendChild(row);
    }

    if (state.bets.win) {
      const t = TOKENS.find(t => t.symbol === state.bets.win);
      addRow('A · WIN', `${t.emoji} ${t.symbol}`, calcWinPayout(state.bets.win));
    }
    if (state.bets.place) {
      const t = TOKENS.find(t => t.symbol === state.bets.place);
      addRow('B · PLACE', `${t.emoji} ${t.symbol}`, calcPlacePayout(state.bets.place));
    }
    if (isTrifectaComplete()) {
      const picks = state.bets.trifecta.map(s => {
        const t = TOKENS.find(t => t.symbol === s);
        return `${t.emoji}${t.symbol}`;
      }).join(' → ');
      addRow('C · TRIFECTA', picks, calcTrifectaPayout(state.bets.trifecta));
    }

    if (totalWager === 0) {
      rowsEl.innerHTML = '<p class="summary-empty">Select a bet type above and pick your horse</p>';
    }

    document.getElementById('summary-wagered').textContent = `$${totalWager.toFixed(2)}`;
    document.getElementById('summary-return').textContent  =
      totalMax > 0 ? `$${totalMax.toFixed(2)}` : '—';
  }

  function updateStartButton() {
    const ok = hasAnyBet();
    document.getElementById('start-race-btn').disabled = !ok;
    document.getElementById('start-hint').textContent  = ok
      ? 'Ready to race!'
      : 'Place at least one bet to start';
  }

  /* --- DOM Building ------------------------------------------ */

  function buildBettingPanel() {
    const panel = document.getElementById('betting-panel');
    panel.innerHTML = '';

    TOKENS.forEach(token => {
      const tier = volTier(token.vol);
      const bars = [1, 2, 3, 4].map(n =>
        `<span class="vol-bar${n <= tier.bars ? ' filled' : ''}" ${n <= tier.bars ? `style="background:${tier.color}"` : ''}></span>`
      ).join('');

      const card = document.createElement('div');
      card.className      = 'horse-card';
      card.dataset.symbol = token.symbol;
      card.innerHTML = `
        <span class="card-selected-badge">PICKED</span>
        <span class="card-emoji">${token.emoji}</span>
        <span class="card-symbol">${token.symbol}</span>
        <span class="card-name">${token.name}</span>
        <div class="card-meta">
          <span class="card-odds">${formatOdds(token.symbol)}</span>
          <div class="card-vol">
            <div class="vol-bars">${bars}</div>
            <span class="vol-label" style="color:${tier.color}">${tier.label}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => selectHorseForCurrentBet(token.symbol));
      panel.appendChild(card);
    });
  }

  function buildTrackDOM() {
    const container = document.getElementById('track-container');
    container.innerHTML = '';

    const allBetSymbols = [
      state.bets.win, state.bets.place, ...state.bets.trifecta,
    ].filter(Boolean);

    // Top crowd strip
    const crowdTop = document.createElement('div');
    crowdTop.className   = 'crowd-strip';
    crowdTop.textContent = '📣 👏 🎉 👥 📣 👏 🎊 👥 📣 👏 🎉 👥 📣 👏 🎊 👥 📣 👏 🎉 👥 📣 👏 🎊 👥 📣';
    container.appendChild(crowdTop);

    // Lanes
    state.horses.forEach((horse, i) => {
      const lane     = document.createElement('div');
      lane.className = 'lane';
      lane.id        = `lane-${i}`;
      if (allBetSymbols.includes(horse.symbol)) lane.classList.add('user-bet-lane');

      const rank       = document.createElement('div');
      rank.className   = 'lane-rank';
      rank.id          = `rank-${i}`;
      rank.textContent = `#${i + 1}`;

      const horseEl      = document.createElement('div');
      horseEl.className  = 'horse racing';
      horseEl.id         = `horse-${i}`;
      horseEl.style.left = `${TRACK_LEFT}%`;

      const isUserPick = allBetSymbols.includes(horse.symbol);
      horseEl.innerHTML = `
        ${isUserPick ? '<span class="horse-crown">👑</span>' : ''}
        <span class="horse-emoji">${horse.emoji}</span>
        <div class="horse-tag">
          <span class="horse-symbol">${horse.symbol}</span>
          <span class="horse-gain-label neutral" id="gain-${i}">+0.000%</span>
        </div>
      `;

      lane.appendChild(rank);
      lane.appendChild(horseEl);
      container.appendChild(lane);
    });

    // Bottom crowd strip
    const crowdBot = document.createElement('div');
    crowdBot.className   = 'crowd-strip';
    crowdBot.textContent = '👥 🎊 👏 📣 👥 🎉 👏 📣 👥 🎊 👏 📣 👥 🎉 👏 📣 👥 🎊 👏 📣 👥 🎉 👏 📣 👥';
    container.appendChild(crowdBot);
  }

  function buildTickerDOM() {
    const ticker = document.getElementById('gain-ticker');
    ticker.innerHTML = '';
    state.horses.forEach((horse, i) => {
      const item = document.createElement('div');
      item.className = 'ticker-item';
      item.id        = `ticker-${i}`;
      item.innerHTML = `
        <span class="ticker-emoji">${horse.emoji}</span>
        <span class="ticker-symbol">${horse.symbol}</span>
        <span class="ticker-gain neutral" id="tgain-${i}">+0.000%</span>
      `;
      ticker.appendChild(item);
    });
  }

  /* --- DOM Updates ------------------------------------------ */

  /* Called every rAF frame — only touches left% and rank badges */
  function updateHorseDOMPositions() {
    const byPosition = [...state.horses]
      .map((h, i) => ({ ...h, origIdx: i }))
      .sort((a, b) => b.positionPct - a.positionPct);

    state.horses.forEach((horse, i) => {
      const horseEl = document.getElementById(`horse-${i}`);
      if (horseEl) horseEl.style.left = `${horse.positionPct}%`;
    });

    byPosition.forEach((horse, rank) => {
      const rankEl = document.getElementById(`rank-${horse.origIdx}`);
      if (rankEl) rankEl.textContent = `#${rank + 1}`;
    });
  }

  /* Called every price tick — updates gain% labels on each horse */
  function updateGainLabels() {
    state.horses.forEach((horse, i) => {
      const gainEl = document.getElementById(`gain-${i}`);
      if (!gainEl) return;
      const sign = horse.gainPct >= 0 ? '+' : '';
      gainEl.textContent = `${sign}${horse.gainPct.toFixed(3)}%`;
      gainEl.className   = `horse-gain-label ${horse.gainPct > 0 ? 'positive' : horse.gainPct < 0 ? 'negative' : 'neutral'}`;
    });
  }

  function renderTicker() {
    const byPosition = [...state.horses]
      .map((h, i) => ({ ...h, origIdx: i }))
      .sort((a, b) => b.positionPct - a.positionPct);

    state.horses.forEach((horse, i) => {
      const tickerEl = document.getElementById(`ticker-${i}`);
      const gainEl   = document.getElementById(`tgain-${i}`);
      if (!gainEl) return;
      const sign = horse.gainPct >= 0 ? '+' : '';
      gainEl.textContent = `${sign}${horse.gainPct.toFixed(3)}%`;
      gainEl.className   = `ticker-gain ${horse.gainPct > 0 ? 'positive' : horse.gainPct < 0 ? 'negative' : 'neutral'}`;
      tickerEl.classList.toggle('leader', byPosition[0].origIdx === i);
    });
  }

  function renderLeader() {
    const leader = state.horses.reduce(
      (best, h) => h.positionPct > best.positionPct ? h : best,
      state.horses[0]
    );
    const el = document.getElementById('leader-name');
    if (el) el.textContent = `${leader.emoji} ${leader.symbol}`;
  }

  /* --- Utilities --------------------------------------------- */

  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  /* --- Event Listeners --------------------------------------- */

  function attachListeners() {
    document.querySelectorAll('.bet-tab').forEach(btn => {
      btn.addEventListener('click', () => switchBetTab(btn.dataset.tab));
    });

    document.querySelectorAll('.trifecta-slot').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.slot, 10);
        if (state.bets.trifecta[i]) {
          state.bets.trifecta[i] = null;
          renderTrifectaSlots();
          renderCardSelectionState();
          updateBetSummary();
          updateStartButton();
        }
      });
    });

    document.getElementById('start-race-btn').addEventListener('click', () => {
      if (hasAnyBet()) startRace();
    });

    document.getElementById('race-again-btn').addEventListener('click', resetToLobby);
  }

  /* --- Init -------------------------------------------------- */

  function init() {
    initHorses();
    precomputeOdds(3000);   // run Monte Carlo BEFORE building panel (synchronous)
    buildBettingPanel();
    attachListeners();
    updateBetSummary();
    updateStartButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
