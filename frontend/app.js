/**
 * Sunday Golf Tracker - Frontend Application Logic
 * Supports Normal & Wolf Modes, Handicap (TOR), Turbo Multipliers, Chuan/Penetrate, and Courses DB.
 */

// Application State
let state = {
  tournament: null,
  courses: [],
  currentHole: 1,
  activeTab: 'play',
  localScores: {}, // { [playerId]: number }
  teamA: [], // [playerId, ...]
  teamB: [], // [playerId, ...]
  unlockedHoles: {}, // { [holeNum]: true }
  momentumChart: null,
  eventSource: null,
  draggedPlayerId: null,
  isCourseModified: false
};

const DEFAULT_COLORS = [
  "#FFFFFF", // P1: White (Shirobon)
  "#1E293B", // P2: Black (Kurobon)
  "#EF4444", // P3: Red (Akabon)
  "#3B82F6", // P4: Blue (Aobon)
  "#10B981", // P5: Green (Midoribon)
  "#F59E0B"  // P6: Yellow (Kibon)
];

const DEFAULT_NAMES = [
  "Shirobon",
  "Kurobon",
  "Akabon",
  "Aobon",
  "Midoribon",
  "Kibon"
];

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', () => {
  initIcons();
  setupSSE();
  fetchInitialState();
  fetchCourses();
  setupDragScroll('scorecard-scroll-container');
  setupDragScroll('hole-carousel');
});

function initIcons() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Mouse Drag-to-Scroll for Tables & Carousels
function setupDragScroll(elementId) {
  const container = document.getElementById(elementId);
  if (!container) return;

  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;

  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDown = true;
    container.classList.add('is-dragging');
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  window.addEventListener('mouseup', () => {
    if (!isDown) return;
    isDown = false;
    container.classList.remove('is-dragging');
  });

  container.addEventListener('mouseleave', () => {
    if (!isDown) return;
    isDown = false;
    container.classList.remove('is-dragging');
  });

  container.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 1.5;
    container.scrollLeft = scrollLeft - walk;
  });

  container.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0 && !e.shiftKey) {
      if (container.scrollWidth > container.clientWidth) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }
  }, { passive: false });
}

// ================= REAL-TIME SSE SYNC =================
function setupSSE() {
  const liveIndicator = document.getElementById('live-indicator');

  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource('/api/events');

  state.eventSource.onopen = () => {
    if (liveIndicator) {
      liveIndicator.className = "flex items-center space-x-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
      liveIndicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>LIVE</span>';
    }
  };

  state.eventSource.onerror = () => {
    if (liveIndicator) {
      liveIndicator.className = "flex items-center space-x-1.5 px-2 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30";
      liveIndicator.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>SYNCING</span>';
    }
  };

  const handleUpdate = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateTournamentState(data);
    } catch (e) {
      console.error("Error parsing SSE event:", e);
    }
  };

  state.eventSource.addEventListener('initial', handleUpdate);
  state.eventSource.addEventListener('score_update', handleUpdate);
  state.eventSource.addEventListener('players_update', handleUpdate);
  state.eventSource.addEventListener('settings_update', handleUpdate);
  state.eventSource.addEventListener('course_update', handleUpdate);
  state.eventSource.addEventListener('reset', handleUpdate);
  state.eventSource.addEventListener('reset_default', handleUpdate);
}

async function fetchInitialState() {
  try {
    const res = await fetch('/api/tournament');
    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
    }
  } catch (err) {
    console.error("Failed to fetch initial state:", err);
  }
}

async function fetchCourses() {
  try {
    const res = await fetch('/api/courses');
    if (res.ok) {
      state.courses = await res.json();
      renderCourseSelector();
    }
  } catch (err) {
    console.error("Failed to fetch courses:", err);
  }
}

// ================= STATE UPDATES & RENDERING =================
function updateTournamentState(data) {
  state.tournament = data;

  syncHoleTeamAssignments();
  applyThaiEditionText();
  renderHeader();
  renderScoringTab();
  renderLeaderboard();
  renderSettingsForms();

  if (state.activeTab === 'scorecard') {
    renderScorecardTable();
  } else if (state.activeTab === 'momentum') {
    renderMomentumChart();
  }

  initIcons();
}

function syncHoleTeamAssignments() {
  if (!state.tournament) return;
  const hNum = state.currentHole;
  const calcHoles = state.tournament.calculated_holes || [];
  const currCalc = calcHoles.find(h => h.hole === hNum);
  const players = state.tournament.players || [];
  const validPlayerIds = new Set(players.map(p => p.id));
  const rawMode = String(state.tournament.game_settings?.game_mode || 'TEAMS').toUpperCase();
  const isWolf = (rawMode === 'WOLF');
  const isFFA = (rawMode === 'FREE_FOR_ALL' || rawMode === 'FFA');

  if (isFFA) {
    state.teamA = [];
    state.teamB = [];
    return;
  }

  if (isWolf) {
    if (currCalc && (currCalc.team_a || currCalc.team_b)) {
      state.teamA = (currCalc.team_a || []).filter(id => validPlayerIds.has(id));
      state.teamB = (currCalc.team_b || []).filter(id => validPlayerIds.has(id));
      players.forEach(p => {
        if (!state.teamA.includes(p.id) && !state.teamB.includes(p.id)) {
          state.teamB.push(p.id);
        }
      });
    } else {
      const wolfIdx = (hNum - 1) % players.length;
      state.teamA = [players[wolfIdx]?.id || 'p1'];
      state.teamB = players.filter((_, idx) => idx !== wolfIdx).map(p => p.id);
    }
  } else {
    // TEAMS MODE: Place players on either Left or Right team for all holes based on default_team setting
    const defaultLeft = players.filter(p => (p.default_team || 'left') === 'left').map(p => p.id);
    const defaultRight = players.filter(p => p.default_team === 'right').map(p => p.id);
    state.teamA = defaultLeft.length > 0 ? [...defaultLeft] : [players[0]?.id || 'p1'];
    state.teamB = defaultRight.length > 0 ? [...defaultRight] : players.filter(p => !state.teamA.includes(p.id)).map(p => p.id);
  }
}

function getCurrencySymbol(curr) {
  const c = curr || state.tournament?.game_settings?.currency || 'THB';
  switch (c) {
    case 'THB': return '฿';
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    case 'SGD': return 'S$';
    default: return c;
  }
}

function formatCash(amount, curr) {
  const sym = getCurrencySymbol(curr);
  const val = Math.round(amount || 0);
  if (val > 0) return `+${sym}${val.toLocaleString()}`;
  if (val < 0) return `-${sym}${Math.abs(val).toLocaleString()}`;
  return `${sym}0`;
}

function isThaiMode() {
  return (state.tournament?.game_settings?.currency === 'THB');
}

function applyThaiEditionText() {
  const thai = isThaiMode();
  
  // Penetrate -> Chuan
  const penTitle = document.getElementById('label-penetrate-title');
  if (penTitle) {
    penTitle.textContent = thai ? "Chuan (ชวน)" : "Penetrate";
  }

  // Turbo Handicap -> Turbo TOR
  const turboHcpLabel = document.getElementById('label-turbo-handicap');
  if (turboHcpLabel) {
    turboHcpLabel.textContent = thai ? "Turbo TOR (ต่อ)" : "Turbo Handicap";
  }
}

// ================= RENDER HEADER =================
function renderHeader() {
  if (!state.tournament) return;
  const t = state.tournament;
  const settings = t.game_settings || {};
  const rawMode = String(settings.game_mode || 'TEAMS').toUpperCase();
  const isWolf = (rawMode === 'WOLF');
  const isFFA = (rawMode === 'FREE_FOR_ALL' || rawMode === 'FFA');

  let modeBadgeClass = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
  let modeBadgeText = 'TEAMS';
  if (isWolf) {
    modeBadgeClass = 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
    modeBadgeText = '🐺 WOLF';
  } else if (isFFA) {
    modeBadgeClass = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    modeBadgeText = 'FREE-FOR-ALL';
  }

  const nameEl = document.getElementById('header-tournament-name');
  if (nameEl) {
    nameEl.innerHTML = `
      <span class="truncate">${t.tournament_name || 'Sunday Golf Match'}</span>
      <span id="header-mode-badge" class="px-1.5 py-0.5 rounded text-[10px] font-black ${modeBadgeClass}">
        ${modeBadgeText}
      </span>
    `;
  }

  const courseEl = document.getElementById('header-course-name');
  if (courseEl) {
    courseEl.textContent = t.course_name || 'Krungthep Kreetha';
  }

  // Live Leader Pill (2-line)
  const leaderContainer = document.getElementById('header-leader-content');
  if (leaderContainer) {
    const leader = t.leader_player;
    if (leader && leader.total_played > 0) {
      const cashStr = formatCash(leader.total_cash, settings.currency);
      const cashClass = leader.total_cash > 0 ? 'text-emerald-400 font-black' : (leader.total_cash < 0 ? 'text-rose-400 font-black' : 'text-slate-300');

      leaderContainer.innerHTML = `
        <div class="flex items-center justify-between gap-1 text-xs font-black min-w-0">
          <div class="flex items-center gap-1 min-w-0 truncate">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${leader.color}; border: 1px solid rgba(255,255,255,0.4);"></span>
            <span class="text-white text-[11px] font-black truncate">${leader.name}</span>
          </div>
          <span class="text-[10px] font-mono ${cashClass}">${cashStr}</span>
        </div>
        <div class="flex items-center justify-between text-[10px] text-slate-400 font-semibold leading-tight mt-0.5">
          <span class="truncate">👑 Current Leader</span>
          <span class="font-mono text-amber-300 font-bold shrink-0 text-[9px]">${leader.thru_display} (${leader.to_par_display})</span>
        </div>
      `;
    } else {
      leaderContainer.innerHTML = `
        <div class="flex items-center justify-between gap-1 text-xs font-black">
          <span class="text-amber-400 text-xs">👑</span>
          <span class="text-white text-[11px] font-black">Sunday Match</span>
          <span class="text-slate-400 text-[10px] font-mono">Hole 1</span>
        </div>
        <div class="text-[10px] text-slate-400 font-medium leading-tight mt-0.5 truncate">
          ${t.players?.length || 4} Players Ready
        </div>
      `;
    }
  }
}

// ================= TAB 1: LIVE SCORING =================
function renderScoringTab() {
  if (!state.tournament) return;
  const t = state.tournament;
  const hNum = state.currentHole;
  const holes = t.holes || [];
  const hSpec = holes.find(h => h.hole === hNum) || holes[hNum - 1] || { hole: hNum, par: 4, handicap: 9, is_turbo: false };
  const calcHoles = t.calculated_holes || [];
  const currCalc = calcHoles.find(h => h.hole === hNum);

  const settings = t.game_settings || {};
  const rawMode = String(settings.game_mode || 'TEAMS').toUpperCase();
  const isWolf = (rawMode === 'WOLF');
  const isFFA = (rawMode === 'FREE_FOR_ALL' || rawMode === 'FFA');
  const isThai = isThaiMode();

  // 1. Hole Title & Par Info
  const titleEl = document.getElementById('carousel-active-hole-title');
  if (titleEl) titleEl.textContent = `HOLE ${hNum}`;

  const infoEl = document.getElementById('carousel-active-hole-info');
  if (infoEl) {
    infoEl.textContent = `Par ${hSpec.par || 4} • HCP ${hSpec.handicap || 9}`;
  }

  // 2. Carousel
  renderHoleCarousel(holes, calcHoles);

  // 3. Hand Count Info Badge & Instruction Hints
  const handBadge = document.getElementById('hand-count-info-badge');
  const hintText = document.getElementById('instruction-hint-text');
  const splitWrapper = document.getElementById('split-teams-wrapper');
  const ffaWrapper = document.getElementById('ffa-wrapper');

  if (isFFA) {
    if (handBadge) handBadge.textContent = 'All 1v1 Pair Matchups';
    if (hintText) hintText.textContent = 'Free-For-All: All players compete 1-on-1 against each other';
    if (splitWrapper) splitWrapper.classList.add('hidden');
    if (ffaWrapper) ffaWrapper.classList.remove('hidden');
  } else {
    if (splitWrapper) splitWrapper.classList.remove('hidden');
    if (ffaWrapper) ffaWrapper.classList.add('hidden');
    if (hintText) hintText.textContent = 'Drag or tap player cards to assign teams';
    if (handBadge) {
      const hands = Math.min(settings.hand_count || 2, state.teamA.length, state.teamB.length) || 1;
      handBadge.textContent = isWolf && state.teamA.length === 1 
        ? `Lone Wolf (1 Ball Match)` 
        : `Best ${hands} Ball${hands > 1 ? 's' : ''}`;
    }
  }

  // 4. Hole Status Banner (Turbo, Angel Wings, Wolf/FFA Indicator)
  renderHoleStatusBanner(hNum, hSpec, currCalc, isWolf, isFFA, isThai, settings);

  // 5. Team Titles & Player Cards Rendering
  if (isFFA) {
    renderFFAScoringView(currCalc, hSpec, isThai);
  } else {
    const teamATitle = document.getElementById('team-a-title');
    const teamBTitle = document.getElementById('team-b-title');
    if (teamATitle) {
      teamATitle.innerHTML = isWolf ? `<span>🐺 WOLF</span>` : `<span>Left Team</span>`;
    }
    if (teamBTitle) {
      teamBTitle.innerHTML = isWolf ? `<span>🐑 SHEEP</span>` : `<span>Right Team</span>`;
    }
    renderTeamPlayerCards(currCalc, hSpec, isThai);
  }

  // 7. Render Scoring Action Bar
  renderScoringActionBar(hNum, currCalc);
}

function renderHoleCarousel(holes, calcHoles) {
  const container = document.getElementById('hole-carousel');
  if (!container) return;

  container.innerHTML = holes.map(h => {
    const hNum = h.hole;
    const isActive = (hNum === state.currentHole);
    const calcH = calcHoles.find(c => c.hole === hNum);
    const hasScores = calcH && calcH.scores && Object.keys(calcH.scores).length > 0;
    const isTurbo = h.is_turbo;

    let baseClass = "flex-shrink-0 w-11 h-12 rounded-2xl flex flex-col items-center justify-center font-black transition-all duration-200 border cursor-pointer select-none relative ";
    
    if (isActive) {
      baseClass += "bg-gradient-to-b from-amber-400 to-amber-500 text-slate-950 border-amber-300 shadow-lg shadow-amber-500/30 scale-105 ring-2 ring-amber-400 ";
    } else if (hasScores) {
      baseClass += "bg-emerald-950/70 border-emerald-700/60 text-emerald-300 hover:border-emerald-500 ";
    } else {
      baseClass += "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white ";
    }

    const turboDot = isTurbo ? `<span class="absolute -top-1 -right-1 text-[9px]">🔥</span>` : '';
    const subText = hasScores && !isActive
      ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-0.5"></span>`
      : `<span class="text-[9px] font-bold ${isActive ? 'text-slate-950/70' : 'text-slate-500'}">P${h.par}</span>`;

    return `
      <div onclick="selectHole(${hNum})" class="${baseClass}">
        ${turboDot}
        <span class="text-xs font-black leading-tight">${hNum}</span>
        ${subText}
      </div>
    `;
  }).join('');

  setTimeout(() => {
    const activeEl = container.querySelector('.ring-amber-400');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, 40);
}

function selectHole(hNum) {
  state.currentHole = hNum;
  state.localScores = {};
  syncHoleTeamAssignments();
  renderScoringTab();
  initIcons();
}

function renderHoleStatusBanner(hNum, hSpec, currCalc, isWolf, isFFA, isThai, settings) {
  const banner = document.getElementById('hole-status-banner');
  if (!banner) return;

  const isTurbo = hSpec.is_turbo && settings.turbo;
  const turboMult = settings.turbo_multiplier || 2;
  const hcpPlayers = currCalc?.handicap_players || [];
  const wolfPlayer = currCalc?.wolf_player;

  let turboBadge = isTurbo 
    ? `<span class="turbo-badge text-[10px]"><span class="animate-bounce">🔥</span> TURBO (x${turboMult})</span>` 
    : '';

  let wingsBadge = '';
  if (hcpPlayers.length > 0) {
    const names = hcpPlayers.map(p => p.name).join(', ');
    wingsBadge = `
      <span class="angel-wing-badge text-[10px]" title="Handicap stroke -1 applied">
        <span>🪽</span>
        <span>${isThai ? 'TOR (-1)' : 'Handicap (-1)'}: <strong>${names}</strong></span>
      </span>
    `;
  }

  let modeTxt = '';
  if (isWolf && wolfPlayer) {
    modeTxt = `
      <span class="text-[11px] font-extrabold text-purple-300 flex items-center gap-1">
        <span>🐺 Wolf: <strong>${wolfPlayer.name}</strong></span>
        <span class="text-slate-500 text-[10px]">(Tees off last)</span>
      </span>
    `;
  } else if (isFFA) {
    modeTxt = `<span class="text-[11px] font-extrabold text-emerald-400">Free-For-All</span>`;
  } else {
    modeTxt = `<span class="text-[11px] font-extrabold text-amber-400">Teams</span>`;
  }

  banner.innerHTML = `
    <div class="flex items-center gap-2 flex-wrap min-w-0">
      ${modeTxt}
      ${turboBadge}
      ${wingsBadge}
    </div>
    <div class="text-[11px] text-amber-400 font-bold font-mono">
      ${formatCash(settings.cash_per_point, settings.currency)} / pt
    </div>
  `;
}

function renderTeamPlayerCards(currCalc, hSpec, isThai) {
  const teamAList = document.getElementById('team-a-players-list');
  const teamBList = document.getElementById('team-b-players-list');
  const teamACount = document.getElementById('team-a-count');
  const teamBCount = document.getElementById('team-b-count');

  if (!teamAList || !teamBList || !state.tournament) return;

  const players = state.tournament.players || [];
  const playersMap = { ...players.reduce((acc, p) => ({ ...acc, [p.id]: p }), {}) };
  const hNum = state.currentHole;
  const par = hSpec.par || 4;

  const existingScores = currCalc?.scores || {};
  const isHolePlayed = existingScores && Object.keys(existingScores).length > 0;
  const unlockKey = `${hNum}`;
  const isUnlocked = Boolean(state.unlockedHoles[unlockKey]);
  const isLocked = isHolePlayed && !isUnlocked;

  const hcpPlayerIds = new Set((currCalc?.handicap_players || []).map(p => p.id));
  const scorecards = state.tournament.player_scorecards || [];

  // Team A Players
  const teamAPlayers = state.teamA.map(pid => {
    const p = playersMap[pid];
    if (!p) return null;
    let score = par;
    if (state.localScores[pid] !== undefined) score = state.localScores[pid];
    else if (existingScores[pid] !== undefined) score = existingScores[pid];
    const hasHcp = hcpPlayerIds.has(pid);
    const net = hasHcp ? score - 1 : score;
    return { ...p, score, net, hasHcp };
  }).filter(Boolean);

  // Team B Players
  const teamBPlayers = state.teamB.map(pid => {
    const p = playersMap[pid];
    if (!p) return null;
    let score = par;
    if (state.localScores[pid] !== undefined) score = state.localScores[pid];
    else if (existingScores[pid] !== undefined) score = existingScores[pid];
    const hasHcp = hcpPlayerIds.has(pid);
    const net = hasHcp ? score - 1 : score;
    return { ...p, score, net, hasHcp };
  }).filter(Boolean);

  // Position does NOT change when adjusting the score; only rearranges after score is saved for this hole
  const isWolf = (state.tournament?.game_settings?.game_mode === 'WOLF');
  const wolfPlayer = currCalc?.wolf_player;

  if (isHolePlayed) {
    const getSavedScoreSort = (p) => {
      const s = existingScores[p.id];
      if (s === undefined) return 999;
      const net = p.hasHcp ? s - 1 : s;
      return net * 100 + s;
    };

    if (isWolf && wolfPlayer) {
      // In Wolf mode, Wolf player is always first on Team A
      teamAPlayers.sort((a, b) => {
        if (a.id === wolfPlayer.id) return -1;
        if (b.id === wolfPlayer.id) return 1;
        return getSavedScoreSort(a) - getSavedScoreSort(b);
      });
    } else {
      teamAPlayers.sort((a, b) => getSavedScoreSort(a) - getSavedScoreSort(b));
    }
    teamBPlayers.sort((a, b) => getSavedScoreSort(a) - getSavedScoreSort(b));
  } else {
    if (isWolf && wolfPlayer) {
      // In Wolf mode, keep Wolf player at top of Team A even when unplayed
      teamAPlayers.sort((a, b) => {
        if (a.id === wolfPlayer.id) return -1;
        if (b.id === wolfPlayer.id) return 1;
        return 0;
      });
    }
  }

  if (teamACount) teamACount.textContent = teamAPlayers.length;
  if (teamBCount) teamBCount.textContent = teamBPlayers.length;

  teamAList.innerHTML = teamAPlayers.map(p => renderPlayerCardHtml(p, 'team_a', isLocked, currCalc, par, isThai)).join('');
  teamBList.innerHTML = teamBPlayers.map(p => renderPlayerCardHtml(p, 'team_b', isLocked, currCalc, par, isThai)).join('');
}

function renderFFAScoringView(currCalc, hSpec, isThai) {
  const ffaList = document.getElementById('ffa-players-list');
  const ffaBadge = document.getElementById('ffa-player-count-badge');
  const comboCountEl = document.getElementById('ffa-combo-count');

  if (!ffaList || !state.tournament) return;

  const players = state.tournament.players || [];
  const hNum = state.currentHole;
  const par = hSpec.par || 4;

  const existingScores = currCalc?.scores || {};
  const isHolePlayed = existingScores && Object.keys(existingScores).length > 0;
  const unlockKey = `${hNum}`;
  const isUnlocked = Boolean(state.unlockedHoles[unlockKey]);
  const isLocked = isHolePlayed && !isUnlocked;

  const hcpPlayerIds = new Set((currCalc?.handicap_players || []).map(p => p.id));
  const curr = state.tournament?.game_settings?.currency || 'THB';
  const cashPerPoint = state.tournament?.game_settings?.cash_per_point || 100;

  if (ffaBadge) {
    ffaBadge.textContent = `${players.length} Players Competing`;
  }

  // Build player objects with scores
  const ffaPlayers = players.map(p => {
    let score = par;
    if (state.localScores[p.id] !== undefined) score = state.localScores[p.id];
    else if (existingScores[p.id] !== undefined) score = existingScores[p.id];
    const hasHcp = hcpPlayerIds.has(p.id);
    const net = hasHcp ? score - 1 : score;
    const ptsDelta = currCalc?.match?.point_deltas?.[p.id];
    const cashDelta = (ptsDelta !== undefined) ? ptsDelta * cashPerPoint : null;
    return { ...p, score, net, hasHcp, ptsDelta, cashDelta };
  });

  // Position does NOT change when adjusting the score; only rearranges after score is saved for this hole
  if (isHolePlayed) {
    const getSavedScoreSort = (p) => {
      const s = existingScores[p.id];
      if (s === undefined) return 999;
      const net = p.hasHcp ? s - 1 : s;
      return net * 100 + s;
    };
    ffaPlayers.sort((a, b) => getSavedScoreSort(a) - getSavedScoreSort(b));
  }

  // Render player cards
  ffaList.innerHTML = ffaPlayers.map(p => {
    const disabledAttr = isLocked ? 'disabled' : '';
    const lockedOpacity = isLocked ? 'opacity-70' : '';

    let deltaHtml = '';
    if (p.cashDelta !== null && currCalc?.match?.played) {
      const cashStr = formatCash(p.cashDelta, curr);
      const cashClass = p.cashDelta > 0 
        ? 'text-emerald-400 bg-emerald-950/80 border-emerald-600/50' 
        : (p.cashDelta < 0 ? 'text-rose-400 bg-rose-950/80 border-rose-600/50' : 'text-slate-300 bg-slate-800 border-slate-700');

      let bonusIcons = '';
      const isTurboHole = Boolean(currCalc.is_turbo || currCalc.match?.is_turbo) && Boolean(state.tournament?.game_settings?.turbo);
      if (isTurboHole && p.ptsDelta > 0) {
        bonusIcons += `<span class="text-xs shrink-0" title="Turbo">🔥</span>`;
      }
      const scoreDiff = p.score - par;
      if (scoreDiff <= -3) bonusIcons += `<span class="text-xs shrink-0" title="Albatross">🪿</span>`;
      else if (scoreDiff === -2) bonusIcons += `<span class="text-xs shrink-0" title="Eagle">🦅</span>`;
      else if (scoreDiff === -1) bonusIcons += `<span class="text-xs shrink-0" title="Birdie">🐦</span>`;

      deltaHtml = `
        <div class="flex items-center gap-1">
          ${bonusIcons ? `<span class="flex items-center gap-0.5">${bonusIcons}</span>` : ''}
          <span class="text-[10px] font-mono font-black px-2 py-0.5 rounded border ${cashClass}">${cashStr}</span>
        </div>
      `;
    }

    const wingIcon = p.hasHcp 
      ? `<span class="text-sky-300 text-xs" title="${isThai ? 'TOR -1 stroke applied' : 'Handicap -1 stroke applied'}">🪽</span>` 
      : '';

    return `
      <div id="player-card-${p.id}" class="p-2 sm:p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-slate-700 shadow-sm ${lockedOpacity} flex items-center justify-between gap-2 transition">
        <!-- Left: Color, Name, Net Badge, Delta/Cash -->
        <div class="flex items-center gap-2 min-w-0 pr-1">
          <span class="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-white/30" style="background-color: ${p.color};"></span>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span class="text-xs sm:text-sm font-black text-white truncate">${p.name}</span>
              ${wingIcon}
              ${p.hasHcp ? `<span class="text-[10px] font-extrabold text-sky-400 font-mono">Net ${p.net}</span>` : ''}
            </div>
            ${deltaHtml ? `<div class="mt-0.5">${deltaHtml}</div>` : ''}
          </div>
        </div>

        <!-- Right: Horizontal Score Stepper (- on left, score center, + on right) -->
        <div class="horizontal-score-stepper shrink-0 select-none">
          <button type="button" ${disabledAttr} onclick="stepScore('${p.id}', -1)" class="dial-btn w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black text-sm flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition" title="Decrease score">
            −
          </button>
          <div class="w-8 h-7 sm:w-9 sm:h-8 rounded-lg bg-slate-950 border-2 border-emerald-500/80 flex items-center justify-center text-xs sm:text-sm font-black text-white font-mono shadow-inner">
            ${p.score}
          </div>
          <button type="button" ${disabledAttr} onclick="stepScore('${p.id}', 1)" class="dial-btn w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-black text-sm flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition" title="Increase score">
            +
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Render 1v1 Pairwise Matchups Matrix Table
  renderFFAMatchupsTable(currCalc, players, cashPerPoint, curr, comboCountEl);
}

function renderFFAMatchupsTable(currCalc, players, cashPerPoint, curr, comboCountEl) {
  const tableEl = document.getElementById('ffa-matchups-table');
  if (!tableEl) return;

  const matchups = currCalc?.match?.matchups || [];
  const isPlayed = Boolean(currCalc?.match?.played && matchups.length > 0);
  const totalCombos = Math.round((players.length * (players.length - 1)) / 2);
  if (comboCountEl) {
    comboCountEl.textContent = `${matchups.length || totalCombos} pairings (Matrix)`;
  }

  // 1. Header row: Corner header + Column headers (each player) + TOT
  let theadHtml = `
    <thead>
      <tr class="bg-slate-950 text-slate-300 border-b border-slate-800">
        <th class="py-2.5 px-3 text-left font-black text-[11px] text-amber-400 uppercase tracking-wider sticky left-0 z-20 bg-slate-950 border-r border-slate-800 min-w-[95px]">
          Player
        </th>
  `;

  players.forEach(p => {
    theadHtml += `
      <th class="py-2 px-1.5 text-center font-extrabold text-xs text-slate-200 border-r border-slate-800/80 min-w-[55px] max-w-[75px]">
        <div class="flex flex-col items-center justify-center gap-1 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0 border border-white/40 shadow-sm" style="background-color: ${p.color};"></span>
          <span class="truncate max-w-[58px] font-extrabold text-white text-[11px] leading-tight">${p.name}</span>
        </div>
      </th>
    `;
  });

  theadHtml += `
        <th class="py-2.5 px-2 text-center font-black text-[11px] text-amber-400 bg-slate-950 border-l border-slate-800 min-w-[50px]">
          TOT
        </th>
      </tr>
    </thead>
  `;

  // 2. Body rows: one row per player
  let tbodyHtml = `<tbody class="divide-y divide-slate-800/60">`;

  players.forEach((pRow, rIdx) => {
    tbodyHtml += `
      <tr class="hover:bg-slate-850/40 transition">
        <!-- Row Header: Sticky Player Name & Color Dot -->
        <th class="py-2 px-3 text-left font-extrabold text-xs text-white sticky left-0 z-10 bg-slate-950 border-r border-slate-800 whitespace-nowrap min-w-[95px]">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full shrink-0 border border-white/40 shadow-sm" style="background-color: ${pRow.color};"></span>
            <span class="truncate max-w-[75px] font-extrabold text-white text-xs">${pRow.name}</span>
          </div>
        </th>
    `;

    // Each column player
    players.forEach((pCol, cIdx) => {
      if (rIdx === cIdx) {
        // Diagonal cell: greyed out
        tbodyHtml += `
          <td class="p-2 text-center font-mono text-xs ffa-diagonal-cell border-r border-slate-800/60" title="${pRow.name} (Self)">
            <span class="opacity-20">—</span>
          </td>
        `;
      } else {
        // Find matchup between pRow and pCol
        const m = matchups.find(item => 
          (item.p1_id === pRow.id && item.p2_id === pCol.id) ||
          (item.p1_id === pCol.id && item.p2_id === pRow.id)
        );

        if (isPlayed && m) {
          if (m.winner_id === 'tie' || m.points === 0) {
            tbodyHtml += `
              <td class="p-2 text-center font-mono font-bold text-xs text-slate-400 bg-slate-900/40 border-r border-slate-800/60 hover:bg-slate-800/60 transition" title="${pRow.name} vs ${pCol.name}: Tied (0 pts)">
                0
              </td>
            `;
          } else if (m.winner_id === pRow.id) {
            // pRow Won
            const isTurbo = Boolean(currCalc.is_turbo || currCalc.match?.is_turbo) && Boolean(state.tournament?.game_settings?.turbo);
            tbodyHtml += `
              <td class="p-2 text-center font-mono font-black text-xs text-emerald-400 bg-emerald-950/40 border-r border-slate-800/60 hover:bg-emerald-900/40 transition" title="${pRow.name} beat ${pCol.name} (+${m.points} pts)">
                <div class="inline-flex items-center justify-center gap-0.5">
                  <span>+${m.points}</span>
                  ${isTurbo ? `<span class="text-[9px]">🔥</span>` : ''}
                </div>
              </td>
            `;
          } else {
            // pRow Lost
            tbodyHtml += `
              <td class="p-2 text-center font-mono font-black text-xs text-rose-400 bg-rose-950/40 border-r border-slate-800/60 hover:bg-rose-900/40 transition" title="${pRow.name} lost to ${pCol.name} (-${m.points} pt${m.points > 1 ? 's' : ''})">
                -${m.points}
              </td>
            `;
          }
        } else {
          // Pending matchup
          tbodyHtml += `
            <td class="p-2 text-center font-mono text-xs text-slate-600 bg-slate-900/20 border-r border-slate-800/60" title="${pRow.name} vs ${pCol.name} (Pending)">
              —
            </td>
          `;
        }
      }
    });

    // Row total points column
    const rowPts = currCalc?.match?.point_deltas?.[pRow.id];
    if (isPlayed && rowPts !== undefined) {
      const rowCash = rowPts * cashPerPoint;
      let totClass = 'text-slate-300 bg-slate-950/90 font-bold';
      let sign = '';
      if (rowPts > 0) {
        totClass = 'text-emerald-400 bg-emerald-950/60 font-black';
        sign = '+';
      } else if (rowPts < 0) {
        totClass = 'text-rose-400 bg-rose-950/60 font-black';
      }
      tbodyHtml += `
        <td class="p-2 text-center font-mono text-xs border-l border-slate-800 ${totClass}" title="${pRow.name} net: ${sign}${rowPts} pts (${formatCash(rowCash, curr)})">
          ${sign}${rowPts}
        </td>
      `;
    } else {
      tbodyHtml += `
        <td class="p-2 text-center font-mono text-xs text-slate-600 bg-slate-950/90 border-l border-slate-800">
          —
        </td>
      `;
    }

    tbodyHtml += `</tr>`;
  });

  tbodyHtml += `</tbody>`;
  tableEl.innerHTML = theadHtml + tbodyHtml;
}

function renderPlayerCardHtml(p, currentTeam, isLocked, currCalc, par, isThai) {
  const disabledAttr = isLocked ? 'disabled' : '';
  const lockedOpacity = isLocked ? 'opacity-70' : '';
  const ptsDelta = currCalc?.match?.point_deltas?.[p.id];
  const curr = state.tournament?.game_settings?.currency || 'THB';
  const cashDelta = (ptsDelta !== undefined) ? ptsDelta * (state.tournament?.game_settings?.cash_per_point || 100) : null;

  let deltaHtml = '';
  if (cashDelta !== null && currCalc?.match?.played) {
    const cashStr = formatCash(cashDelta, curr);
    const cashClass = cashDelta > 0 ? 'text-emerald-400 bg-emerald-950/80 border-emerald-600/50' : (cashDelta < 0 ? 'text-rose-400 bg-rose-950/80 border-rose-600/50' : 'text-slate-300 bg-slate-800 border-slate-700');
    
    // Team scores for bonus icon evaluation
    const teamPlayerIds = currentTeam === 'team_a' ? (currCalc.team_a || []) : (currCalc.team_b || []);
    const teamScores = teamPlayerIds.map(id => currCalc.scores?.[id]).filter(s => s !== undefined && s !== null);

    let bonusIcons = '';

    // 1. Fire icon if its a turbo hole
    const isTurboHole = Boolean(currCalc.is_turbo || currCalc.match?.is_turbo) && Boolean(state.tournament?.game_settings?.turbo);
    const turboMult = state.tournament?.game_settings?.turbo_multiplier || 2;
    if (isTurboHole) {
      bonusIcons += `<span class="text-xs shrink-0" title="Turbo Hole (${turboMult}x Multiplier)">🔥</span>`;
    }

    // 2. Broom icon if its sweep (chuan / penetrate) on winning side
    if (currCalc.match?.is_penetrate && ptsDelta > 0) {
      bonusIcons += `<span class="text-xs shrink-0" title="${isThai ? 'Chuan (ชวน) Sweep' : 'Sweep (Penetrate)'}">🧹</span>`;
    }

    // 3. Bird icon for each birdie on the player's team
    const birdies = teamScores.filter(s => (s - par) === -1).length;
    for (let i = 0; i < birdies; i++) {
      bonusIcons += `<span class="text-xs shrink-0" title="Birdie (-1)">🐦</span>`;
    }

    // 4. Eagle icon for each eagle on the player's team
    const eagles = teamScores.filter(s => (s - par) === -2).length;
    for (let i = 0; i < eagles; i++) {
      bonusIcons += `<span class="text-xs shrink-0" title="Eagle (-2)">🦅</span>`;
    }

    // 5. Albatross icon for each albatross on the player's team
    const albatrosses = teamScores.filter(s => (s - par) <= -3).length;
    for (let i = 0; i < albatrosses; i++) {
      bonusIcons += `<span class="text-xs shrink-0" title="Albatross (-3+)">🪿</span>`;
    }

    deltaHtml = `
      <div class="flex items-center gap-1">
        ${bonusIcons ? `<span class="flex items-center gap-0.5">${bonusIcons}</span>` : ''}
        <span class="text-[9px] font-mono font-black px-1.5 py-0.2 rounded border ${cashClass}">${cashStr}</span>
      </div>
    `;
  }

  const isWolfMode = (state.tournament?.game_settings?.game_mode === 'WOLF');
  const isTheWolf = isWolfMode && (currCalc?.wolf_player?.id === p.id);
  const wolfBadge = isTheWolf 
    ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-900/80 text-purple-200 border border-purple-500/40 shrink-0">🐺 WOLF</span>` 
    : '';

  const wingIcon = p.hasHcp 
    ? `<span class="text-sky-300 text-xs" title="${isThai ? 'TOR -1 stroke applied' : 'Handicap -1 stroke applied'}">🪽</span>` 
    : '';

  return `
    <div 
      id="player-card-${p.id}" 
      draggable="${!isLocked}" 
      ondragstart="handleDragStart(event, '${p.id}')" 
      ondragend="handleDragEnd(event)"
      class="draggable-player-card p-2 sm:p-2.5 rounded-xl bg-slate-950 border border-slate-800 shadow-md ${lockedOpacity} space-y-2"
    >
      <!-- Top Row: Color indicator, Name, Angel wings, and Swap button -->
      <div class="flex items-center justify-between gap-1.5 min-w-0">
        <div class="flex items-center gap-1.5 min-w-0 truncate">
          <span class="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-white/30" style="background-color: ${p.color};"></span>
          <span class="text-xs font-black text-white truncate">${p.name}</span>
          ${wolfBadge}
          ${wingIcon}
        </div>

        <div class="flex items-center gap-1 shrink-0">
          ${deltaHtml}
          ${!isLocked ? `
            <button type="button" onclick="movePlayerToTeam('${p.id}', '${currentTeam === 'team_a' ? 'team_b' : 'team_a'}')" class="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition" title="Move to other team">
              <i data-lucide="arrow-left-right" class="w-3 h-3"></i>
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Vertical Dial Score Input -->
      <div class="flex items-center justify-between gap-2 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800/80">
        <div class="text-[10px] font-bold text-slate-400">
          <span>Score</span>
          ${p.hasHcp ? `<span class="block text-[9px] text-sky-400 font-extrabold leading-none">Net ${p.net}</span>` : ''}
        </div>

        <!-- Vertical Stepper Controls -->
        <div class="vertical-score-dial flex items-center gap-1.5">
          <button type="button" ${disabledAttr} onclick="stepScore('${p.id}', -1)" class="dial-btn w-8 h-8 rounded-lg bg-slate-950 border border-slate-700 text-white font-black text-base flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none">
            −
          </button>
          
          <div class="w-10 h-8 rounded-lg bg-slate-950 border-2 border-amber-500/80 flex items-center justify-center text-sm font-black text-white font-mono shadow-inner">
            ${p.score}
          </div>

          <button type="button" ${disabledAttr} onclick="stepScore('${p.id}', 1)" class="dial-btn w-8 h-8 rounded-lg bg-slate-950 border border-slate-700 text-white font-black text-base flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none">
            +
          </button>
        </div>
      </div>

    </div>
  `;
}

function renderScoringActionBar(hNum, currCalc) {
  const container = document.getElementById('scoring-action-container');
  if (!container) return;

  const existingScores = currCalc?.scores || {};
  const isHolePlayed = existingScores && Object.keys(existingScores).length > 0;
  const isUnlocked = Boolean(state.unlockedHoles[`${hNum}`]);
  const isLocked = isHolePlayed && !isUnlocked;

  if (isLocked) {
    container.innerHTML = `
      <button type="button" onclick="openEditWarningModal(${hNum})" class="flex-1 py-3 px-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-extrabold text-xs border border-amber-500/40 transition flex items-center justify-center gap-1.5 shadow-sm">
        <i data-lucide="unlock" class="w-4 h-4 text-amber-400"></i>
        <span>Unlock & Edit Hole ${hNum}</span>
      </button>
      ${hNum < 18 ? `
        <button type="button" onclick="selectHole(${hNum + 1})" class="flex-1 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20">
          <span>Next Hole (${hNum + 1})</span>
          <i data-lucide="arrow-right" class="w-4 h-4"></i>
        </button>
      ` : ''}
    `;
  } else {
    container.innerHTML = `
      <button type="button" onclick="clearHoleScores(${hNum})" class="py-3 px-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 font-extrabold text-xs border border-slate-800 transition flex items-center justify-center gap-1" title="Clear Hole ${hNum}">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        <span class="hidden sm:inline">Clear</span>
      </button>

      <button type="button" onclick="saveHoleScores(${hNum})" class="flex-1 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xs sm:text-sm shadow-xl shadow-emerald-500/25 transition flex items-center justify-center gap-1.5">
        <i data-lucide="check-circle-2" class="w-4 h-4"></i>
        <span>Save</span>
      </button>

      ${hNum < 18 ? `
        <button type="button" onclick="selectHole(${hNum + 1})" class="py-3.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-extrabold text-xs sm:text-sm border border-slate-700 transition flex items-center justify-center gap-1.5 shadow-md">
          <span>Next Hole</span>
          <i data-lucide="arrow-right" class="w-4 h-4"></i>
        </button>
      ` : ''}
    `;
  }
  initIcons();
}

// Drag and Drop Handlers
function handleDragStart(e, playerId) {
  state.draggedPlayerId = playerId;
  e.dataTransfer.setData('text/plain', playerId);
  const card = document.getElementById(`player-card-${playerId}`);
  if (card) card.classList.add('is-dragging');
}

function handleDragEnd(e) {
  if (state.draggedPlayerId) {
    const card = document.getElementById(`player-card-${state.draggedPlayerId}`);
    if (card) card.classList.remove('is-dragging');
  }
  state.draggedPlayerId = null;
  document.querySelectorAll('.team-dropzone').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e, targetTeam) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const playerId = e.dataTransfer.getData('text/plain') || state.draggedPlayerId;
  if (!playerId) return;

  movePlayerToTeam(playerId, targetTeam);
}

function movePlayerToTeam(playerId, targetTeam) {
  state.teamA = state.teamA.filter(id => id !== playerId);
  state.teamB = state.teamB.filter(id => id !== playerId);

  if (targetTeam === 'team_a') {
    state.teamA.push(playerId);
  } else {
    state.teamB.push(playerId);
  }

  renderScoringTab();
  initIcons();
}

function stepScore(playerId, delta) {
  const current = state.localScores[playerId] !== undefined 
    ? state.localScores[playerId] 
    : (state.tournament?.calculated_holes?.find(h => h.hole === state.currentHole)?.scores?.[playerId] || 4);

  const nextScore = Math.max(1, Math.min(15, current + delta));
  state.localScores[playerId] = nextScore;
  renderScoringTab();
  initIcons();
}

async function saveHoleScores(hNum) {
  const hSpec = state.tournament?.holes?.find(h => h.hole === hNum) || { par: 4 };
  const players = state.tournament?.players || [];
  const currCalc = state.tournament?.calculated_holes?.find(h => h.hole === hNum);
  const existingScores = currCalc?.scores || {};

  const scorePayload = {};
  players.forEach(p => {
    if (state.localScores[p.id] !== undefined) {
      scorePayload[p.id] = state.localScores[p.id];
    } else if (existingScores[p.id] !== undefined) {
      scorePayload[p.id] = existingScores[p.id];
    } else {
      scorePayload[p.id] = hSpec.par || 4;
    }
  });

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hole: hNum,
        scores: scorePayload,
        team_a: state.teamA,
        team_b: state.teamB
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.localScores = {};
      delete state.unlockedHoles[`${hNum}`];
      updateTournamentState(data);
    }
  } catch (err) {
    console.error("Error saving score:", err);
  }
}

async function clearHoleScores(hNum) {
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hole: hNum,
        scores: {}
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.localScores = {};
      delete state.unlockedHoles[`${hNum}`];
      updateTournamentState(data);
    }
  } catch (err) {
    console.error("Error clearing score:", err);
  }
}

// ================= TAB 2: SCORECARD =================
function renderScorecardTable() {
  const table = document.getElementById('full-scorecard-table');
  if (!table || !state.tournament) return;

  const holes = state.tournament.holes || [];
  const players = state.tournament.players || [];
  const scorecards = state.tournament.player_scorecards || [];

  const outPar = holes.slice(0, 9).reduce((a, b) => a + (b.par || 4), 0);
  const inPar = holes.slice(9, 18).reduce((a, b) => a + (b.par || 4), 0);
  const totPar = outPar + inPar;

  let html = `
    <thead>
      <!-- Header Row -->
      <tr class="bg-slate-950 text-slate-400 font-black text-[10px] uppercase">
        <th class="py-2.5 px-3 text-left min-w-[130px] sticky left-0 z-20 bg-slate-950">Player</th>
        ${holes.slice(0, 9).map(h => `<th class="w-8">${h.is_turbo ? '🔥' : ''}H${h.hole}</th>`).join('')}
        <th class="w-10 bg-slate-900 text-amber-400 font-black">OUT</th>
        ${holes.slice(9, 18).map(h => `<th class="w-8">${h.is_turbo ? '🔥' : ''}H${h.hole}</th>`).join('')}
        <th class="w-10 bg-slate-900 text-amber-400 font-black">IN</th>
        <th class="w-11 bg-slate-900 text-white font-black">TOT</th>
        <th class="w-10 bg-slate-900 text-amber-300 font-black">+/-</th>
      </tr>
      
      <!-- Par Row -->
      <tr class="bg-slate-900 text-slate-300 font-extrabold text-[10px] border-t border-slate-800">
        <td class="text-left px-3 font-bold sticky left-0 z-20 bg-slate-900 text-slate-300">PAR</td>
        ${holes.slice(0, 9).map(h => `<td>${h.par || 4}</td>`).join('')}
        <td class="font-black text-amber-400 bg-slate-950">${outPar}</td>
        ${holes.slice(9, 18).map(h => `<td>${h.par || 4}</td>`).join('')}
        <td class="font-black text-amber-400 bg-slate-950">${inPar}</td>
        <td class="font-black text-white bg-slate-950">${totPar}</td>
        <td class="font-black text-amber-400 bg-slate-950">E</td>
      </tr>

      <!-- Handicap Row -->
      <tr class="bg-slate-900/70 text-slate-400 font-bold text-[10px] border-b border-slate-800">
        <td class="text-left px-3 font-bold sticky left-0 z-20 bg-slate-900 text-slate-400">HCP</td>
        ${holes.slice(0, 9).map(h => `<td class="text-slate-400 font-mono">${h.handicap ?? '-'}</td>`).join('')}
        <td class="font-bold text-slate-600 bg-slate-950">-</td>
        ${holes.slice(9, 18).map(h => `<td class="text-slate-400 font-mono">${h.handicap ?? '-'}</td>`).join('')}
        <td class="font-bold text-slate-600 bg-slate-950">-</td>
        <td class="font-bold text-slate-600 bg-slate-950">-</td>
        <td class="font-bold text-slate-600 bg-slate-950">-</td>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-800">
  `;

  scorecards.forEach(p => {
    html += `
      <tr class="hover:bg-slate-900/60 transition font-medium">
        <!-- Player Name Cell -->
        <td class="text-left px-3 py-2 sticky left-0 z-10 bg-slate-950/95 border-r border-slate-800">
          <div class="flex items-center gap-1.5">
            <span class="w-3 h-3 rounded-full shrink-0 border border-white/30" style="background-color: ${p.color};"></span>
            <span class="font-black text-white text-xs truncate max-w-[90px]">${p.name}</span>
          </div>
        </td>
    `;

    // Front 9 (H1 to H9)
    for (let h = 1; h <= 9; h++) {
      const score = p.scores ? p.scores[str(h)] : null;
      const par = (holes[h - 1] || {}).par || 4;
      const hasHcp = p.handicap_holes && p.handicap_holes.includes(h);
      html += `<td>${renderGolfBadge(score, par, hasHcp)}</td>`;
    }

    // OUT Total
    html += `<td class="font-black bg-slate-900/80 text-slate-200">${p.out_gross || '-'}</td>`;

    // Back 9 (H10 to H18)
    for (let h = 10; h <= 18; h++) {
      const score = p.scores ? p.scores[str(h)] : null;
      const par = (holes[h - 1] || {}).par || 4;
      const hasHcp = p.handicap_holes && p.handicap_holes.includes(h);
      html += `<td>${renderGolfBadge(score, par, hasHcp)}</td>`;
    }

    // IN Total
    html += `<td class="font-black bg-slate-900/80 text-slate-200">${p.in_gross || '-'}</td>`;

    // TOT Gross
    html += `<td class="font-black bg-slate-900 text-white">${p.total_gross || '-'}</td>`;

    // +/- To-Par
    const toPar = p.total_to_par || 0;
    let toParClass = "text-slate-400";
    if (p.total_played > 0) {
      if (toPar < 0) toParClass = "text-red-400 font-black";
      else if (toPar === 0) toParClass = "text-amber-400 font-black";
      else toParClass = "text-blue-400 font-black";
    }
    html += `<td class="font-black bg-slate-900 ${toParClass}">${p.total_played > 0 ? p.to_par_display : '-'}</td>`;

    html += `</tr>`;
  });

  html += `</tbody>`;
  table.innerHTML = html;
}

function renderGolfBadge(score, par, hasHcp) {
  if (score === null || score === undefined) return '<span class="text-slate-600">-</span>';
  const diff = score - par;
  const hcpDot = hasHcp ? `<span class="text-[8px] text-sky-400 block -mt-1 font-black">🪽</span>` : '';
  
  if (diff <= -2) return `<span class="golf-badge golf-eagle">${score}</span>${hcpDot}`;
  if (diff === -1) return `<span class="golf-badge golf-birdie">${score}</span>${hcpDot}`;
  if (diff === 0) return `<span class="golf-badge golf-par">${score}</span>${hcpDot}`;
  if (diff === 1) return `<span class="golf-badge golf-bogey">${score}</span>${hcpDot}`;
  return `<span class="golf-badge golf-double-bogey">${score}</span>${hcpDot}`;
}

// ================= TAB 3: MOMENTUM CHART =================
function renderMomentumChart() {
  if (!state.tournament) return;
  const canvas = document.getElementById('momentum-chart-all');
  if (!canvas) return;

  const scorecards = state.tournament.player_scorecards || [];
  const settings = state.tournament.game_settings || {};
  const curr = settings.currency || 'THB';
  const sym = getCurrencySymbol(curr);

  // Currency Label
  const currLabel = document.getElementById('momentum-currency-label');
  if (currLabel) currLabel.textContent = `${curr} (${sym})`;

  // Summary Cards
  const summaryContainer = document.getElementById('momentum-summary-cards');
  if (summaryContainer) {
    const leader = state.tournament.leader_player;
    const maxWon = Math.max(...scorecards.map(p => p.total_cash || 0), 0);
    const maxThru = state.tournament.max_thru || 0;

    summaryContainer.innerHTML = `
      <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 shadow-md">
        <span class="text-[10px] uppercase font-bold text-amber-400 block mb-0.5">👑 Top Earner</span>
        <strong class="text-xs sm:text-sm font-black text-white truncate block">${leader ? leader.name : '-'}</strong>
        <span class="text-xs font-mono font-bold ${leader && leader.total_cash > 0 ? 'text-emerald-400' : 'text-slate-300'}">${leader ? formatCash(leader.total_cash, curr) : '0'}</span>
      </div>
      <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 shadow-md">
        <span class="text-[10px] uppercase font-bold text-emerald-400 block mb-0.5">Max Won</span>
        <strong class="text-xs sm:text-sm font-black text-emerald-400 block">${formatCash(maxWon, curr)}</strong>
        <span class="text-[10px] text-slate-500 font-medium">Peak earnings</span>
      </div>
      <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 shadow-md">
        <span class="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Rate / Point</span>
        <strong class="text-xs sm:text-sm font-black text-white block">${sym}${settings.cash_per_point || 100}</strong>
        <span class="text-[10px] text-slate-500 font-medium">Betting stake</span>
      </div>
      <div class="p-3 rounded-2xl bg-slate-900 border border-slate-800 shadow-md">
        <span class="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Thru Hole</span>
        <strong class="text-xs sm:text-sm font-black text-amber-400 block">${maxThru > 0 ? `Hole ${maxThru}` : 'Tee Off'}</strong>
        <span class="text-[10px] text-slate-500 font-medium">Match progress</span>
      </div>
    `;
  }

  const labels = ['Tee', ...Array.from({ length: 18 }, (_, i) => `H${i + 1}`)];

  const datasets = scorecards.map(p => {
    return {
      label: p.name,
      data: p.momentum || [0],
      borderColor: p.color || '#F59E0B',
      backgroundColor: p.color || '#F59E0B',
      borderWidth: 2.5,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: p.color || '#F59E0B',
      pointBorderColor: '#0F172A',
      tension: 0.2,
      spanGaps: true
    };
  });

  if (state.momentumChart) {
    state.momentumChart.destroy();
  }

  const ctx = canvas.getContext('2d');
  state.momentumChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#94A3B8',
            font: { size: 11, weight: 'bold' },
            boxWidth: 12
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#F59E0B',
          bodyColor: '#FFFFFF',
          borderColor: '#334155',
          borderWidth: 1.5,
          padding: 10,
          callbacks: {
            label: function(ctx) {
              const val = ctx.parsed.y;
              return `${ctx.dataset.label}: ${formatCash(val, curr)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: { color: '#94A3B8', font: { size: 10, weight: 'bold' } }
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: {
            color: '#94A3B8',
            font: { size: 10, weight: 'bold' },
            callback: function(v) {
              return formatCash(v, curr);
            }
          }
        }
      }
    }
  });
}

// ================= TAB 4: LEADERBOARD =================
function renderLeaderboard() {
  if (!state.tournament) return;
  const t = state.tournament;
  const lb = t.leaderboard || [];
  const rowsContainer = document.getElementById('leaderboard-rows');
  const settings = t.game_settings || {};
  const isWolf = (settings.game_mode === 'WOLF');
  const curr = settings.currency || 'THB';

  const lbTitle = document.getElementById('lb-title');
  if (lbTitle) lbTitle.textContent = `${t.tournament_name || 'Sunday Golf Match'} Leaderboard`;

  const lbMode = document.getElementById('lb-mode-txt');
  if (lbMode) {
    if (isWolf) {
      lbMode.textContent = '🐺 WOLF GAME';
    } else if (settings.game_mode === 'FREE_FOR_ALL' || settings.game_mode === 'FFA') {
      lbMode.textContent = 'FREE-FOR-ALL MATCH';
    } else {
      lbMode.textContent = 'TEAMS MATCH';
    }
  }

  const lbCourse = document.getElementById('lb-course-txt');
  if (lbCourse) lbCourse.textContent = t.course_name || 'Krungthep Kreetha';

  const progressTxt = document.getElementById('lb-progress-txt');
  if (progressTxt) progressTxt.textContent = `${t.max_thru || 0} of 18 holes played`;

  if (!rowsContainer) return;

  if (lb.length === 0) {
    rowsContainer.innerHTML = `<div class="py-6 text-center text-xs text-slate-500 font-bold">No players registered.</div>`;
    return;
  }

  rowsContainer.innerHTML = lb.map((p, idx) => {
    const cashStr = formatCash(p.total_cash, curr);
    let cashClass = "cash-neutral";
    if (p.total_played > 0) {
      if (p.total_cash > 0) cashClass = "cash-positive";
      else if (p.total_cash < 0) cashClass = "cash-negative";
    }

    const rankStr = p.rank_display || (idx + 1);

    return `
      <div class="grid grid-cols-12 items-center py-3 px-3 text-xs hover:bg-slate-800/40 transition">
        
        <!-- POS -->
        <div class="col-span-1 text-center font-mono font-black ${idx === 0 && p.total_played > 0 ? 'text-amber-400 text-sm' : 'text-slate-300'}">
          ${rankStr}
        </div>

        <!-- Player Name & Color -->
        <div class="col-span-4 pl-2 flex items-center gap-2 min-w-0">
          <span class="w-3.5 h-3.5 rounded-full shrink-0 border border-white/40 shadow-sm" style="background-color: ${p.color};"></span>
          <span class="font-extrabold text-white truncate text-xs sm:text-sm">${p.name}</span>
        </div>

        <!-- TO PAR -->
        <div class="col-span-2 text-center font-mono font-bold ${p.total_to_par < 0 ? 'text-red-400' : (p.total_to_par > 0 ? 'text-blue-400' : 'text-amber-300')}">
          ${p.total_played > 0 ? p.to_par_display : '-'}
        </div>

        <!-- GROSS -->
        <div class="col-span-2 text-center font-mono text-slate-300">
          ${p.total_gross || '-'}
        </div>

        <!-- CASH -->
        <div class="col-span-3 text-right pr-2 font-mono text-xs sm:text-sm ${cashClass}">
          ${p.total_played > 0 ? cashStr : '-'}
        </div>

      </div>
    `;
  }).join('');
}

// ================= TAB 5: GAME SETTINGS & COURSE =================
function renderSettingsForms() {
  if (!state.tournament) return;
  const t = state.tournament;
  const settings = t.game_settings || {};
  const players = t.players || [];

  // Tournament Title
  const tournInp = document.getElementById('cfg-tourn-title');
  if (tournInp) tournInp.value = t.tournament_name || 'Sunday Golf Match';

  // Game Mode Buttons
  setGameModeUI(settings.game_mode || 'TEAMS');

  // Hand count, Cash, Currency
  const handInp = document.getElementById('cfg-hand-count');
  if (handInp) handInp.value = settings.hand_count || 2;

  const cashInp = document.getElementById('cfg-cash-per-point');
  if (cashInp) cashInp.value = settings.cash_per_point || 100;

  const currSelect = document.getElementById('cfg-currency');
  if (currSelect) currSelect.value = settings.currency || 'THB';

  // Turbo & Multiplier
  const turboCheck = document.getElementById('cfg-turbo-enabled');
  if (turboCheck) turboCheck.checked = Boolean(settings.turbo);
  onTurboToggled(Boolean(settings.turbo), false);

  const turboMultInp = document.getElementById('cfg-turbo-multiplier');
  if (turboMultInp) turboMultInp.value = settings.turbo_multiplier || 2;

  // Turbo Handicap
  const turboHcpCheck = document.getElementById('cfg-turbo-handicap');
  if (turboHcpCheck) turboHcpCheck.checked = Boolean(settings.turbo_handicap);

  // Penetrate (Chuan)
  const penCheck = document.getElementById('cfg-penetrate-enabled');
  if (penCheck) penCheck.checked = Boolean(settings.penetrate);
  onPenetrateToggled(Boolean(settings.penetrate), false);

  const penBonusInp = document.getElementById('cfg-penetrate-bonus');
  if (penBonusInp) penBonusInp.value = settings.penetrate_bonus || 1;

  // Birdie, Eagle, Albatross Bonuses
  const birdieInp = document.getElementById('cfg-birdie-point');
  if (birdieInp) birdieInp.value = settings.birdie_point || 2;

  const eagleInp = document.getElementById('cfg-eagle-point');
  if (eagleInp) eagleInp.value = settings.eagle_point || 3;

  const albatrossInp = document.getElementById('cfg-albatross-point');
  if (albatrossInp) albatrossInp.value = settings.albatross_point || 4;

  // Player Count & Lineup
  const countInp = document.getElementById('cfg-player-count');
  if (countInp) countInp.value = players.length || 4;
  const countPill = document.getElementById('lineup-count-pill');
  if (countPill) countPill.textContent = `${players.length || 4} Players`;
  renderPlayerLineupCards(players);
  renderDefaultTeamsBox();

  // Course Holes Table
  renderCourseHolesTable();
}

function togglePlayerLineupAccordion() {
  const body = document.getElementById('lineup-collapsible-body');
  const icon = document.getElementById('lineup-chevron-icon');
  if (!body) return;
  const isHidden = body.classList.contains('hidden');
  if (isHidden) {
    body.classList.remove('hidden');
    if (icon) icon.style.transform = 'rotate(180deg)';
  } else {
    body.classList.add('hidden');
    if (icon) icon.style.transform = 'rotate(0deg)';
  }
  initIcons();
}

function setGameMode(mode) {
  setGameModeUI(mode);
}

function setGameModeUI(mode) {
  const rawMode = String(mode || 'TEAMS').toUpperCase();
  const isWolf = (rawMode === 'WOLF');
  const isFFA = (rawMode === 'FREE_FOR_ALL' || rawMode === 'FFA');
  const isTeams = (!isWolf && !isFFA);

  const btnTeams = document.getElementById('btn-mode-teams');
  const btnFfa = document.getElementById('btn-mode-ffa');
  const btnWolf = document.getElementById('btn-mode-wolf');
  const helpTxt = document.getElementById('mode-help-text');

  const defTeamsBox = document.getElementById('default-teams-box');
  const handCountBox = document.getElementById('hand-count-box');
  const penBox = document.getElementById('penetrate-box');

  const inactiveBtnClass = "py-2.5 px-2 rounded-xl font-black text-xs transition border flex items-center justify-center gap-1 bg-slate-900 text-slate-400 border-slate-700 hover:text-white";

  if (btnTeams) {
    btnTeams.className = isTeams 
      ? "py-2.5 px-2 rounded-xl font-black text-xs transition border flex items-center justify-center gap-1 bg-amber-500 text-slate-950 border-amber-400 shadow-md" 
      : inactiveBtnClass;
  }
  if (btnFfa) {
    btnFfa.className = isFFA 
      ? "py-2.5 px-2 rounded-xl font-black text-xs transition border flex items-center justify-center gap-1 bg-emerald-500 text-slate-950 border-emerald-400 shadow-md" 
      : inactiveBtnClass;
  }
  if (btnWolf) {
    btnWolf.className = isWolf 
      ? "py-2.5 px-2 rounded-xl font-black text-xs transition border flex items-center justify-center gap-1 bg-purple-600 text-white border-purple-400 shadow-md" 
      : inactiveBtnClass;
  }

  if (helpTxt) {
    if (isWolf) {
      helpTxt.textContent = "In Wolf mode, each player is the Wolf in rotation (tees off last) and can pick 1 partner or go Lone Wolf.";
    } else if (isFFA) {
      helpTxt.textContent = "In Free-For-All mode, all players compete 1-on-1 against each other across all pairings on every hole.";
    } else {
      helpTxt.textContent = "In Teams mode, players are divided into Left (Team A) and Right (Team B) teams for hole-by-hole match play.";
    }
  }

  if (defTeamsBox) {
    if (isTeams) defTeamsBox.classList.remove('hidden');
    else defTeamsBox.classList.add('hidden');
  }

  if (handCountBox) {
    if (isFFA) handCountBox.classList.add('hidden');
    else handCountBox.classList.remove('hidden');
  }

  if (penBox) {
    if (isFFA) penBox.classList.add('hidden');
    else penBox.classList.remove('hidden');
  }
}

function renderDefaultTeamsBox() {
  const container = document.getElementById('default-teams-player-list');
  if (!container || !state.tournament) return;

  const players = state.tournament.players || [];
  container.innerHTML = players.map(p => {
    const team = p.default_team || 'left';
    const isLeft = (team === 'left');
    const isRight = (team === 'right');

    return `
      <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm">
        <div class="flex items-center gap-2 min-w-0 pr-1">
          <span class="w-3.5 h-3.5 rounded-full shrink-0 border border-white/40 shadow-sm" style="background-color: ${p.color};"></span>
          <span class="font-black text-white text-xs truncate">${p.name}</span>
        </div>
        <div class="team-toggle-group shrink-0">
          <button type="button" onclick="togglePlayerDefaultTeam('${p.id}', 'left')" class="team-toggle-btn ${isLeft ? 'active-left' : ''}">Left</button>
          <button type="button" onclick="togglePlayerDefaultTeam('${p.id}', 'right')" class="team-toggle-btn ${isRight ? 'active-right' : ''}">Right</button>
        </div>
      </div>
    `;
  }).join('');
}

async function togglePlayerDefaultTeam(playerId, team) {
  if (!state.tournament || !state.tournament.players) return;
  const player = state.tournament.players.find(p => p.id === playerId);
  if (!player) return;

  player.default_team = team;
  renderDefaultTeamsBox();

  // Instantly re-align scoring tab teams
  syncHoleTeamAssignments();
  renderScoringTab();

  // Persist default_teams map to server
  const defaultTeamsMap = {};
  state.tournament.players.forEach(p => {
    defaultTeamsMap[p.id] = p.default_team || 'left';
  });

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_settings: {
          default_teams: defaultTeamsMap
        }
      })
    });
    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
    }
  } catch (err) {
    console.error("Error updating default teams:", err);
  }
}

function onTurboToggled(isChecked, markModified = true) {
  const multWrap = document.getElementById('turbo-multiplier-wrap');
  const hcpBox = document.getElementById('turbo-handicap-box');

  if (multWrap) {
    if (isChecked) multWrap.classList.remove('hidden');
    else multWrap.classList.add('hidden');
  }

  if (hcpBox) {
    if (isChecked) {
      hcpBox.classList.remove('opacity-50', 'pointer-events-none');
    } else {
      hcpBox.classList.add('opacity-50', 'pointer-events-none');
    }
  }

  if (markModified) {
    markCourseModified();
  }
}

function onPenetrateToggled(isChecked) {
  const bonusWrap = document.getElementById('penetrate-bonus-wrap');
  if (bonusWrap) {
    if (isChecked) bonusWrap.classList.remove('hidden');
    else bonusWrap.classList.add('hidden');
  }
}

function onCurrencyChanged(curr) {
  applyThaiEditionText();
}

function onPlayerCountChanged(val) {
  const count = Math.max(3, Math.min(6, parseInt(val) || 4));
  const countInp = document.getElementById('cfg-player-count');
  if (countInp) countInp.value = count;
  const countPill = document.getElementById('lineup-count-pill');
  if (countPill) countPill.textContent = `${count} Players`;

  const currentPlayers = state.tournament?.players || [];
  const newPlayers = [];

  for (let i = 0; i < count; i++) {
    if (currentPlayers[i]) {
      newPlayers.push({ ...currentPlayers[i] });
    } else {
      newPlayers.push({
        id: `p${i + 1}`,
        name: DEFAULT_NAMES[i],
        color: DEFAULT_COLORS[i],
        hcp_out: 0,
        hcp_in: 0,
        default_team: i < Math.ceil(count / 2) ? 'left' : 'right'
      });
    }
  }

  renderPlayerLineupCards(newPlayers);
  if (state.tournament) {
    state.tournament.players = newPlayers;
  }
  renderDefaultTeamsBox();
}

function renderPlayerLineupCards(players) {
  const container = document.getElementById('player-lineup-container');
  if (!container) return;

  const isThai = isThaiMode();
  const torLabel = isThai ? 'TOR (ต่อ)' : 'Handicap';

  container.innerHTML = players.map((p, idx) => {
    return `
      <div id="cfg-player-card-${idx}" class="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3 shadow-md">
        
        <div class="flex items-center justify-between gap-2 pb-1 border-b border-slate-800">
          <span class="text-xs font-black text-amber-400 uppercase">Player ${idx + 1}</span>
          <div class="flex items-center gap-2">
            <label class="text-[10px] text-slate-400 font-bold uppercase">Color:</label>
            <input id="p-col-${idx}" type="color" value="${p.color || DEFAULT_COLORS[idx]}" class="w-7 h-7 rounded-lg bg-transparent cursor-pointer border-0">
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-bold text-slate-300 mb-1">Player Name</label>
          <input id="p-name-${idx}" type="text" value="${p.name || DEFAULT_NAMES[idx]}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-bold text-xs focus:ring-1 focus:ring-amber-500">
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-0.5">${torLabel} OUT (H1-9)</label>
            <input id="p-out-${idx}" type="number" min="0" max="9" value="${p.hcp_out || 0}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 text-center text-white font-mono text-xs">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-400 mb-0.5">${torLabel} IN (H10-18)</label>
            <input id="p-in-${idx}" type="number" min="0" max="9" value="${p.hcp_in || 0}" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 text-center text-white font-mono text-xs">
          </div>
        </div>

      </div>
    `;
  }).join('');
}

async function savePlayersLineup() {
  const countInp = document.getElementById('cfg-player-count');
  const count = Math.max(3, Math.min(6, parseInt(countInp?.value) || 4));
  const currentPlayers = state.tournament?.players || [];

  const playersPayload = [];
  for (let i = 0; i < count; i++) {
    const name = document.getElementById(`p-name-${i}`)?.value.trim() || DEFAULT_NAMES[i];
    const color = document.getElementById(`p-col-${i}`)?.value || DEFAULT_COLORS[i];
    const hcpOut = parseInt(document.getElementById(`p-out-${i}`)?.value) || 0;
    const hcpIn = parseInt(document.getElementById(`p-in-${i}`)?.value) || 0;
    const existing = currentPlayers[i] || {};
    const defaultTeam = existing.default_team || (i < Math.ceil(count / 2) ? 'left' : 'right');

    playersPayload.push({
      id: `p${i + 1}`,
      name: name,
      color: color,
      hcp_out: hcpOut,
      hcp_in: hcpIn,
      default_team: defaultTeam
    });
  }

  try {
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: playersPayload })
    });

    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
      alert("Players lineup saved successfully!");
    }
  } catch (err) {
    console.error("Error saving players:", err);
  }
}

async function saveGameSettings() {
  const title = document.getElementById('cfg-tourn-title')?.value.trim() || 'Sunday Golf Match';
  const isWolf = document.getElementById('btn-mode-wolf')?.classList.contains('bg-purple-600');
  const isFFA = document.getElementById('btn-mode-ffa')?.classList.contains('bg-emerald-500');
  let gameMode = 'TEAMS';
  if (isWolf) gameMode = 'WOLF';
  else if (isFFA) gameMode = 'FREE_FOR_ALL';

  const handCount = parseInt(document.getElementById('cfg-hand-count')?.value) || 2;
  const cashPerPoint = parseInt(document.getElementById('cfg-cash-per-point')?.value) || 100;
  const currency = document.getElementById('cfg-currency')?.value || 'THB';
  const turbo = document.getElementById('cfg-turbo-enabled')?.checked || false;
  const turboMult = parseInt(document.getElementById('cfg-turbo-multiplier')?.value) || 2;
  const turboHcp = document.getElementById('cfg-turbo-handicap')?.checked || false;
  const penetrate = document.getElementById('cfg-penetrate-enabled')?.checked || false;
  const penetrateBonus = parseInt(document.getElementById('cfg-penetrate-bonus')?.value) || 1;
  const birdieBonus = parseInt(document.getElementById('cfg-birdie-point')?.value) || 2;
  const eagleBonus = parseInt(document.getElementById('cfg-eagle-point')?.value) || 3;
  const albatrossBonus = parseInt(document.getElementById('cfg-albatross-point')?.value) || 4;

  const defaultTeamsMap = {};
  (state.tournament?.players || []).forEach(p => {
    defaultTeamsMap[p.id] = p.default_team || 'left';
  });

  const payload = {
    tournament_name: title,
    game_settings: {
      game_mode: gameMode,
      hand_count: handCount,
      cash_per_point: cashPerPoint,
      currency: currency,
      turbo: turbo,
      turbo_multiplier: turboMult,
      turbo_handicap: turboHcp,
      penetrate: penetrate,
      penetrate_bonus: penetrateBonus,
      birdie_point: birdieBonus,
      eagle_point: eagleBonus,
      albatross_point: albatrossBonus,
      default_teams: defaultTeamsMap
    }
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
      alert("Game settings saved successfully!");
    }
  } catch (err) {
    console.error("Error saving settings:", err);
  }
}

// ================= COURSE SETUP & SPECIFICATIONS =================
function renderCourseSelector() {
  const select = document.getElementById('course-selector');
  if (!select) return;

  const currentCourseId = state.tournament?.course_id || 'course-krungthep-kreetha';

  select.innerHTML = state.courses.map(c => `
    <option value="${c.id}" ${c.id === currentCourseId ? 'selected' : ''}>
      ${c.name}
    </option>
  `).join('');
}

function onCourseSelected(courseId) {
  const selectedCourse = state.courses.find(c => c.id === courseId);
  if (!selectedCourse) return;

  const holes = selectedCourse.holes.map(h => ({
    hole: h.hole,
    par: h.par,
    handicap: h.handicap,
    is_turbo: (h.hole === 9 || h.hole === 18)
  }));

  state.tournament.course_id = selectedCourse.id;
  state.tournament.course_name = selectedCourse.name;
  state.tournament.holes = holes;

  markCourseModified();
  renderCourseHolesTable();
}

function markCourseModified() {
  state.isCourseModified = true;
  const btn = document.getElementById('btn-save-course');
  if (btn) {
    btn.className = "py-2 px-5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-500/25 flex items-center gap-1.5 ring-2 ring-emerald-400";
  }
}

function renderCourseHolesTable() {
  const tbody = document.getElementById('course-holes-tbody');
  if (!tbody || !state.tournament) return;

  const holes = state.tournament.holes || [];
  const turboEnabled = document.getElementById('cfg-turbo-enabled')?.checked || false;

  tbody.innerHTML = holes.map(h => {
    const par = h.par || 4;
    return `
      <tr class="hover:bg-slate-900/40 transition font-semibold">
        <td class="py-2.5 px-2 text-left font-black text-amber-400">Hole ${h.hole}</td>
        <td class="py-2.5 px-2">
          <div class="inline-flex items-center gap-1 bg-slate-900 border border-slate-700/80 p-0.5 rounded-xl" id="course-par-pill-${h.hole}" data-par="${par}">
            <button type="button" onclick="setHolePar(${h.hole}, 3)" id="par-btn-${h.hole}-3" class="px-2 py-0.5 rounded-lg text-xs font-black transition ${par === 3 ? 'bg-emerald-500 text-slate-950 shadow-md ring-1 ring-emerald-400' : 'text-slate-400 hover:text-white'}">P3</button>
            <button type="button" onclick="setHolePar(${h.hole}, 4)" id="par-btn-${h.hole}-4" class="px-2 py-0.5 rounded-lg text-xs font-black transition ${par === 4 ? 'bg-emerald-500 text-slate-950 shadow-md ring-1 ring-emerald-400' : 'text-slate-400 hover:text-white'}">P4</button>
            <button type="button" onclick="setHolePar(${h.hole}, 5)" id="par-btn-${h.hole}-5" class="px-2 py-0.5 rounded-lg text-xs font-black transition ${par === 5 ? 'bg-emerald-500 text-slate-950 shadow-md ring-1 ring-emerald-400' : 'text-slate-400 hover:text-white'}">P5</button>
          </div>
        </td>
        <td class="py-2.5 px-2">
          <input type="number" id="hcp-idx-${h.hole}" min="1" max="18" value="${h.handicap || 9}" onchange="markCourseModified()" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono text-xs w-16 text-center">
        </td>
        <td class="py-2.5 px-2">
          <input type="checkbox" id="turbo-chk-${h.hole}" ${h.is_turbo ? 'checked' : ''} ${!turboEnabled ? 'disabled' : ''} onchange="markCourseModified()" class="w-4 h-4 text-amber-500 rounded border-slate-700 bg-slate-900 disabled:opacity-30">
        </td>
      </tr>
    `;
  }).join('');

  recalculateCoursePars();
}

function setHolePar(hNum, parVal) {
  const pill = document.getElementById(`course-par-pill-${hNum}`);
  if (pill) pill.dataset.par = parVal;
  [3, 4, 5].forEach(p => {
    const btn = document.getElementById(`par-btn-${hNum}-${p}`);
    if (btn) {
      if (p === parVal) {
        btn.className = "px-2 py-0.5 rounded-lg text-xs font-black transition bg-emerald-500 text-slate-950 shadow-md ring-1 ring-emerald-400";
      } else {
        btn.className = "px-2 py-0.5 rounded-lg text-xs font-black transition text-slate-400 hover:text-white";
      }
    }
  });
  markCourseModified();
  recalculateCoursePars();
}

function recalculateCoursePars() {
  let outPar = 0;
  let inPar = 0;
  for (let i = 1; i <= 18; i++) {
    const pill = document.getElementById(`course-par-pill-${i}`);
    const p = parseInt(pill?.dataset?.par) || 4;
    if (i <= 9) outPar += p;
    else inPar += p;
  }
  const outEl = document.getElementById('course-out-par');
  const inEl = document.getElementById('course-in-par');
  const totEl = document.getElementById('course-tot-par');
  if (outEl) outEl.textContent = outPar;
  if (inEl) inEl.textContent = inPar;
  if (totEl) totEl.textContent = outPar + inPar;
}

async function saveCourseSpecs() {
  const select = document.getElementById('course-selector');
  const courseId = select?.value || state.tournament?.course_id || 'course-krungthep-kreetha';
  const selectedCourse = state.courses.find(c => c.id === courseId);
  const courseName = selectedCourse?.name || state.tournament?.course_name || 'Krungthep Kreetha';

  const holesPayload = [];
  for (let i = 1; i <= 18; i++) {
    const pill = document.getElementById(`course-par-pill-${i}`);
    const par = parseInt(pill?.dataset?.par) || 4;
    const hcp = parseInt(document.getElementById(`hcp-idx-${i}`)?.value) || 9;
    const isTurbo = document.getElementById(`turbo-chk-${i}`)?.checked || false;

    holesPayload.push({
      hole: i,
      par: par,
      handicap: hcp,
      is_turbo: isTurbo
    });
  }

  try {
    const res = await fetch('/api/course', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: courseId,
        course_name: courseName,
        holes: holesPayload
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.isCourseModified = false;
      const btn = document.getElementById('btn-save-course');
      if (btn) {
        btn.className = "py-2 px-5 rounded-xl bg-slate-800 text-slate-400 font-black text-xs transition border border-slate-700 flex items-center gap-1.5";
      }
      updateTournamentState(data);
      alert("Course specifications saved successfully!");
    }
  } catch (err) {
    console.error("Error saving course specs:", err);
  }
}

// ================= MODALS & ACTIONS =================
function openInfoModal(type) {
  const modal = document.getElementById('info-modal');
  const title = document.getElementById('info-modal-title');
  const desc = document.getElementById('info-modal-desc');
  const isThai = isThaiMode();

  if (!modal || !title || !desc) return;

  if (type === 'turbo') {
    title.textContent = "🔥 Turbo Holes Info";
    desc.textContent = "During turbo holes, all match points won by the winning side are multiplied by the Turbo Bonus Multiplier (default x2 for Normal mode, x(players) for Wolf mode).";
  } else if (type === 'turbo_handicap') {
    title.textContent = isThai ? "🪽 Turbo TOR (ต่อ) Info" : "🪽 Turbo Handicap Info";
    desc.textContent = isThai
      ? "หากเปิดใช้งาน หลุมที่เป็น Turbo จะสามารถได้รับสิทธิ์แต้มต่อ (TOR) ได้ตามลำดับความยากของหลุม"
      : "If checked, players' handicapped strokes OUT and IN will apply to turbo holes. If unchecked, turbo holes are skipped when allocating handicap strokes.";
  } else if (type === 'penetrate') {
    title.textContent = isThai ? "⚡ Chuan (ชวน) Bonus Info" : "⚡ Penetrate Bonus Info";
    desc.textContent = isThai
      ? "ชวน (Chuan): หากทีมใดชนะทุกคู่มือในการเปรียบเทียบ (All Hands Won) จะได้รับแต้มโบนัสชวนเพิ่มเติมตามที่กำหนด"
      : "Penetrate means all hands are won by one side. If that's the case, the Penetrate Bonus will be added to the points won.";
  }

  modal.classList.remove('hidden');
}

function closeInfoModal() {
  const modal = document.getElementById('info-modal');
  if (modal) modal.classList.add('hidden');
}

function openEditWarningModal(hNum) {
  const modal = document.getElementById('edit-warning-modal');
  const numSpan = document.getElementById('modal-edit-hole-num');
  if (numSpan) numSpan.textContent = hNum;
  if (modal) modal.classList.remove('hidden');
}

function closeEditWarningModal() {
  const modal = document.getElementById('edit-warning-modal');
  if (modal) modal.classList.add('hidden');
}

function confirmEditHole() {
  const hNum = state.currentHole;
  state.unlockedHoles[`${hNum}`] = true;
  closeEditWarningModal();
  renderScoringTab();
}

async function resetAllScores() {
  if (!confirm("Are you sure you want to clear ALL scores across all 18 holes and restart from Hole 1?")) return;

  try {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.ok) {
      const data = await res.json();
      state.localScores = {};
      state.unlockedHoles = {};
      updateTournamentState(data);
      selectHole(1);
    }
  } catch (err) {
    console.error("Error resetting scores:", err);
  }
}

async function restoreDefaultData() {
  if (!confirm("Restore default Sunday Golf Match setup with 4 players and reset all scores?")) return;

  try {
    const res = await fetch('/api/reset_default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.ok) {
      const data = await res.json();
      state.localScores = {};
      state.unlockedHoles = {};
      updateTournamentState(data);
      selectHole(1);
      alert("Default game setup restored successfully!");
    }
  } catch (err) {
    console.error("Error restoring defaults:", err);
  }
}

// ================= TAB NAVIGATION =================
function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

  const activeEl = document.getElementById(`tab-${tabId}`);
  if (activeEl) activeEl.classList.remove('hidden');

  const tabs = ['play', 'scorecard', 'momentum', 'leaderboard', 'settings'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    if (btn) {
      if (t === tabId) {
        btn.className = "flex-1 py-2 px-2 text-center rounded-xl transition flex items-center justify-center gap-1.5 bg-amber-500 text-slate-950 shadow-md font-black";
      } else {
        btn.className = "flex-1 py-2 px-2 text-center rounded-xl transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-white";
      }
    }

    const mobBtn = document.getElementById(`tab-btn-mobile-${t}`);
    if (mobBtn) {
      if (t === tabId) {
        mobBtn.className = "flex-1 flex flex-col items-center justify-center py-1 text-amber-400 font-black transition";
      } else {
        mobBtn.className = "flex-1 flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-200 font-medium transition";
      }
    }
  });

  if (tabId === 'scorecard') {
    renderScorecardTable();
  } else if (tabId === 'momentum') {
    renderMomentumChart();
  } else if (tabId === 'leaderboard') {
    renderLeaderboard();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  initIcons();
}

function str(v) {
  return String(v);
}
