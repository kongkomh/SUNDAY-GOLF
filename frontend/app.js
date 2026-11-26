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
  isCourseModified: false,
  currentUser: null,
  currentPlayer: null,
  roundId: null
};

function getUrlRoundId() {
  const params = new URLSearchParams(window.location.search);
  const qRound = params.get('round');
  if (qRound) return qRound;
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'round') return parts[1];
  return null;
}

function getRoundApiUrl(subpath = '') {
  const rId = state.roundId || (state.tournament ? (state.tournament.round_id || state.tournament.id) : null);
  if (rId) {
    return `/api/round/${rId}${subpath}`;
  }
  return subpath ? `/api${subpath}` : '/api/tournament';
}

function getPlayedHoleOrder() {
  if (state.tournament?.played_hole_order && Array.isArray(state.tournament.played_hole_order)) {
    return state.tournament.played_hole_order;
  }
  const startingHole = state.tournament?.starting_hole || 1;
  if (startingHole === 10) {
    return [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
}

function getNextHoleNumber(currentHole) {
  const playedSeq = getPlayedHoleOrder();
  const idx = playedSeq.indexOf(currentHole);
  if (idx >= 0 && idx < playedSeq.length - 1) {
    return playedSeq[idx + 1];
  }
  return null;
}

const DEFAULT_COLORS = [
  "#FFFFFF", // P1: White
  "#1E293B", // P2: Black
  "#EF4444", // P3: Red
  "#3B82F6", // P4: Blue
  "#10B981", // P5: Green
  "#F59E0B"  // P6: Yellow
];

const DEFAULT_NAMES = [
  "PLAYER 1",
  "PLAYER 2",
  "PLAYER 3",
  "PLAYER 4",
  "PLAYER 5",
  "PLAYER 6"
];

// ================= THEME SYSTEM =================
function initTheme() {
  const saved = localStorage.getItem('golf_app_theme') || 'fairway';
  setAppTheme(saved, false);
}

function toggleAppTheme() {
  const isFairway = document.documentElement.classList.contains('theme-fairway');
  setAppTheme(isFairway ? 'dark' : 'fairway', true);
}

function setAppTheme(theme, save = true) {
  const icon = document.getElementById('theme-toggle-icon');
  const label = document.getElementById('theme-toggle-label');
  const cardFairway = document.getElementById('theme-card-fairway');
  const cardDark = document.getElementById('theme-card-dark');

  if (theme === 'fairway') {
    document.documentElement.classList.add('theme-fairway');
    document.documentElement.classList.remove('dark');
    if (icon) icon.textContent = '☀️';
    if (label) label.textContent = 'Fairway';
    if (cardFairway) cardFairway.classList.add('ring-2', 'ring-[#16452e]', 'shadow-lg');
    if (cardDark) cardDark.classList.remove('ring-2', 'ring-amber-400', 'shadow-lg');
  } else {
    document.documentElement.classList.remove('theme-fairway');
    document.documentElement.classList.add('dark');
    if (icon) icon.textContent = '🌙';
    if (label) label.textContent = 'Dark';
    if (cardDark) cardDark.classList.add('ring-2', 'ring-amber-400', 'shadow-lg');
    if (cardFairway) cardFairway.classList.remove('ring-2', 'ring-[#16452e]', 'shadow-lg');
  }

  if (save) {
    localStorage.setItem('golf_app_theme', theme);
  }
}

// ================= SCREEN ROUTING =================
function showScreen(screenName) {
  const welcomeScreen = document.getElementById('welcome-screen');
  const lobbyScreen = document.getElementById('lobby-screen');
  const gameContainer = document.getElementById('game-container');
  const roundActions = document.getElementById('header-round-actions');
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  const liveIndicator = document.getElementById('live-indicator');
  const leaderPill = document.getElementById('header-leader-pill');
  const topMenuWrapper = document.getElementById('top-menu-wrapper');
  const headerTitle = document.getElementById('header-tournament-name');
  const headerCourse = document.getElementById('header-course-name');

  if (topMenuWrapper) {
    topMenuWrapper.classList.toggle('hidden', screenName === 'welcome');
  }

  if (screenName === 'welcome') {
    if (welcomeScreen) welcomeScreen.classList.remove('hidden');
    if (lobbyScreen) lobbyScreen.classList.add('hidden');
    if (gameContainer) gameContainer.classList.add('hidden');
    if (roundActions) roundActions.classList.add('hidden');
    if (mobileNav) mobileNav.classList.add('hidden');
    if (liveIndicator) liveIndicator.classList.add('hidden');
    if (leaderPill) leaderPill.classList.add('hidden');
    if (headerTitle) headerTitle.innerHTML = '<span>Sunday Golf Tracker</span>';
    if (headerCourse) headerCourse.textContent = 'Casual Golf, Match Play & Wolf Game';
  } else if (screenName === 'lobby') {
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    if (lobbyScreen) lobbyScreen.classList.remove('hidden');
    if (gameContainer) gameContainer.classList.add('hidden');
    if (roundActions) roundActions.classList.add('hidden');
    if (mobileNav) mobileNav.classList.add('hidden');
    if (liveIndicator) liveIndicator.classList.add('hidden');
    if (leaderPill) leaderPill.classList.add('hidden');
    const uName = state.currentUser ? (state.currentUser.given_name || state.currentUser.name?.split(' ')[0] || 'Golfer') : 'Golfer';
    const lobbyNameEl = document.getElementById('lobby-user-name');
    if (lobbyNameEl) lobbyNameEl.textContent = uName;
    if (headerTitle) headerTitle.innerHTML = '<span>Sunday Golf Tracker</span>';
    if (headerCourse) headerCourse.textContent = 'Welcome back! Choose or start a round.';
  } else if (screenName === 'game') {
    if (welcomeScreen) welcomeScreen.classList.add('hidden');
    if (lobbyScreen) lobbyScreen.classList.add('hidden');
    if (gameContainer) gameContainer.classList.remove('hidden');
    if (roundActions) roundActions.classList.remove('hidden');
    if (mobileNav) mobileNav.classList.remove('hidden');
    if (liveIndicator) liveIndicator.classList.remove('hidden');
    renderHeader();
  }
  initIcons();
}

async function startRoundAsGuest() {
  try {
    const res = await fetch('/api/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: 'course-krungthep-kreetha',
        starting_hole: 1
      })
    });
    if (res.ok) {
      const data = await res.json();
      const newRoundId = data.round_id || data.id;
      const newUrl = `${window.location.origin}/round/${newRoundId}`;
      window.history.pushState({ roundId: newRoundId }, '', newUrl);
      state.roundId = newRoundId;
      state.localScores = {};
      state.unlockedHoles = {};
      updateTournamentState(data);
      showScreen('game');
      setupSSE();
      showToast("Guest round started! Share the link with your group.");
    } else {
      showToast("Failed to start guest round.", "error");
    }
  } catch (err) {
    console.error("Error starting guest round:", err);
    showToast("Network error starting round.", "error");
  }
}

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initIcons();
  setupDragScroll('scorecard-scroll-container');
  setupDragScroll('hole-carousel');
  await fetchCurrentUser();
  await fetchInitialState();
  fetchCourses();
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

  const sseUrl = getRoundApiUrl('/events');
  state.eventSource = new EventSource(sseUrl);

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

  state.eventSource.addEventListener('init', handleUpdate);
  state.eventSource.addEventListener('initial', handleUpdate);
  state.eventSource.addEventListener('score_update', handleUpdate);
  state.eventSource.addEventListener('players_update', handleUpdate);
  state.eventSource.addEventListener('settings_update', handleUpdate);
  state.eventSource.addEventListener('course_update', handleUpdate);
  state.eventSource.addEventListener('round_finished', handleUpdate);
  state.eventSource.addEventListener('round_unlocked', handleUpdate);
  state.eventSource.addEventListener('reset', handleUpdate);
  state.eventSource.addEventListener('reset_default', handleUpdate);
}

async function fetchInitialState() {
  try {
    const urlRoundId = getUrlRoundId();

    if (urlRoundId) {
      const res = await fetch(`/api/round/${urlRoundId}`);
      if (res.ok) {
        const data = await res.json();
        state.roundId = data.round_id || data.id || urlRoundId;
        state.currentHole = data.current_display_hole || data.starting_hole || 1;
        updateTournamentState(data);
        showScreen('game');
        setupSSE();
        return;
      } else if (res.status === 404) {
        showToast("The requested round was not found or has been deleted.", "error");
        window.history.replaceState(null, '', '/');
      }
    }

    // Base URL '/' (No round in URL)
    if (!state.currentUser) {
      // Unauthenticated: Show Welcome Screen (Never auto-create round!)
      showScreen('welcome');
      return;
    }

    // Authenticated user on base URL: check if they have an ongoing round
    const res = await fetch('/api/tournament');
    if (res.ok) {
      const data = await res.json();
      if (data && (data.round_id || data.id) && data.round !== null) {
        state.roundId = data.round_id || data.id;
        window.history.replaceState(null, '', `/?round=${state.roundId}`);
        state.currentHole = data.current_display_hole || data.starting_hole || 1;
        updateTournamentState(data);
        showScreen('game');
        setupSSE();
      } else {
        // No ongoing round: show Lobby Screen
        showScreen('lobby');
      }
    } else {
      showScreen('lobby');
    }
  } catch (err) {
    console.error("Failed to fetch initial state:", err);
    if (!state.currentUser) {
      showScreen('welcome');
    } else {
      showScreen('lobby');
    }
  }
}

async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      state.currentUser = data.authenticated ? data.user : null;
      state.currentPlayer = data.player || null;
      renderAuth();
      if (data.authenticated && data.needs_player_link) {
        openLinkPlayerModal();
      }
    }
  } catch (err) {
    console.error("Failed to fetch user:", err);
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

  updateManualRoundTabState();
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
    let titleStr = t.round_name;
    if (!titleStr) {
      const datePart = t.date_str || new Date().toLocaleDateString();
      const coursePart = t.course_name || 'Golf Course';
      const creatorPart = t.creator_name || 'Organizer';
      titleStr = `${datePart} • ${coursePart} - By ${creatorPart}`;
    }
    nameEl.innerHTML = `
      <span class="truncate">${titleStr}</span>
      <span id="header-mode-badge" class="px-1.5 py-0.5 rounded text-[10px] font-black ${modeBadgeClass}">
        ${modeBadgeText}
      </span>
    `;
  }

  const courseEl = document.getElementById('header-course-name');
  if (courseEl) {
    const teeName = typeof t.selected_tee === 'object' ? (t.selected_tee?.name || 'White') : (t.selected_tee || 'White');
    courseEl.textContent = `${t.course_name || 'Golf Course'} • ${teeName} Tee`;
  }

  // Round State Action Status (LOCKED / Unlock Round when finished; Finish Round moved to last hole)
  const actionWrap = document.getElementById('round-state-action-wrap');
  if (actionWrap) {
    if (t.is_finished) {
      actionWrap.innerHTML = `
        <span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-800 text-amber-400 border border-amber-500/30 flex items-center gap-1">
          <i data-lucide="lock" class="w-3 h-3"></i>
          <span>LOCKED</span>
        </span>
        ${t.is_owner ? `
          <button type="button" onclick="unlockCurrentRound()" class="py-1 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-[11px] transition shadow flex items-center gap-1">
            <i data-lucide="unlock" class="w-3 h-3"></i>
            <span>Unlock Round</span>
          </button>
        ` : ''}
      `;
    } else {
      actionWrap.innerHTML = '';
    }
  }

  // Round Finished Global Banner
  const finBanner = document.getElementById('round-finished-banner');
  const unlockContainer = document.getElementById('banner-unlock-btn-container');
  if (finBanner) {
    if (t.is_finished) {
      finBanner.classList.remove('hidden');
      if (unlockContainer) {
        unlockContainer.innerHTML = t.is_owner ? `
          <button type="button" onclick="unlockCurrentRound()" class="ml-2 px-2.5 py-0.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition">
            Unlock & Edit
          </button>
        ` : '';
      }
    } else {
      finBanner.classList.add('hidden');
    }
  }

  renderAuth();

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

  const playedSeq = getPlayedHoleOrder();
  const orderedHoles = playedSeq.map(hNum => holes.find(h => h.hole === hNum) || { hole: hNum, par: 4, is_turbo: false });

  container.innerHTML = orderedHoles.map(h => {
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
      const scrollTarget = activeEl.offsetLeft - (container.clientWidth / 2) + (activeEl.clientWidth / 2);
      container.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
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
  const isRoundFinished = Boolean(state.tournament?.is_finished);
  const disabledAttr = (isLocked || isRoundFinished) ? 'disabled' : '';
  const lockedOpacity = (isLocked || isRoundFinished) ? 'opacity-70' : '';
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
    ? `<span class="px-1 py-0.5 rounded text-[10px] font-black bg-purple-900/80 text-purple-200 border border-purple-500/40 shrink-0 inline-flex items-center justify-center leading-none" title="Wolf Player">🐺</span>` 
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

        <!-- Vertical Stepper Controls: + on top, - on bottom -->
        <div class="vertical-score-dial flex flex-col items-center gap-1">
          <button type="button" ${disabledAttr} onclick="stepScore('${p.id}', 1)" class="dial-btn w-8 h-8 rounded-lg bg-slate-950 border border-slate-700 text-white font-black text-base flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none" title="Increase score">
            +
          </button>
          
          <div class="w-10 h-8 rounded-lg bg-slate-950 border-2 border-amber-500/80 flex items-center justify-center text-sm font-black text-white font-mono shadow-inner">
            ${p.score}
          </div>

          <button type="button" ${disabledAttr} onclick="stepScore('${p.id}', -1)" class="dial-btn w-8 h-8 rounded-lg bg-slate-950 border border-slate-700 text-white font-black text-base flex items-center justify-center hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none" title="Decrease score">
            −
          </button>
        </div>
      </div>

    </div>
  `;
}

function renderScoringActionBar(hNum, currCalc) {
  const container = document.getElementById('scoring-action-container');
  if (!container) return;

  const isRoundFinished = Boolean(state.tournament?.is_finished);
  const nextHole = getNextHoleNumber(hNum);
  const playedSeq = getPlayedHoleOrder();
  const lastHole = (playedSeq && playedSeq.length > 0) ? playedSeq[playedSeq.length - 1] : 18;
  const isLastHole = (hNum === lastHole);

  if (isRoundFinished) {
    container.innerHTML = `
      <div class="flex items-center gap-2 sm:gap-3">
        <div class="flex-1 py-3 px-4 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-400 font-bold text-xs flex items-center justify-center gap-2 shadow-inner">
          <i data-lucide="lock" class="w-4 h-4 text-amber-400"></i>
          <span>This round is finished and locked (Read-Only)</span>
        </div>
        ${nextHole ? `
          <button type="button" onclick="selectHole(${nextHole})" class="py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-extrabold text-xs border border-slate-700 transition flex items-center justify-center gap-1.5 shadow-md">
            <span>Hole ${nextHole}</span>
            <i data-lucide="arrow-right" class="w-4 h-4"></i>
          </button>
        ` : ''}
      </div>
    `;
    initIcons();
    return;
  }

  const existingScores = currCalc?.scores || {};
  const isHolePlayed = existingScores && Object.keys(existingScores).length > 0;
  const isUnlocked = Boolean(state.unlockedHoles[`${hNum}`]);
  const isLocked = isHolePlayed && !isUnlocked;

  let topRowHtml = '';
  if (isLocked) {
    topRowHtml = `
      <div class="flex items-center gap-2 sm:gap-3">
        <button type="button" onclick="openEditWarningModal(${hNum})" class="flex-1 py-3 px-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-extrabold text-xs border border-amber-500/40 transition flex items-center justify-center gap-1.5 shadow-sm">
          <i data-lucide="unlock" class="w-4 h-4 text-amber-400"></i>
          <span>Unlock & Edit Hole ${hNum}</span>
        </button>
        ${nextHole ? `
          <button type="button" onclick="selectHole(${nextHole})" class="flex-1 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20">
            <span>Next Hole (${nextHole})</span>
            <i data-lucide="arrow-right" class="w-4 h-4"></i>
          </button>
        ` : ''}
      </div>
    `;
  } else {
    topRowHtml = `
      <div class="flex items-center gap-2 sm:gap-3">
        <button type="button" onclick="confirmResetHole(${hNum})" class="py-3.5 px-3.5 sm:px-4 rounded-2xl bg-slate-900 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 font-black text-xs sm:text-sm border border-slate-800 hover:border-rose-700/50 transition flex items-center justify-center gap-1.5 shadow-md shrink-0" title="Reset Hole ${hNum}">
          <i data-lucide="rotate-ccw" class="w-4 h-4 text-rose-400"></i>
          <span>RESET HOLE</span>
        </button>

        <button type="button" onclick="saveHoleScores(${hNum})" class="flex-1 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xs sm:text-sm shadow-xl shadow-emerald-500/25 transition flex items-center justify-center gap-1.5">
          <i data-lucide="check-circle-2" class="w-4 h-4"></i>
          <span>Save</span>
        </button>

        ${nextHole ? `
          <button type="button" onclick="selectHole(${nextHole})" class="py-3.5 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-extrabold text-xs sm:text-sm border border-slate-700 transition flex items-center justify-center gap-1.5 shadow-md">
            <span>Next Hole (${nextHole})</span>
            <i data-lucide="arrow-right" class="w-4 h-4"></i>
          </button>
        ` : ''}
      </div>
    `;
  }

  // Under the last hole (Hole 18 if starting Hole 1, Hole 9 if starting Hole 10), render Finish Round button below SAVE
  let finishRoundHtml = '';
  if (isLastHole) {
    finishRoundHtml = `
      <div class="pt-1">
        <button type="button" onclick="finishCurrentRound()" class="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm shadow-xl shadow-amber-500/25 transition flex items-center justify-center gap-2">
          <i data-lucide="flag" class="w-4 h-4"></i>
          <span>FINISH ROUND</span>
        </button>
      </div>
    `;
  }

  container.innerHTML = topRowHtml + finishRoundHtml;
  initIcons();
}

function confirmResetHole(hNum) {
  if (confirm(`Reset all entered scores for Hole ${hNum}?`)) {
    clearHoleScores(hNum);
  }
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
  const hSpec = state.tournament?.holes?.find(h => h.hole === state.currentHole);
  const defaultPar = hSpec?.par || 4;
  const current = state.localScores[playerId] !== undefined 
    ? state.localScores[playerId] 
    : (state.tournament?.calculated_holes?.find(h => h.hole === state.currentHole)?.scores?.[playerId] ?? defaultPar);

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
    const res = await fetch(getRoundApiUrl('/score'), {
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
    } else if (res.status === 403) {
      showToast("Round is locked. No edits allowed.");
    }
  } catch (err) {
    console.error("Error saving score:", err);
  }
}

async function clearHoleScores(hNum) {
  try {
    const res = await fetch(getRoundApiUrl('/score'), {
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
    } else if (res.status === 403) {
      showToast("Round is locked. No edits allowed.");
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
  const calcHoles = state.tournament.calculated_holes || [];
  const isWolf = (state.tournament.game_settings?.game_mode === 'WOLF');

  // Scorecard always goes 1 to 18 (OUT: 1-9, IN: 10-18) regardless of starting hole
  const sortedHoles = [...holes].sort((a, b) => (a.hole || 0) - (b.hole || 0));
  const group1Holes = sortedHoles.filter(h => (h.hole || 0) <= 9);
  const group1Title = 'OUT';
  const group1Par = group1Holes.reduce((a, b) => a + (b.par || 4), 0);

  const group2Holes = sortedHoles.filter(h => (h.hole || 0) > 9);
  const group2Title = 'IN';
  const group2Par = group2Holes.reduce((a, b) => a + (b.par || 4), 0);

  const totPar = group1Par + group2Par;

  let html = `
    <thead>
      <!-- Header Row -->
      <tr class="bg-slate-950 text-slate-400 font-black text-[10px] uppercase">
        <th class="py-2.5 px-3 text-left min-w-[130px] sticky left-0 z-20 bg-slate-950">Player</th>
        ${group1Holes.map(h => {
          const wolfP = isWolf ? calcHoles.find(c => c.hole === h.hole)?.wolf_player : null;
          const wolfBadge = wolfP ? `<span class="block text-[8px] text-purple-400 -mt-0.5" title="Wolf: ${wolfP.name}">🐺</span>` : '';
          return `<th class="w-8">${h.is_turbo ? '🔥' : ''}H${h.hole}${wolfBadge}</th>`;
        }).join('')}
        <th class="w-10 bg-slate-900 text-amber-400 font-black">${group1Title}</th>
        ${group2Holes.map(h => {
          const wolfP = isWolf ? calcHoles.find(c => c.hole === h.hole)?.wolf_player : null;
          const wolfBadge = wolfP ? `<span class="block text-[8px] text-purple-400 -mt-0.5" title="Wolf: ${wolfP.name}">🐺</span>` : '';
          return `<th class="w-8">${h.is_turbo ? '🔥' : ''}H${h.hole}${wolfBadge}</th>`;
        }).join('')}
        <th class="w-10 bg-slate-900 text-amber-400 font-black">${group2Title}</th>
        <th class="w-11 bg-slate-900 text-white font-black">TOT</th>
        <th class="w-10 bg-slate-900 text-amber-300 font-black">+/-</th>
      </tr>
      
      <!-- Par Row -->
      <tr class="bg-slate-900 text-slate-300 font-extrabold text-[10px] border-t border-slate-800">
        <td class="text-left px-3 font-bold sticky left-0 z-20 bg-slate-900 text-slate-300">PAR</td>
        ${group1Holes.map(h => `<td>${h.par || 4}</td>`).join('')}
        <td class="font-black text-amber-400 bg-slate-950">${group1Par}</td>
        ${group2Holes.map(h => `<td>${h.par || 4}</td>`).join('')}
        <td class="font-black text-amber-400 bg-slate-950">${group2Par}</td>
        <td class="font-black text-white bg-slate-950">${totPar}</td>
        <td class="font-black text-amber-400 bg-slate-950">E</td>
      </tr>

      <!-- Handicap Row -->
      <tr class="bg-slate-900/70 text-slate-400 font-bold text-[10px] border-b border-slate-800">
        <td class="text-left px-3 font-bold sticky left-0 z-20 bg-slate-900 text-slate-400">HCP</td>
        ${group1Holes.map(h => `<td class="text-slate-400 font-mono">${h.handicap ?? '-'}</td>`).join('')}
        <td class="font-bold text-slate-600 bg-slate-950">-</td>
        ${group2Holes.map(h => `<td class="text-slate-400 font-mono">${h.handicap ?? '-'}</td>`).join('')}
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

    // Group 1 (First 9 played)
    group1Holes.forEach(h => {
      const hNum = h.hole;
      const score = p.scores ? p.scores[str(hNum)] : null;
      const par = h.par || 4;
      const hasHcp = Boolean(p.handicap_holes && p.handicap_holes.includes(hNum));
      const wolfId = isWolf ? calcHoles.find(c => c.hole === hNum)?.wolf_player?.id : null;
      const isWolfPlayer = Boolean(isWolf && wolfId === p.id);
      html += `<td>${renderGolfBadge(score, par, hasHcp, isWolfPlayer)}</td>`;
    });

    const g1Gross = p.out_gross || '-';
    html += `<td class="font-black bg-slate-900/80 text-slate-200">${g1Gross}</td>`;

    // Group 2 (Second 9 played)
    group2Holes.forEach(h => {
      const hNum = h.hole;
      const score = p.scores ? p.scores[str(hNum)] : null;
      const par = h.par || 4;
      const hasHcp = Boolean(p.handicap_holes && p.handicap_holes.includes(hNum));
      const wolfId = isWolf ? calcHoles.find(c => c.hole === hNum)?.wolf_player?.id : null;
      const isWolfPlayer = Boolean(isWolf && wolfId === p.id);
      html += `<td>${renderGolfBadge(score, par, hasHcp, isWolfPlayer)}</td>`;
    });

    const g2Gross = p.in_gross || '-';
    html += `<td class="font-black bg-slate-900/80 text-slate-200">${g2Gross}</td>`;

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

function renderGolfBadge(score, par, hasHcp, isWolf) {
  const hcpIcon = hasHcp ? `<span class="text-[8px] text-sky-400 font-black" title="Handicap Stroke (TOR)">🪽</span>` : '';
  const wolfIcon = isWolf ? `<span class="text-[9px]" title="Wolf Player">🐺</span>` : '';
  const indicators = (hcpIcon || wolfIcon) ? `<div class="flex items-center justify-center gap-0.5 leading-none mt-0.5">${wolfIcon}${hcpIcon}</div>` : '';

  if (score === null || score === undefined) {
    return `<div class="flex flex-col items-center justify-center py-0.5"><span class="text-slate-600 font-mono">-</span>${indicators}</div>`;
  }
  const diff = score - par;
  let badgeClass = "golf-par";
  if (diff <= -2) badgeClass = "golf-eagle";
  else if (diff === -1) badgeClass = "golf-birdie";
  else if (diff === 0) badgeClass = "golf-par";
  else if (diff === 1) badgeClass = "golf-bogey";
  else badgeClass = "golf-double-bogey";

  return `<div class="flex flex-col items-center justify-center py-0.5"><span class="golf-badge ${badgeClass}">${score}</span>${indicators}</div>`;
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

  const playedSeq = getPlayedHoleOrder();
  const labels = ['Tee', ...playedSeq.map(h => `H${h}`)];

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
    const showCash = (p.total_played > 0 || p.total_cash !== 0 || Boolean(t.is_manual));

    return `
      <div class="grid grid-cols-12 items-center py-3 px-3 text-xs hover:bg-slate-800/40 transition">
        
        <!-- POS -->
        <div class="col-span-1 text-center font-mono font-black ${idx === 0 && (p.total_played > 0 || t.is_manual) ? 'text-amber-400 text-sm' : 'text-slate-300'}">
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
          ${showCash ? cashStr : '-'}
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

  // Starting Hole (1 or 10)
  const startingHole = settings.starting_hole || t.starting_hole || 1;
  setStartingHoleUI(startingHole);

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

  // Course Tees Selection
  renderCourseTees();
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
  if (state.tournament?.game_settings) {
    state.tournament.game_settings.game_mode = mode;
  }
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

  const isWolf = document.getElementById('btn-mode-wolf')?.classList.contains('bg-purple-600');
  const isFFA = document.getElementById('btn-mode-ffa')?.classList.contains('bg-emerald-500');
  const currentMode = isWolf ? 'WOLF' : (isFFA ? 'FREE_FOR_ALL' : 'TEAMS');

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        game_settings: {
          game_mode: currentMode,
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
      <div id="cfg-player-card-${idx}" class="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3 shadow-md relative">
        
        <div class="flex items-center justify-between gap-2 pb-1 border-b border-slate-800">
          <span class="text-xs font-black text-amber-400 uppercase">Player ${idx + 1}</span>
          <div class="flex items-center gap-2">
            <label class="text-[10px] text-slate-400 font-bold uppercase">Color:</label>
            <input id="p-col-${idx}" type="color" value="${p.color || DEFAULT_COLORS[idx]}" class="w-7 h-7 rounded-lg bg-transparent cursor-pointer border-0">
          </div>
        </div>

        <div class="relative">
          <label class="block text-[11px] font-bold text-slate-300 mb-1">Player Name</label>
          <input id="p-name-${idx}" type="text" value="${p.name || DEFAULT_NAMES[idx]}"
                 data-player-id="${p.player_id || ''}"
                 oninput="onPlayerNameInput(${idx}, this.value)"
                 onfocus="onPlayerNameFocus(${idx}, this)"
                 onclick="onPlayerNameFocus(${idx}, this)"
                 autocomplete="off"
                 placeholder="Type custom name or select player..."
                 class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-bold text-xs focus:ring-1 focus:ring-amber-500">
          <div id="p-autocomplete-${idx}" class="hidden absolute left-0 right-0 top-full mt-1 z-40 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-56 overflow-y-auto divide-y divide-slate-800"></div>
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

let playerSearchDebounce = null;
async function onPlayerNameFocus(idx, el) {
  const val = (el.value || '').trim();
  if (DEFAULT_NAMES.includes(val) || /^PLAYER\s*\d+$/i.test(val)) {
    el.value = '';
    el.dataset.playerId = '';
  }
  showPlayerAutocompleteList(idx, el.value.trim());
}

async function onPlayerNameInput(idx, query) {
  const nameInp = document.getElementById(`p-name-${idx}`);
  if (nameInp) {
    nameInp.dataset.playerId = '';
  }
  showPlayerAutocompleteList(idx, (query || '').trim());
}

async function showPlayerAutocompleteList(idx, q) {
  const dropdown = document.getElementById(`p-autocomplete-${idx}`);
  if (!dropdown) return;

  if (!q) {
    try {
      let res = await fetch('/api/my-players');
      let players = [];
      let headerTitle = "My Added Players";
      if (res.ok) {
        players = await res.json();
      }
      if (!players || players.length === 0) {
        const dirRes = await fetch('/api/players');
        if (dirRes.ok) {
          players = await dirRes.json();
          headerTitle = "All Players Directory";
        }
      }
      renderPlayerAutocomplete(idx, players || [], headerTitle);
    } catch (err) {
      console.error("Error loading players for dropdown:", err);
    }
    return;
  }

  if (playerSearchDebounce) clearTimeout(playerSearchDebounce);
  playerSearchDebounce = setTimeout(async () => {
    try {
      const res = await fetch(`/api/players?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const matches = await res.json();
        renderPlayerAutocomplete(idx, matches, `Search Results for "${q}"`);
      }
    } catch (err) {
      console.error("Autocomplete search error:", err);
    }
  }, 150);
}

function renderPlayerAutocomplete(idx, matches, headerTitle = "Select Player") {
  const dropdown = document.getElementById(`p-autocomplete-${idx}`);
  if (!dropdown) return;
  if (!matches || matches.length === 0) {
    dropdown.innerHTML = `<div class="p-2.5 text-slate-400 text-[11px] text-center font-bold">No players found</div>`;
    dropdown.classList.remove('hidden');
    return;
  }

  const headerHtml = `
    <div class="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-950/80 border-b border-slate-800">
      ${headerTitle}
    </div>
  `;

  const itemsHtml = matches.slice(0, 8).map(p => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
    const hcp = p.current_handicap != null ? Number(p.current_handicap).toFixed(1) : '18.0';
    return `
      <div onclick='selectAutocompletePlayer(${idx}, ${JSON.stringify(p).replace(/'/g, "&#39;")})'
           class="p-2.5 hover:bg-slate-800 cursor-pointer flex items-center justify-between text-left transition">
        <div class="min-w-0 pr-2">
          <div class="font-black text-amber-400 text-xs truncate">${p.nickname}</div>
          <div class="text-[10px] text-slate-400 truncate">${fullName} ${p.email ? '• ' + p.email : ''}</div>
        </div>
        <div class="shrink-0 text-right">
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700 font-mono font-bold">HCP ${hcp}</span>
        </div>
      </div>
    `;
  }).join('');

  dropdown.innerHTML = headerHtml + itemsHtml;
  dropdown.classList.remove('hidden');
}

function selectAutocompletePlayer(idx, player) {
  const nameInp = document.getElementById(`p-name-${idx}`);
  const outInp = document.getElementById(`p-out-${idx}`);
  const inInp = document.getElementById(`p-in-${idx}`);
  const dropdown = document.getElementById(`p-autocomplete-${idx}`);

  if (nameInp) {
    nameInp.value = player.nickname || player.first_name || '';
    nameInp.dataset.playerId = player.id;
  }
  const hcp = player.current_handicap != null ? Math.round(player.current_handicap) : 0;
  const hcpOut = Math.min(9, Math.floor(hcp / 2));
  const hcpIn = Math.min(9, Math.ceil(hcp / 2));
  if (outInp) outInp.value = hcpOut;
  if (inInp) inInp.value = hcpIn;

  if (dropdown) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
  }
}

// Top Left Dropdown Menu Handlers
function toggleTopMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('top-dropdown-menu');
  const btn = document.getElementById('btn-top-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    menu.classList.remove('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    initIcons();
  } else {
    menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

function closeTopMenu() {
  const menu = document.getElementById('top-dropdown-menu');
  const btn = document.getElementById('btn-top-menu');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#top-menu-wrapper')) {
    closeTopMenu();
  }
  if (!e.target.closest('[id^="p-autocomplete-"]') && !e.target.closest('[id^="p-name-"]')) {
    document.querySelectorAll('[id^="p-autocomplete-"]').forEach(el => el.classList.add('hidden'));
  }
});

async function savePlayersLineup() {
  const countInp = document.getElementById('cfg-player-count');
  const count = Math.max(3, Math.min(6, parseInt(countInp?.value) || 4));
  const currentPlayers = state.tournament?.players || [];

  const playersPayload = [];
  for (let i = 0; i < count; i++) {
    const nameEl = document.getElementById(`p-name-${i}`);
    const name = nameEl?.value.trim() || DEFAULT_NAMES[i];
    const playerId = (nameEl?.dataset?.playerId && nameEl.dataset.playerId.trim()) ? nameEl.dataset.playerId.trim() : null;
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
      default_team: defaultTeam,
      player_id: playerId
    });
  }

  try {
    const res = await fetch(getRoundApiUrl('/players'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: playersPayload })
    });

    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
      showSuccessModal("Lineup Saved", "Players lineup and handicaps have been saved successfully!");
    } else if (res.status === 403) {
      showToast("Cannot edit: Round is finished and locked.", "lock");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to save players.", "error");
    }
  } catch (err) {
    console.error("Error saving players:", err);
    showToast("Network error saving players.", "error");
  }
}

async function saveGameSettings() {
  const courseId = document.getElementById('course-selector')?.value || state.tournament?.course_id || 'course-krungthep-kreetha';
  const selectedTee = document.getElementById('active-tee-selector')?.value || state.tournament?.selected_tee || 'White';
  const isWolf = document.getElementById('btn-mode-wolf')?.classList.contains('bg-purple-600');
  const isFFA = document.getElementById('btn-mode-ffa')?.classList.contains('bg-emerald-500');
  let gameMode = 'TEAMS';
  if (isWolf) gameMode = 'WOLF';
  else if (isFFA) gameMode = 'FREE_FOR_ALL';

  const isStart10 = document.getElementById('btn-start-hole-10')?.classList.contains('bg-amber-500');
  const startingHole = isStart10 ? 10 : 1;

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
    course_id: courseId,
    selected_tee: selectedTee,
    starting_hole: startingHole,
    game_settings: {
      game_mode: gameMode,
      starting_hole: startingHole,
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
    const res = await fetch(getRoundApiUrl('/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.starting_hole && (!state.tournament || !state.tournament.total_holes_played || state.tournament.total_holes_played === 0)) {
        state.currentHole = data.current_display_hole || data.starting_hole;
      }
      updateTournamentState(data);
      showSuccessModal("Game Settings Saved", "Game mode and match rules have been saved successfully!");
    } else if (res.status === 403) {
      showToast("Cannot edit: Round is finished and locked.", "lock");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to save settings.", "error");
    }
  } catch (err) {
    console.error("Error saving settings:", err);
    showToast("Network error saving settings.", "error");
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

  const nameInp = document.getElementById('cfg-course-name');
  if (nameInp) {
    const cur = state.courses.find(c => c.id === currentCourseId);
    nameInp.value = cur?.name || state.tournament?.course_name || 'Krungthep Kreetha Golf Course';
  }
}

function onCourseSelected(courseId) {
  const selectedCourse = state.courses.find(c => c.id === courseId);
  if (!selectedCourse) return;

  const nameInp = document.getElementById('cfg-course-name');
  if (nameInp) nameInp.value = selectedCourse.name;

  const holes = selectedCourse.holes.map(h => ({
    hole: h.hole,
    par: h.par,
    handicap: h.handicap,
    is_turbo: (h.hole === 9 || h.hole === 18)
  }));

  state.tournament.course_id = selectedCourse.id;
  state.tournament.course_name = selectedCourse.name;
  state.tournament.holes = holes;
  state.tournament.tees = selectedCourse.tees || DEFAULT_TEES;

  markCourseModified();
  renderCourseHolesTable();
  renderCourseTees();
}

function startNewCourse() {
  const select = document.getElementById('course-selector');
  if (select) {
    let draftOpt = select.querySelector('option[value="__new__"]');
    if (!draftOpt) {
      draftOpt = document.createElement('option');
      draftOpt.value = '__new__';
      draftOpt.textContent = '+ Draft New Course...';
      select.prepend(draftOpt);
    }
    select.value = '__new__';
  }

  // Clear Course Name field
  const nameInp = document.getElementById('cfg-course-name');
  if (nameInp) {
    nameInp.value = '';
    nameInp.focus();
  }

  // Set all 18 holes to PAR 4 and clear HCP INDEX
  const newHoles = [];
  for (let i = 1; i <= 18; i++) {
    newHoles.push({
      hole: i,
      par: 4,
      handicap: '',
      is_turbo: false
    });
  }

  if (state.tournament) {
    state.tournament.course_id = '__new__';
    state.tournament.course_name = '';
    state.tournament.holes = newHoles;
  }

  renderCourseHolesTable();

  // Clear all tee rating and slope fields
  const tees = getActiveTees();
  tees.forEach(t => {
    const rInp = document.getElementById(`tee-rating-${t.id}`);
    const sInp = document.getElementById(`tee-slope-${t.id}`);
    if (rInp) rInp.value = '';
    if (sInp) sInp.value = '';
  });

  markCourseModified();
  showToast("Course cleared: Par 4 set on all holes, HCP and Tee ratings cleared.");
}

function markCourseModified() {
  state.isCourseModified = true;
  const btn = document.getElementById('btn-save-course');
  if (btn) {
    btn.className = "py-2 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-500/25 flex items-center gap-1.5 ring-2 ring-emerald-400";
  }
}

function renderCourseHolesTable() {
  const tbody = document.getElementById('course-holes-tbody');
  if (!tbody || !state.tournament) return;

  const holes = state.tournament.holes || [];
  const turboEnabled = document.getElementById('cfg-turbo-enabled')?.checked || false;

  tbody.innerHTML = holes.map(h => {
    const par = h.par || 4;
    const hcpVal = (h.handicap !== null && h.handicap !== undefined && h.handicap !== '') ? h.handicap : '';
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
          <input type="number" id="hcp-idx-${h.hole}" min="1" max="18" value="${hcpVal}" placeholder="-" onchange="markCourseModified()" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono text-xs w-16 text-center">
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

const DEFAULT_TEES = [
  { id: 'red', name: 'Red', color: '#ef4444', course_rating: 70.2, slope_rating: 120 },
  { id: 'yellow', name: 'Yellow', color: '#eab308', course_rating: 71.4, slope_rating: 124 },
  { id: 'white', name: 'White', color: '#f8fafc', course_rating: 72.0, slope_rating: 128 },
  { id: 'blue', name: 'Blue', color: '#3b82f6', course_rating: 73.5, slope_rating: 133 },
  { id: 'black', name: 'Black', color: '#0f172a', course_rating: 75.1, slope_rating: 138 }
];

function getActiveTees() {
  const currentCourseId = state.tournament?.course_id;
  const curCourse = (state.courses || []).find(c => c.id === currentCourseId);
  return state.tournament?.tees || curCourse?.tees || DEFAULT_TEES;
}

function populateActiveTeeSelector() {
  const select = document.getElementById('active-tee-selector');
  if (!select) return;
  const tees = getActiveTees();
  const selectedTee = state.tournament?.selected_tee;
  const selectedTeeId = typeof selectedTee === 'object' ? selectedTee?.id : (selectedTee || 'white');

  select.innerHTML = tees.map(t => {
    return `<option value="${t.id}" ${t.id === selectedTeeId ? 'selected' : ''}>${t.name} (CR: ${t.course_rating}, Slope: ${t.slope_rating})</option>`;
  }).join('');
}

function onActiveTeeChanged(teeId) {
  const tees = getActiveTees();
  const teeObj = tees.find(t => t.id === teeId) || tees[0];
  if (!state.tournament) return;
  state.tournament.selected_tee = teeObj;
  renderCourseTees();
  markCourseModified();
}

function renderCourseTees() {
  const container = document.getElementById('course-tees-table-container') || document.getElementById('course-tees-container');
  if (!container) return;

  const tees = getActiveTees();
  const selectedTee = state.tournament?.selected_tee;
  const selectedTeeId = typeof selectedTee === 'object' ? selectedTee?.id : (selectedTee || 'white');

  container.innerHTML = `
    <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70 p-1">
      <table class="w-full text-xs text-center border-collapse">
        <thead>
          <tr class="bg-slate-900 text-slate-400 text-[10px] font-black uppercase tracking-wider border-b border-slate-800">
            <th class="py-1.5 px-2 text-left">Tee Name</th>
            <th class="py-1.5 px-2">Course Rating</th>
            <th class="py-1.5 px-2">Slope Rating</th>
            <th class="py-1.5 px-2">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/60 font-medium">
          ${tees.map(tee => {
            const isSelected = (tee.id === selectedTeeId);
            return `
              <tr class="hover:bg-slate-900/40 transition">
                <td class="py-2 px-2 text-left">
                  <div class="flex items-center gap-1.5">
                    <span class="w-3.5 h-3.5 rounded-full border border-white/40 shadow-sm shrink-0" style="background-color: ${tee.color};"></span>
                    <span class="font-black text-xs ${isSelected ? 'text-amber-400' : 'text-slate-200'}">${tee.name}</span>
                  </div>
                </td>
                <td class="py-2 px-2">
                  <input type="number" step="0.1" id="tee-rating-${tee.id}" value="${tee.course_rating}" onchange="markCourseModified()"
                         class="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white font-mono text-xs w-20">
                </td>
                <td class="py-2 px-2">
                  <input type="number" id="tee-slope-${tee.id}" value="${tee.slope_rating}" onchange="markCourseModified()"
                         class="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center text-white font-mono text-xs w-16">
                </td>
                <td class="py-2 px-2">
                  <button type="button" onclick="deleteTeeRow('${tee.id}')" class="p-1 rounded hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition" title="Delete Tee">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  populateActiveTeeSelector();
  initIcons();
}

function addNewTeeRow() {
  const name = prompt("Enter name for the new tee (e.g. Gold, Senior, Championship):");
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  const teeId = 'tee-' + cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString(36);
  
  if (!state.tournament) return;
  if (!state.tournament.tees) {
    state.tournament.tees = [...getActiveTees()];
  }
  state.tournament.tees.push({
    id: teeId,
    name: cleanName,
    color: '#10b981',
    course_rating: 72.0,
    slope_rating: 125
  });
  renderCourseTees();
  markCourseModified();
  showToast(`Added "${cleanName}" tee.`);
}

function deleteTeeRow(teeId) {
  if (!state.tournament) return;
  let tees = getActiveTees();
  if (tees.length <= 1) {
    showToast("A course must have at least one tee.", "error");
    return;
  }
  if (!confirm("Are you sure you want to delete this tee?")) return;
  state.tournament.tees = tees.filter(t => t.id !== teeId);
  const selectedTee = state.tournament.selected_tee;
  const currentSelectedId = typeof selectedTee === 'object' ? selectedTee?.id : (selectedTee || 'white');
  if (currentSelectedId === teeId) {
    state.tournament.selected_tee = state.tournament.tees[0];
  }
  renderCourseTees();
  markCourseModified();
  showToast("Tee deleted.");
}

function promptSaveCourseSpecs() {
  const modal = document.getElementById('confirm-course-modal');
  if (modal) {
    modal.classList.remove('hidden');
  } else {
    executeSaveCourseSpecs();
  }
}

function closeConfirmCourseModal() {
  const modal = document.getElementById('confirm-course-modal');
  if (modal) modal.classList.add('hidden');
}

async function executeSaveCourseSpecs() {
  closeConfirmCourseModal();
  await saveCourseSpecs();
}

async function saveNewCourse() {
  const nameInp = document.getElementById('cfg-course-name');
  const courseName = nameInp?.value.trim();
  if (!courseName) {
    alert("Please enter a course name in the Course Name box.");
    if (nameInp) nameInp.focus();
    return;
  }

  const holesPayload = [];
  for (let i = 1; i <= 18; i++) {
    const pill = document.getElementById(`course-par-pill-${i}`);
    const par = parseInt(pill?.dataset?.par) || 4;
    const hcp = parseInt(document.getElementById(`hcp-idx-${i}`)?.value) || i;
    const isTurbo = document.getElementById(`turbo-chk-${i}`)?.checked || false;

    holesPayload.push({
      hole: i,
      par: par,
      handicap: hcp,
      is_turbo: isTurbo
    });
  }

  const currentTees = getActiveTees();
  const teesPayload = currentTees.map(t => {
    const ratingInp = document.getElementById(`tee-rating-${t.id}`);
    const slopeInp = document.getElementById(`tee-slope-${t.id}`);
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      course_rating: ratingInp ? (parseFloat(ratingInp.value) || t.course_rating || 72.0) : t.course_rating,
      slope_rating: slopeInp ? (parseInt(slopeInp.value) || t.slope_rating || 113) : t.slope_rating
    };
  });
  const selTeeVal = document.getElementById('active-tee-selector')?.value || 'white';
  const selectedTeeObj = teesPayload.find(t => t.id === selTeeVal) || teesPayload[0] || DEFAULT_TEES[2];

  try {
    const res = await fetch('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_name: courseName,
        holes: holesPayload,
        tees: teesPayload,
        selected_tee: selectedTeeObj,
        is_new: true,
        round_id: state.roundId
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.courses) {
        state.courses = data.courses;
      }
      state.isCourseModified = false;
      const btn = document.getElementById('btn-save-course');
      if (btn) {
        btn.className = "py-2 px-4 rounded-xl bg-slate-800 text-slate-400 font-black text-xs transition border border-slate-700 flex items-center gap-1.5";
      }
      if (data.state) {
        updateTournamentState(data.state);
      }
      renderCourseSelector();
      showSuccessModal("New Course Saved", `New course "${courseName}" has been created and saved!`);
    } else if (res.status === 403) {
      showToast("Cannot edit: Round is finished and locked.", "lock");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to save course.", "error");
    }
  } catch (err) {
    console.error("Error saving new course:", err);
    showToast("Network error saving new course.", "error");
  }
}

async function saveCourseSpecs() {
  const select = document.getElementById('course-selector');
  let courseId = select?.value || state.tournament?.course_id || 'course-krungthep-kreetha';
  if (courseId === '__new__') {
    return saveNewCourse();
  }

  const nameInp = document.getElementById('cfg-course-name');
  const courseName = nameInp?.value.trim() || state.tournament?.course_name || 'Krungthep Kreetha';

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

  const currentTees = getActiveTees();
  const teesPayload = currentTees.map(t => {
    const ratingInp = document.getElementById(`tee-rating-${t.id}`);
    const slopeInp = document.getElementById(`tee-slope-${t.id}`);
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      course_rating: ratingInp ? (parseFloat(ratingInp.value) || t.course_rating || 72.0) : t.course_rating,
      slope_rating: slopeInp ? (parseInt(slopeInp.value) || t.slope_rating || 113) : t.slope_rating
    };
  });
  const selTeeVal = document.getElementById('active-tee-selector')?.value || 'white';
  const selectedTeeObj = teesPayload.find(t => t.id === selTeeVal) || teesPayload[0] || DEFAULT_TEES[2];

  try {
    const res = await fetch(getRoundApiUrl('/course'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: courseId,
        course_name: courseName,
        holes: holesPayload,
        tees: teesPayload,
        selected_tee: selectedTeeObj
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.isCourseModified = false;
      const btn = document.getElementById('btn-save-course');
      if (btn) {
        btn.className = "py-2 px-4 rounded-xl bg-slate-800 text-slate-400 font-black text-xs transition border border-slate-700 flex items-center gap-1.5";
      }
      updateTournamentState(data);
      await fetchCourses();
      showSuccessModal("Course Specs Saved", "Course specifications, holes, and tees have been saved successfully!");
    } else if (res.status === 403) {
      showToast("Cannot edit: Round is finished and locked.", "lock");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to save course specs.", "error");
    }
  } catch (err) {
    console.error("Error saving course specs:", err);
    showToast("Network error saving course specs.", "error");
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
  if (!confirm("Are you sure you want to clear ALL scores across all 18 holes?")) return;

  try {
    const res = await fetch(getRoundApiUrl('/reset'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.ok) {
      const data = await res.json();
      state.localScores = {};
      state.unlockedHoles = {};
      updateTournamentState(data);
      selectHole(data.starting_hole || 1);
      showToast("All scores cleared!");
    } else if (res.status === 403) {
      showToast("Cannot reset: Round is finished and locked.", "lock");
    }
  } catch (err) {
    console.error("Error resetting scores:", err);
    showToast("Network error resetting scores.", "error");
  }
}

async function restoreDefaultData() {
  if (!confirm("Restore default Sunday Golf Match setup with 4 players and reset all scores?")) return;

  try {
    const res = await fetch(getRoundApiUrl('/reset_default'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.ok) {
      const data = await res.json();
      state.localScores = {};
      state.unlockedHoles = {};
      updateTournamentState(data);
      selectHole(data.starting_hole || 1);
      showToast("Default game setup restored!");
    } else if (res.status === 403) {
      showToast("Cannot restore: Round is finished and locked.", "lock");
    }
  } catch (err) {
    console.error("Error restoring defaults:", err);
    showToast("Network error restoring defaults.", "error");
  }
}

// ================= TAB NAVIGATION =================
function switchTab(tabId) {
  if (state.isManualRound && tabId !== 'leaderboard') {
    tabId = 'leaderboard';
  }
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
      if (state.isManualRound && t !== 'leaderboard') {
        btn.classList.add('opacity-30', 'pointer-events-none', 'cursor-not-allowed');
      }
    }

    const mobBtn = document.getElementById(`tab-btn-mobile-${t}`);
    if (mobBtn) {
      if (t === tabId) {
        mobBtn.className = "flex-1 flex flex-col items-center justify-center py-1 text-amber-400 font-black transition";
      } else {
        mobBtn.className = "flex-1 flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-200 font-medium transition";
      }
      if (state.isManualRound && t !== 'leaderboard') {
        mobBtn.classList.add('opacity-30', 'pointer-events-none', 'cursor-not-allowed');
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

function updateManualRoundTabState() {
  const isManual = Boolean(state.tournament && (state.tournament.is_manual || state.tournament.game_settings?.is_manual));
  state.isManualRound = isManual;

  const banner = document.getElementById('manual-round-banner');
  if (banner) {
    if (isManual) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }

  const disabledTabs = ['play', 'scorecard', 'momentum', 'settings'];
  disabledTabs.forEach(t => {
    const desktopBtn = document.getElementById(`tab-btn-${t}`);
    const mobileBtn = document.getElementById(`tab-btn-mobile-${t}`);

    if (isManual) {
      if (desktopBtn) {
        desktopBtn.classList.add('opacity-30', 'pointer-events-none', 'cursor-not-allowed');
        desktopBtn.title = 'Disabled for manual round';
      }
      if (mobileBtn) {
        mobileBtn.classList.add('opacity-30', 'pointer-events-none', 'cursor-not-allowed');
        mobileBtn.title = 'Disabled for manual round';
      }
    } else {
      if (desktopBtn) {
        desktopBtn.classList.remove('opacity-30', 'pointer-events-none', 'cursor-not-allowed');
        desktopBtn.removeAttribute('title');
      }
      if (mobileBtn) {
        mobileBtn.classList.remove('opacity-30', 'pointer-events-none', 'cursor-not-allowed');
        mobileBtn.removeAttribute('title');
      }
    }
  });

  if (isManual && state.activeTab !== 'leaderboard') {
    switchTab('leaderboard');
  }
}

function str(v) {
  return String(v);
}

// ================= STARTING HOLE TOGGLE =================
function setStartingHole(holeNum) {
  setStartingHoleUI(holeNum);
  if (state.tournament) {
    state.tournament.starting_hole = holeNum;
    if (state.tournament.game_settings) {
      state.tournament.game_settings.starting_hole = holeNum;
    }
  }
}

function setStartingHoleUI(holeNum) {
  const btn1 = document.getElementById('btn-start-hole-1');
  const btn10 = document.getElementById('btn-start-hole-10');
  if (!btn1 || !btn10) return;
  if (holeNum === 10) {
    btn10.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-black transition bg-amber-500 text-slate-950 shadow-md";
    btn1.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-black transition text-slate-400 hover:text-white";
  } else {
    btn1.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-black transition bg-amber-500 text-slate-950 shadow-md";
    btn10.className = "flex-1 py-1.5 px-3 rounded-lg text-xs font-black transition text-slate-400 hover:text-white";
  }
}

// ================= NOTIFICATIONS & TOASTS =================
let toastTimer = null;
function showToast(msg, type = 'info') {
  const toast = document.getElementById('global-toast');
  const toastMsg = document.getElementById('global-toast-msg');
  const toastIcon = document.getElementById('global-toast-icon');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = msg;
  if (toastIcon) {
    toastIcon.textContent = type === 'error' ? '⚠️' : (type === 'lock' ? '🔒' : '⛳');
  }

  toast.classList.remove('opacity-0', 'translate-y-3', 'pointer-events-none');
  toast.classList.add('opacity-100', 'translate-y-0');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-3', 'pointer-events-none');
  }, 3200);
}

// ================= AUTHENTICATION UI =================
function renderAuth() {
  const container = document.getElementById('auth-container');
  const myRoundsBtn = document.getElementById('btn-my-rounds');
  const myPlayersBtn = document.getElementById('btn-my-players');
  const adminConsoleBtn = document.getElementById('btn-admin-console');
  const user = state.currentUser;

  const isAdmin = Boolean(user && (user.is_admin || (user.email && user.email.toLowerCase() === 'kongkomh@gmail.com')));
  if (adminConsoleBtn) {
    if (isAdmin) {
      adminConsoleBtn.classList.remove('hidden');
    } else {
      adminConsoleBtn.classList.add('hidden');
    }
  }

  if (user && user.id) {
    if (myRoundsBtn) {
      myRoundsBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      myRoundsBtn.title = "View saved rounds";
    }
    if (myPlayersBtn) {
      myPlayersBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      myPlayersBtn.title = "View player roster";
    }

    const avatar = user.picture
      ? `<img src="${user.picture}" alt="${user.name || user.email}" class="w-6 h-6 rounded-full border border-amber-400 shadow-sm object-cover" />`
      : `<div class="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-black text-[11px] flex items-center justify-center">${(user.name || user.email || 'U')[0].toUpperCase()}</div>`;

    if (container) {
      container.innerHTML = `
        <div class="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 rounded-xl px-2 py-0.5 shadow-sm">
          <div class="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition" onclick="openMyProfileModal()" title="Edit My Profile">
            ${avatar}
            <span class="text-xs font-bold text-slate-200 max-w-[85px] truncate hidden sm:inline" title="${user.email}">${state.currentPlayer?.nickname || user.name || user.email}</span>
          </div>
          <button type="button" onclick="logout()" class="text-slate-400 hover:text-rose-400 transition ml-0.5 p-0.5" title="Sign out">
            <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    }
  } else {
    if (myRoundsBtn) {
      myRoundsBtn.classList.add('opacity-40', 'cursor-not-allowed');
      myRoundsBtn.title = "Sign in to view My Rounds";
    }
    if (myPlayersBtn) {
      myPlayersBtn.classList.add('opacity-40', 'cursor-not-allowed');
      myPlayersBtn.title = "Sign in to view My Players";
    }

    if (container) {
      container.innerHTML = `
        <a href="/auth/google" class="py-1 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2s.7 5.5 1.9 7.9l3.7-2.9z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.3 7.5 23.5 12 23.5z"/></svg>
          <span>Sign in</span>
        </a>
      `;
    }
  }
  initIcons();
}

function onMyRoundsClick() {
  if (!state.currentUser) {
    showToast("Please sign in with Google to view My Rounds.", "lock");
    return;
  }
  openMyRoundsModal();
}

function onMyPlayersClick() {
  if (!state.currentUser) {
    showToast("Please sign in with Google to view My Players.", "lock");
    return;
  }
  openMyPlayersModal();
}

async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.error(e);
  }
  state.currentUser = null;
  state.currentPlayer = null;
  window.location.reload();
}

// ================= MULTI-ROUND MANAGEMENT =================
async function createNewRound() {
  try {
    const res = await fetch('/api/rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: state.tournament?.course_id || 'course-krungthep-kreetha',
        starting_hole: state.tournament?.starting_hole || 1
      })
    });
    if (res.ok) {
      const data = await res.json();
      const newRoundId = data.round_id || data.id;
      const newUrl = `${window.location.origin}/round/${newRoundId}`;
      window.history.pushState({ roundId: newRoundId }, '', newUrl);
      state.roundId = newRoundId;
      state.localScores = {};
      state.unlockedHoles = {};
      if (data.tournament) {
        state.currentHole = data.tournament.current_display_hole || data.tournament.starting_hole || 1;
        updateTournamentState(data.tournament);
      } else {
        await fetchInitialState();
      }
      setupSSE();
      showToast("Fresh round created!");
      switchTab('play');
    } else {
      showToast("Failed to create new round.", "error");
    }
  } catch (err) {
    console.error("Error creating round:", err);
    showToast("Network error creating round.", "error");
  }
}

function finishCurrentRound() {
  const modal = document.getElementById('finish-round-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeFinishRoundModal() {
  const modal = document.getElementById('finish-round-modal');
  if (modal) modal.classList.add('hidden');
}

async function confirmFinishRound() {
  closeFinishRoundModal();
  try {
    const res = await fetch(getRoundApiUrl('/finish'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
      showToast("Round finished and locked! Scores are read-only.", "lock");
    } else {
      showToast("Failed to lock round.", "error");
    }
  } catch (err) {
    console.error("Error finishing round:", err);
    showToast("Network error.", "error");
  }
}

async function unlockCurrentRound() {
  if (!confirm("Are you sure you want to unlock this round for editing?")) return;
  try {
    const res = await fetch(getRoundApiUrl('/unlock'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      updateTournamentState(data);
      showToast("Round unlocked! You can now edit scores.");
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Only the round creator can unlock this round.", "error");
    }
  } catch (err) {
    console.error("Error unlocking round:", err);
    showToast("Network error.", "error");
  }
}

function copyRoundLink() {
  const rId = state.roundId || (state.tournament ? (state.tournament.round_id || state.tournament.id) : null);
  let shareUrl = window.location.href;
  if (rId) {
    shareUrl = `${window.location.origin}/round/${rId}`;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast("Round link copied to clipboard!");
    }).catch(() => {
      prompt("Copy this round link:", shareUrl);
    });
  } else {
    prompt("Copy this round link:", shareUrl);
  }
}

async function openMyRoundsModal() {
  const modal = document.getElementById('my-rounds-modal');
  if (modal) modal.classList.remove('hidden');

  const tbody = document.getElementById('my-rounds-tbody');
  const emptyEl = document.getElementById('my-rounds-empty');
  if (emptyEl) emptyEl.classList.add('hidden');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-8 text-center text-slate-400 text-xs">
          <div class="inline-block w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-2"></div>
          <p>Loading rounds...</p>
        </td>
      </tr>
    `;
  }

  try {
    const currentRId = state.roundId || (state.tournament ? (state.tournament.round_id || state.tournament.id) : null);
    const fetchUrl = currentRId ? `/api/rounds?current_round_id=${encodeURIComponent(currentRId)}` : '/api/rounds';
    const res = await fetch(fetchUrl);
    if (res.ok) {
      const data = await res.json();
      renderMyRoundsList(Array.isArray(data) ? data : (data.rounds || []));
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-rose-400 text-xs">Failed to load rounds.</td></tr>`;
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-rose-400 text-xs">Network error loading rounds.</td></tr>`;
  }
}

function closeMyRoundsModal() {
  const modal = document.getElementById('my-rounds-modal');
  if (modal) modal.classList.add('hidden');
}

function renderMyRoundsList(rounds) {
  const tbody = document.getElementById('my-rounds-tbody');
  const emptyEl = document.getElementById('my-rounds-empty');
  if (!tbody) return;

  if (!rounds || rounds.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    initIcons();
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  const currentRId = state.roundId || (state.tournament ? (state.tournament.round_id || state.tournament.id) : null);

  tbody.innerHTML = rounds.map(r => {
    const isCurrent = r.id === currentRId;
    const isFinished = Boolean(r.is_finished);
    const isOwner = Boolean(r.is_owner);

    let dateStr = r.date_str || '';
    if (!dateStr) {
      if (typeof r.created_at === 'number') {
        dateStr = new Date(r.created_at * 1000).toLocaleDateString();
      } else if (typeof r.created_at === 'string') {
        dateStr = r.created_at.substring(0, 10);
      }
    }

    const courseTitle = r.course_name || 'Golf Course';
    const creator = r.creator_name || r.creator_email || 'Public';
    const playersList = Array.isArray(r.player_names) && r.player_names.length > 0 
      ? r.player_names.join(', ') 
      : 'None';

    let statusBadge = '';
    if (r.is_manual) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-sky-500/20 text-sky-300 border border-sky-400/40 uppercase shadow-sm">Manual</span>`;
    } else if (isCurrent) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500 text-slate-950 uppercase shadow-sm">Active</span>`;
    } else if (isFinished) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">Finished</span>`;
    } else {
      statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>Ongoing</span>`;
    }

    return `
      <tr class="hover:bg-slate-800/40 transition cursor-pointer ${isCurrent ? 'bg-amber-500/10' : ''}" onclick="openSavedRound('${r.id}')">
        <td class="py-2.5 px-3 whitespace-nowrap">${statusBadge}</td>
        <td class="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">${dateStr}</td>
        <td class="py-2.5 px-3 font-black text-white text-xs">${courseTitle}</td>
        <td class="py-2.5 px-3 text-slate-300 font-bold text-xs whitespace-nowrap">${creator}</td>
        <td class="py-2.5 px-3 text-slate-400 text-xs">${playersList}</td>
        <td class="py-2.5 px-3 text-center whitespace-nowrap" onclick="event.stopPropagation()">
          <div class="flex items-center justify-center gap-1.5">
            <button type="button" onclick="openSavedRound('${r.id}')" class="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold text-xs transition border border-slate-700 shadow-sm">
              Open
            </button>
            ${isOwner ? `
              <button type="button" onclick="deleteSavedRound('${r.id}')" class="p-1 rounded-lg hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition" title="Delete round">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  initIcons();
}

function openSavedRound(rId) {
  closeMyRoundsModal();
  if (rId === state.roundId) return;
  const newUrl = `${window.location.origin}/round/${rId}`;
  window.history.pushState({ roundId: rId }, '', newUrl);
  state.roundId = rId;
  state.localScores = {};
  state.unlockedHoles = {};
  fetchInitialState();
  showToast("Loaded round!");
}

async function deleteSavedRound(rId) {
  if (!confirm("Are you sure you want to permanently delete this round?")) return;
  try {
    const res = await fetch(`/api/round/${rId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast("Round deleted.");
      if (rId === state.roundId) {
        window.location.href = '/';
      } else {
        openMyRoundsModal();
      }
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Cannot delete round (permission denied).", "error");
    }
  } catch (err) {
    console.error("Error deleting round:", err);
    showToast("Network error.", "error");
  }
}

// ================= PROFILE & FIRST-TIME LINKING MODALS =================
function openLinkPlayerModal() {
  const modal = document.getElementById('link-player-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  switchLinkMode('existing');
  populateLinkExistingSelect();
}

function closeLinkPlayerModal() {
  const modal = document.getElementById('link-player-modal');
  if (modal) modal.classList.add('hidden');
}

function switchLinkMode(mode) {
  const btnExisting = document.getElementById('tab-btn-link-existing');
  const btnCreate = document.getElementById('tab-btn-link-create');
  const viewExisting = document.getElementById('link-existing-view');
  const viewCreate = document.getElementById('link-create-view');

  if (mode === 'existing') {
    if (btnExisting) btnExisting.className = "flex-1 py-2 rounded-lg bg-amber-500 text-slate-950 font-black transition";
    if (btnCreate) btnCreate.className = "flex-1 py-2 rounded-lg text-slate-400 hover:text-white transition";
    if (viewExisting) viewExisting.classList.remove('hidden');
    if (viewCreate) viewCreate.classList.add('hidden');
  } else {
    if (btnCreate) btnCreate.className = "flex-1 py-2 rounded-lg bg-amber-500 text-slate-950 font-black transition";
    if (btnExisting) btnExisting.className = "flex-1 py-2 rounded-lg text-slate-400 hover:text-white transition";
    if (viewCreate) viewCreate.classList.remove('hidden');
    if (viewExisting) viewExisting.classList.add('hidden');
    const nickInp = document.getElementById('link-new-nick');
    if (nickInp && !nickInp.value && state.currentUser) {
      nickInp.value = (state.currentUser.given_name || state.currentUser.name?.split(' ')[0] || '').toUpperCase();
    }
  }
}

async function populateLinkExistingSelect() {
  const select = document.getElementById('link-existing-select');
  if (!select) return;
  select.innerHTML = '<option value="">Loading player directory...</option>';
  try {
    const res = await fetch('/api/players');
    if (res.ok) {
      const players = await res.json();
      if (!players || players.length === 0) {
        select.innerHTML = '<option value="">No existing players found</option>';
        return;
      }
      select.innerHTML = players.map(p => {
        return `<option value="${p.id}">${p.nickname} (${p.first_name || ''} ${p.last_name || ''}) - HCP ${p.current_handicap || p.initial_handicap || 18.0}</option>`;
      }).join('');
    }
  } catch (e) {
    select.innerHTML = '<option value="">Error loading players</option>';
  }
}

async function confirmLinkExistingPlayer() {
  const select = document.getElementById('link-existing-select');
  const playerId = select?.value;
  if (!playerId) {
    showToast("Please select a player profile to link.", "error");
    return;
  }
  try {
    const res = await fetch('/api/me/link-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId })
    });
    if (res.ok) {
      const data = await res.json();
      state.currentPlayer = data.player;
      closeLinkPlayerModal();
      showToast(`Account linked to player "${data.player?.nickname || ''}"!`);
      await fetchCurrentUser();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to link player profile.", "error");
    }
  } catch (e) {
    showToast("Network error linking player profile.", "error");
  }
}

async function confirmCreateMyPlayer() {
  const nick = document.getElementById('link-new-nick')?.value.trim();
  const hcp = parseFloat(document.getElementById('link-new-hcp')?.value) || 18.0;
  if (!nick) {
    showToast("Please enter a nickname.", "error");
    return;
  }
  try {
    const res = await fetch('/api/me/create-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nick, handicap: hcp })
    });
    if (res.ok) {
      const data = await res.json();
      state.currentPlayer = data.player;
      closeLinkPlayerModal();
      showToast(`Player profile "${nick}" created!`);
      await fetchCurrentUser();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to create player profile.", "error");
    }
  } catch (e) {
    showToast("Network error creating player profile.", "error");
  }
}

function openMyProfileModal() {
  const modal = document.getElementById('my-profile-modal');
  if (!modal) return;
  const p = state.currentPlayer || {};
  const u = state.currentUser || {};
  const nickInp = document.getElementById('profile-nick');
  const fnInp = document.getElementById('profile-fn');
  const lnInp = document.getElementById('profile-ln');
  const hcpInp = document.getElementById('profile-hcp');

  if (nickInp) nickInp.value = p.nickname || u.given_name || (u.name?.split(' ')[0] || '');
  if (fnInp) fnInp.value = p.first_name || u.given_name || (u.name?.split(' ')[0] || '');
  if (lnInp) lnInp.value = p.last_name || u.family_name || (u.name?.split(' ').slice(1).join(' ') || '');
  if (hcpInp) hcpInp.value = (p.current_handicap !== undefined && p.current_handicap !== null) ? p.current_handicap : 18.0;

  modal.classList.remove('hidden');
}

function closeMyProfileModal() {
  const modal = document.getElementById('my-profile-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitUpdateMyProfile(e) {
  e.preventDefault();
  const nick = document.getElementById('profile-nick')?.value.trim();
  const fn = document.getElementById('profile-fn')?.value.trim();
  const ln = document.getElementById('profile-ln')?.value.trim();
  const hcp = parseFloat(document.getElementById('profile-hcp')?.value) || 18.0;

  if (!nick) {
    showToast("Nickname is required.", "error");
    return;
  }

  try {
    const res = await fetch('/api/me/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: nick,
        first_name: fn,
        last_name: ln,
        current_handicap: hcp
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.currentPlayer = data.player;
      closeMyProfileModal();
      showToast("Player profile updated!");
      renderAuth();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to update profile.", "error");
    }
  } catch (err) {
    showToast("Network error updating profile.", "error");
  }
}

// ================= SUCCESS POPUP MODAL =================
function showSuccessModal(title = "Saved Successfully", msg = "Your changes have been saved.") {
  const modal = document.getElementById('success-popup-modal');
  const tEl = document.getElementById('success-popup-title');
  const mEl = document.getElementById('success-popup-msg');
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = msg;
  if (modal) modal.classList.remove('hidden');
}

function closeSuccessModal() {
  const modal = document.getElementById('success-popup-modal');
  if (modal) modal.classList.add('hidden');
}

// ================= DANGER ZONE: DELETE CURRENT ROUND =================
function promptDeleteCurrentRound() {
  const modal = document.getElementById('delete-round-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteRoundModal() {
  const modal = document.getElementById('delete-round-modal');
  if (modal) modal.classList.add('hidden');
}

async function confirmDeleteCurrentRound() {
  closeDeleteRoundModal();
  const rId = state.roundId || (state.tournament ? (state.tournament.round_id || state.tournament.id) : null);
  if (!rId) {
    showToast("No active round to delete.", "error");
    return;
  }
  try {
    const res = await fetch(`/api/round/${rId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast("Round permanently deleted.");
      window.location.href = '/';
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Cannot delete round.", "error");
    }
  } catch (err) {
    console.error("Error deleting current round:", err);
    showToast("Network error deleting round.", "error");
  }
}

// ================= MY PLAYERS & ROSTER DASHBOARD =================
let currentStatsPeriod = 'all';

async function openMyPlayersModal() {
  const modal = document.getElementById('my-players-modal');
  if (modal) modal.classList.remove('hidden');
  await fetchAndRenderPlayerStats();
}

function closeMyPlayersModal() {
  const modal = document.getElementById('my-players-modal');
  if (modal) modal.classList.add('hidden');
}

function setStatsPeriod(period) {
  currentStatsPeriod = period;
  const btnAll = document.getElementById('btn-stats-all');
  const btnYear = document.getElementById('btn-stats-year');
  const startInp = document.getElementById('stats-start-date');
  const endInp = document.getElementById('stats-end-date');

  if (startInp) startInp.value = '';
  if (endInp) endInp.value = '';

  if (period === 'all') {
    if (btnAll) btnAll.className = "py-1 px-3 rounded-lg font-black text-xs transition bg-amber-500 text-slate-950 shadow-sm";
    if (btnYear) btnYear.className = "py-1 px-3 rounded-lg font-black text-xs transition bg-slate-800 text-slate-300 hover:text-white";
  } else if (period === 'this_year') {
    if (btnYear) btnYear.className = "py-1 px-3 rounded-lg font-black text-xs transition bg-amber-500 text-slate-950 shadow-sm";
    if (btnAll) btnAll.className = "py-1 px-3 rounded-lg font-black text-xs transition bg-slate-800 text-slate-300 hover:text-white";
  }
  fetchAndRenderPlayerStats();
}

function setStatsCustomPeriod() {
  const start = document.getElementById('stats-start-date')?.value;
  const end = document.getElementById('stats-end-date')?.value;
  if (start && end) {
    currentStatsPeriod = 'custom';
    const btnAll = document.getElementById('btn-stats-all');
    const btnYear = document.getElementById('btn-stats-year');
    if (btnAll) btnAll.className = "py-1 px-3 rounded-lg font-black text-xs transition bg-slate-800 text-slate-300 hover:text-white";
    if (btnYear) btnYear.className = "py-1 px-3 rounded-lg font-black text-xs transition bg-slate-800 text-slate-300 hover:text-white";
    fetchAndRenderPlayerStats();
  }
}

function onStatsCurrencyChanged() {
  fetchAndRenderPlayerStats();
}

async function fetchAndRenderPlayerStats() {
  const tbody = document.getElementById('my-players-tbody');
  if (!tbody) return;

  const currency = document.getElementById('stats-currency')?.value || 'THB';
  const start = document.getElementById('stats-start-date')?.value || '';
  const end = document.getElementById('stats-end-date')?.value || '';

  let url = `/api/players/stats?range=${currentStatsPeriod}&currency=${currency}`;
  if (currentStatsPeriod === 'custom' && start && end) {
    url += `&start_date=${start}&end_date=${end}`;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="py-8 text-center text-slate-400 text-xs">
        <div class="inline-block w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mb-1"></div>
        <p>Loading player statistics...</p>
      </td>
    </tr>
  `;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const stats = await res.json();
      renderMyPlayersTable(stats, currency);
    } else {
      tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-400 text-xs">Failed to load player stats.</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-rose-400 text-xs">Network error loading stats.</td></tr>`;
  }
}

function renderMyPlayersTable(stats, currency = 'THB') {
  const tbody = document.getElementById('my-players-tbody');
  if (!tbody) return;

  state.myRosterPlayerIds = new Set((stats || []).map(p => p.id));
  if (state.currentPlayer?.id) state.myRosterPlayerIds.add(state.currentPlayer.id);

  if (!stats || stats.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-8 text-center text-slate-400 text-xs">
          <i data-lucide="users" class="w-7 h-7 mx-auto mb-1.5 text-slate-600"></i>
          <p class="font-bold">No players in your roster yet.</p>
          <p class="text-[11px] text-slate-500 mt-0.5">Click "Add Friends" to search and add friends!</p>
        </td>
      </tr>
    `;
    initIcons();
    return;
  }

  tbody.innerHTML = stats.map(p => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ') || '-';
    const emailStr = p.email || '-';
    const hcpStr = p.current_handicap != null ? Number(p.current_handicap).toFixed(1) : '-';
    const rounds = p.rounds_played || 0;
    const cash = (p.total_cash !== undefined) ? p.total_cash : (p.total_cash_won_lost || 0);

    const isPos = cash > 0;
    const isNeg = cash < 0;
    const cashClass = isPos ? 'text-emerald-400' : (isNeg ? 'text-rose-400' : 'text-slate-400');
    const cashPrefix = isPos ? '+' : '';
    const cashStr = `${cashPrefix}${cash.toLocaleString()} ${currency}`;
    const safeNick = (p.nickname || '').replace(/'/g, "\\'");

    return `
      <tr class="hover:bg-slate-800/60 transition cursor-pointer" onclick="openPlayerHistoryModal('${p.id}', '${safeNick}')" title="Click to view past round history">
        <td class="py-2.5 px-3 font-black text-amber-400 text-xs">
          <span class="hover:underline underline-offset-2">${p.nickname}</span>
        </td>
        <td class="py-2.5 px-3 text-slate-200 text-xs font-bold">${fullName}</td>
        <td class="py-2.5 px-3 text-slate-400 text-[11px]">${emailStr}</td>
        <td class="py-2.5 px-3 text-center font-mono font-bold text-white text-xs">${hcpStr}</td>
        <td class="py-2.5 px-3 text-center text-slate-300 font-mono text-xs">${rounds}</td>
        <td class="py-2.5 px-3 text-right font-black font-mono text-xs ${cashClass}">${cashStr}</td>
        <td class="py-2.5 px-2 text-center" onclick="event.stopPropagation()">
          <button type="button" onclick="removePlayerFromRoster('${p.id}')" class="p-1 rounded-lg hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition" title="Remove from my roster">
            <i data-lucide="user-minus" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
  initIcons();
}

async function removePlayerFromRoster(playerId) {
  if (!confirm("Remove this player from your roster?")) return;
  try {
    const res = await fetch(`/api/my-players/${playerId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast("Player removed from roster.");
      if (state.myRosterPlayerIds) state.myRosterPlayerIds.delete(playerId);
      await fetchAndRenderPlayerStats();
    } else {
      showToast("Failed to remove player.", "error");
    }
  } catch (err) {
    showToast("Network error removing player.", "error");
  }
}

// ================= GLOBAL PLAYERS DIRECTORY & SEARCH =================
function openAddPlayerModal() {
  const modal = document.getElementById('add-player-modal');
  if (modal) modal.classList.remove('hidden');
  const searchInp = document.getElementById('global-player-search');
  if (searchInp) {
    searchInp.value = '';
    searchInp.focus();
  }
  searchGlobalPlayers('');
}

function closeAddPlayerModal() {
  const modal = document.getElementById('add-player-modal');
  if (modal) modal.classList.add('hidden');
}

let globalSearchDebounce = null;
async function searchGlobalPlayers(q) {
  if (globalSearchDebounce) clearTimeout(globalSearchDebounce);
  globalSearchDebounce = setTimeout(async () => {
    const resultsContainer = document.getElementById('global-players-search-results');
    if (!resultsContainer) return;

    try {
      const res = await fetch(`/api/players?q=${encodeURIComponent(q || '')}`);
      if (res.ok) {
        const players = await res.json();
        renderGlobalSearchResults(players);
      }
    } catch (err) {
      console.error("Global search error:", err);
    }
  }, 150);
}

function renderGlobalSearchResults(players) {
  const container = document.getElementById('global-players-search-results');
  if (!container) return;

  if (!players || players.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-slate-400 text-xs">
        <p class="font-bold">No players found.</p>
        <p class="text-[11px] text-slate-500 mt-1">Try another search or click "Create New Player".</p>
      </div>
    `;
    return;
  }

  container.innerHTML = players.map(p => {
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
    const hcpStr = p.current_handicap != null ? Number(p.current_handicap).toFixed(1) : '-';
    const isAdded = Boolean(state.myRosterPlayerIds && state.myRosterPlayerIds.has(p.id));

    return `
      <div class="p-3 flex items-center justify-between gap-2 hover:bg-slate-800/40 transition">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-black text-amber-400 text-xs">${p.nickname}</span>
            <span class="text-white text-xs font-bold truncate">${fullName}</span>
          </div>
          <div class="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
            ${p.email ? `<span class="truncate">${p.email}</span><span>•</span>` : ''}
            <span>HCP: <strong class="text-slate-200">${hcpStr}</strong></span>
          </div>
        </div>
        ${isAdded ? `
          <span class="py-1 px-2.5 rounded-lg bg-slate-800 text-slate-400 font-bold text-xs flex items-center gap-1 shrink-0 border border-slate-700 shadow-inner">
            <i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i>
            <span>Added</span>
          </span>
        ` : `
          <button type="button" onclick="addPlayerToMyRoster('${p.id}')"
                  class="py-1 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition flex items-center gap-1 shrink-0 shadow">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>Add Friend</span>
          </button>
        `}
      </div>
    `;
  }).join('');
  initIcons();
}

async function addPlayerToMyRoster(playerId) {
  try {
    const res = await fetch('/api/my-players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId })
    });
    if (res.ok) {
      showToast("Friend added to your roster!");
      if (!state.myRosterPlayerIds) state.myRosterPlayerIds = new Set();
      state.myRosterPlayerIds.add(playerId);
      await fetchAndRenderPlayerStats();
      const searchInp = document.getElementById('global-player-search');
      searchGlobalPlayers(searchInp ? searchInp.value : '');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to add player.", "error");
    }
  } catch (err) {
    showToast("Network error adding player.", "error");
  }
}

// ================= PLAYER PAST ROUND HISTORY MODAL =================
async function openPlayerHistoryModal(playerId, nickname) {
  const modal = document.getElementById('player-history-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const titleEl = document.getElementById('player-history-title');
  if (titleEl) titleEl.textContent = `${nickname || 'Player'}'s Past Rounds`;

  const tbody = document.getElementById('player-history-tbody');
  const emptyEl = document.getElementById('player-history-empty');
  const loadingEl = document.getElementById('player-history-loading');

  if (tbody) tbody.innerHTML = '';
  if (emptyEl) emptyEl.classList.add('hidden');
  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    const res = await fetch(`/api/players/${encodeURIComponent(playerId)}/history`);
    if (loadingEl) loadingEl.classList.add('hidden');

    if (res.ok) {
      const history = await res.json();
      if (!history || history.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }

      if (tbody) {
        tbody.innerHTML = history.map(item => {
          let dateStr = item.round_date || '';
          const rawScore = (item.gross_score && item.gross_score > 0) ? item.gross_score : '-';
          const diffVal = (item.differential != null) ? Number(item.differential).toFixed(1) : '-';
          const isCounting = Boolean(item.is_counting);
          
          let diffHtml = '';
          if (isCounting) {
            diffHtml = `
              <div class="inline-flex items-center justify-center gap-1 font-mono font-black text-emerald-400">
                <span>${diffVal}</span>
                <span class="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.2 rounded border border-emerald-500/30" title="Differential used for WHS Handicap Index">★</span>
              </div>
            `;
          } else {
            diffHtml = `<span class="font-mono text-slate-300 text-xs">${diffVal}</span>`;
          }

          const cash = item.cash_won || 0;
          const curr = item.currency || 'THB';
          let cashHtml = '';
          if (cash > 0) {
            cashHtml = `<span class="font-mono font-black text-emerald-400 text-xs">+${cash.toLocaleString()} ${curr}</span>`;
          } else if (cash < 0) {
            cashHtml = `<span class="font-mono font-black text-rose-400 text-xs">${cash.toLocaleString()} ${curr}</span>`;
          } else {
            cashHtml = `<span class="font-mono text-slate-400 text-xs">0 ${curr}</span>`;
          }

          return `
            <tr class="hover:bg-slate-900/40 transition">
              <td class="py-2.5 px-3 text-slate-300 font-mono text-xs whitespace-nowrap">${dateStr}</td>
              <td class="py-2.5 px-3 font-bold text-white text-xs">${item.course_name || 'Golf Course'}</td>
              <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-200 text-xs">${rawScore}</td>
              <td class="py-2.5 px-3 text-center text-xs">${diffHtml}</td>
              <td class="py-2.5 px-3 text-right text-xs whitespace-nowrap">${cashHtml}</td>
            </tr>
          `;
        }).join('');
      }
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-400 text-xs">Failed to load round history.</td></tr>`;
    }
  } catch (err) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-400 text-xs">Network error loading round history.</td></tr>`;
  }
  initIcons();
}

function closePlayerHistoryModal() {
  const modal = document.getElementById('player-history-modal');
  if (modal) modal.classList.add('hidden');
}

// ================= WHS HANDICAP DETERMINATION MODAL =================
function openHandicapInfoModal() {
  const modal = document.getElementById('handicap-info-modal');
  if (modal) modal.classList.remove('hidden');
  initIcons();
}

function closeHandicapInfoModal() {
  const modal = document.getElementById('handicap-info-modal');
  if (modal) modal.classList.add('hidden');
}

// ================= CREATE NEW PLAYER =================
function openCreatePlayerModal() {
  const modal = document.getElementById('create-player-modal');
  const warn = document.getElementById('create-player-warn');
  if (warn) warn.classList.add('hidden');
  const form = document.getElementById('create-player-form');
  if (form) form.reset();
  if (modal) modal.classList.remove('hidden');
}

function closeCreatePlayerModal() {
  const modal = document.getElementById('create-player-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitCreatePlayer(e) {
  e.preventDefault();
  const warn = document.getElementById('create-player-warn');
  const warnMsg = document.getElementById('create-player-warn-msg');
  if (warn) warn.classList.add('hidden');

  const nick = document.getElementById('new-player-nick')?.value.trim();
  const fn = document.getElementById('new-player-fn')?.value.trim();
  const ln = document.getElementById('new-player-ln')?.value.trim();
  const hcp = parseFloat(document.getElementById('new-player-hcp')?.value) || 18.0;

  if (!nick || !fn || !ln) {
    if (warn && warnMsg) {
      warnMsg.textContent = "Nickname, First Name, and Last Name are all required.";
      warn.classList.remove('hidden');
    }
    return;
  }

  try {
    const res = await fetch('/api/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: nick,
        first_name: fn,
        last_name: ln,
        initial_handicap: hcp
      })
    });

    if (res.status === 409) {
      const err = await res.json().catch(() => ({}));
      if (warn && warnMsg) {
        warnMsg.textContent = err.error || "A player with this nickname or name already exists.";
        warn.classList.remove('hidden');
      }
      return;
    }

    if (res.ok) {
      const newPlayer = await res.json();
      showToast(`Player "${newPlayer.nickname}" created!`);
      closeCreatePlayerModal();
      // Auto-add to user's roster
      await fetch('/api/my-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: newPlayer.id })
      });
      closeAddPlayerModal();
      await fetchAndRenderPlayerStats();
    } else {
      const err = await res.json().catch(() => ({}));
      if (warn && warnMsg) {
        warnMsg.textContent = err.error || "Failed to create player.";
        warn.classList.remove('hidden');
      }
    }
  } catch (err) {
    if (warn && warnMsg) {
      warnMsg.textContent = "Network error creating player.";
      warn.classList.remove('hidden');
    }
  }
}

// ================= ADMIN CONSOLE CONTROLLER =================
const adminData = {
  accounts: { users: [], players: [] },
  allRounds: [],
  manualLineup: []
};

function openAdminModal() {
  const user = state.currentUser;
  const isAdmin = Boolean(user && (user.is_admin || (user.email && user.email.toLowerCase() === 'kongkomh@gmail.com')));
  if (!isAdmin) {
    showToast("Access denied: Admin credentials required.", "error");
    return;
  }
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.remove('hidden');
  switchAdminTab('accounts');
}

function closeAdminModal() {
  const modal = document.getElementById('admin-modal');
  if (modal) modal.classList.add('hidden');
}

function switchAdminTab(tabName) {
  const tabs = ['accounts', 'manual', 'rounds'];
  tabs.forEach(t => {
    const btn = document.getElementById(`admin-tab-btn-${t}`);
    const view = document.getElementById(`admin-view-${t}`);
    if (btn) {
      if (t === tabName) {
        btn.className = "py-2 px-3 rounded-xl transition flex items-center gap-1.5 bg-amber-500 text-slate-950 font-black shrink-0";
      } else {
        btn.className = "py-2 px-3 rounded-xl transition flex items-center gap-1.5 text-slate-400 hover:text-white hover:bg-slate-800 shrink-0";
      }
    }
    if (view) {
      if (t === tabName) view.classList.remove('hidden');
      else view.classList.add('hidden');
    }
  });

  if (tabName === 'accounts') {
    loadAdminAccounts();
  } else if (tabName === 'manual') {
    initAdminManualRoundForm();
  } else if (tabName === 'rounds') {
    loadAdminAllRounds();
  }
  initIcons();
}

async function loadAdminAccounts() {
  const uTbody = document.getElementById('admin-users-tbody');
  const pTbody = document.getElementById('admin-players-tbody');
  if (uTbody) {
    uTbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-400 text-xs"><div class="inline-block w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-2"></div>Loading accounts...</td></tr>`;
  }
  if (pTbody) {
    pTbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-400 text-xs"><div class="inline-block w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-2"></div>Loading players...</td></tr>`;
  }

  try {
    const res = await fetch('/api/admin/accounts');
    if (!res.ok) {
      showToast("Failed to load admin accounts data.", "error");
      return;
    }
    const data = await res.json();
    adminData.accounts = data;

    const users = data.users || [];
    const players = data.players || [];
    const unlinkedPlayers = players.filter(p => !p.user_id);

    // 1. Render Google Users Table
    if (uTbody) {
      if (users.length === 0) {
        uTbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-500 text-xs font-bold">No registered Google users found.</td></tr>`;
      } else {
        uTbody.innerHTML = users.map(u => {
          const lp = u.linked_player;
          let linkStatus = '';
          let actionBtn = '';

          if (lp) {
            linkStatus = `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <i data-lucide="check" class="w-3 h-3 text-emerald-400"></i>
                <span>${lp.nickname} (HCP: ${lp.current_handicap != null ? Number(lp.current_handicap).toFixed(1) : '-'})</span>
              </span>
            `;
            actionBtn = `
              <button type="button" onclick="adminUnlinkPlayer('${lp.id}')" class="py-1 px-2.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700/50 text-rose-300 font-bold text-[11px] transition shadow-sm">
                Unlink
              </button>
            `;
          } else {
            linkStatus = `<span class="text-slate-500 text-[11px] italic">Not linked</span>`;
            actionBtn = `
              <div class="flex items-center justify-end gap-1.5">
                <select id="admin-user-link-select-${u.id}" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold text-[11px] max-w-[140px]">
                  <option value="">-- Select Player --</option>
                  ${unlinkedPlayers.map(p => `<option value="${p.id}">${p.nickname} (${p.first_name || ''} ${p.last_name || ''})</option>`).join('')}
                </select>
                <button type="button" onclick="adminLinkUser('${u.id}', 'admin-user-link-select-${u.id}')" class="py-1 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition shadow-sm">
                  Link
                </button>
              </div>
            `;
          }

          return `
            <tr class="hover:bg-slate-800/40 transition">
              <td class="py-2.5 px-3 font-bold text-white text-xs">${u.name || '-'}</td>
              <td class="py-2.5 px-3 text-slate-300 font-mono text-xs">${u.email || '-'}</td>
              <td class="py-2.5 px-3">${linkStatus}</td>
              <td class="py-2.5 px-3 text-right">${actionBtn}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // 2. Render Players Directory Table
    if (pTbody) {
      if (players.length === 0) {
        pTbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-500 text-xs font-bold">No players found in database.</td></tr>`;
      } else {
        pTbody.innerHTML = players.map(p => {
          const lu = p.linked_user;
          const userStr = lu ? `<span class="text-emerald-400 font-mono text-[11px]">${lu.email}</span>` : `<span class="text-slate-500 text-[11px] italic">None</span>`;
          const hcpStr = p.current_handicap != null ? Number(p.current_handicap).toFixed(1) : '-';
          const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ') || '-';
          const safeNick = (p.nickname || '').replace(/'/g, "\\'");

          return `
            <tr class="hover:bg-slate-800/40 transition">
              <td class="py-2.5 px-3 font-black text-amber-400 text-xs">${p.nickname}</td>
              <td class="py-2.5 px-3 text-slate-300 text-xs">${fullName}</td>
              <td class="py-2.5 px-3 text-slate-400 font-mono text-xs">${p.email || '-'}</td>
              <td class="py-2.5 px-3 text-center font-mono font-bold text-white text-xs">${hcpStr}</td>
              <td class="py-2.5 px-3">${userStr}</td>
              <td class="py-2.5 px-3 text-right">
                <button type="button" onclick="adminDeletePlayer('${p.id}', '${safeNick}')" class="p-1 rounded-lg hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition" title="Delete player permanently">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    initIcons();
  } catch (err) {
    console.error("Admin load accounts error:", err);
    showToast("Network error loading admin accounts.", "error");
  }
}

async function adminLinkUser(userId, selectElemId) {
  const sel = document.getElementById(selectElemId);
  const playerId = sel ? sel.value : null;
  if (!playerId) {
    showToast("Please select a player to link.", "warning");
    return;
  }

  try {
    const res = await fetch('/api/admin/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, player_id: playerId })
    });
    if (res.ok) {
      showToast("Account linked successfully!");
      await loadAdminAccounts();
      await fetchCurrentUser();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to link account.", "error");
    }
  } catch (err) {
    console.error("Error linking account:", err);
    showToast("Network error linking account.", "error");
  }
}

async function adminUnlinkPlayer(playerId) {
  if (!confirm("Are you sure you want to unlink this user account from this player profile?")) return;

  try {
    const res = await fetch('/api/admin/unlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId })
    });
    if (res.ok) {
      showToast("Player unlinked successfully.");
      await loadAdminAccounts();
      await fetchCurrentUser();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to unlink player.", "error");
    }
  } catch (err) {
    console.error("Error unlinking player:", err);
    showToast("Network error unlinking player.", "error");
  }
}

async function adminDeletePlayer(playerId, playerName) {
  if (!confirm(`Are you sure you want to PERMANENTLY delete player "${playerName}" from the database?\nThis will remove them from all rosters and scoring histories.`)) return;

  try {
    const res = await fetch(`/api/admin/players/${encodeURIComponent(playerId)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast(`Player "${playerName}" permanently deleted.`);
      await loadAdminAccounts();
      await fetchAndRenderPlayerStats();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to delete player.", "error");
    }
  } catch (err) {
    console.error("Error deleting player:", err);
    showToast("Network error deleting player.", "error");
  }
}

async function initAdminManualRoundForm() {
  const dateInput = document.getElementById('admin-manual-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().substring(0, 10);
  }

  // 1. Populate courses
  if (!state.coursesCatalog || state.coursesCatalog.length === 0) {
    await fetchCourses();
  }
  const courseSelect = document.getElementById('admin-manual-course');
  if (courseSelect && state.coursesCatalog) {
    courseSelect.innerHTML = state.coursesCatalog.map(c => `
      <option value="${c.id}">${c.name || 'Golf Course'}</option>
    `).join('');
  }
  onAdminManualCourseChange();

  // 2. Populate player dropdown from catalog
  const pSelect = document.getElementById('admin-manual-add-player-select');
  if (pSelect) {
    let allPlayers = adminData.accounts.players;
    if (!allPlayers || allPlayers.length === 0) {
      const res = await fetch('/api/players');
      if (res.ok) allPlayers = await res.json();
    }
    pSelect.innerHTML = (allPlayers || []).map(p => `
      <option value="${p.id}">${p.nickname} (${p.first_name || ''} ${p.last_name || ''})</option>
    `).join('');
  }

  renderAdminManualLineup();
}

function onAdminManualCourseChange() {
  const cSelect = document.getElementById('admin-manual-course');
  const tSelect = document.getElementById('admin-manual-tee');
  if (!cSelect || !tSelect || !state.coursesCatalog) return;

  const cId = cSelect.value;
  const course = state.coursesCatalog.find(c => c.id === cId) || state.coursesCatalog[0];
  const tees = (course && course.tees) || [
    { name: "White", course_rating: 71.5, slope_rating: 126 },
    { name: "Blue", course_rating: 73.0, slope_rating: 131 },
    { name: "Yellow", course_rating: 70.1, slope_rating: 122 },
    { name: "Red", course_rating: 68.4, slope_rating: 118 },
    { name: "Black", course_rating: 74.8, slope_rating: 137 }
  ];

  tSelect.innerHTML = tees.map(t => `
    <option value="${t.name}" ${t.name.toLowerCase() === 'white' ? 'selected' : ''}>
      ${t.name} (Rating: ${t.course_rating || 72.0}, Slope: ${t.slope_rating || 113})
    </option>
  `).join('');
}

function addPlayerToAdminManualLineup() {
  const pSelect = document.getElementById('admin-manual-add-player-select');
  if (!pSelect || !pSelect.value) return;

  const pId = pSelect.value;
  if (adminData.manualLineup.some(p => p.player_id === pId)) {
    showToast("Player is already in this lineup.", "warning");
    return;
  }

  const pName = pSelect.options[pSelect.selectedIndex].text.split('(')[0].trim();
  adminData.manualLineup.push({
    player_id: pId,
    name: pName,
    gross_score: "",
    cash_won_lost: 0
  });

  renderAdminManualLineup();
}

function removePlayerFromAdminManualLineup(playerId) {
  adminData.manualLineup = adminData.manualLineup.filter(p => p.player_id !== playerId);
  renderAdminManualLineup();
}

function updateLineupScore(playerId, val) {
  const p = adminData.manualLineup.find(x => x.player_id === playerId);
  if (p) p.gross_score = val.trim();
}

function updateLineupCash(playerId, val) {
  const p = adminData.manualLineup.find(x => x.player_id === playerId);
  if (p) p.cash_won_lost = Number(val) || 0;
}

function renderAdminManualLineup() {
  const tbody = document.getElementById('admin-manual-lineup-tbody');
  const emptyEl = document.getElementById('admin-manual-empty-lineup');
  if (!tbody) return;

  if (adminData.manualLineup.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  tbody.innerHTML = adminData.manualLineup.map((p, idx) => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-2.5 px-3">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-lg bg-slate-800 text-amber-400 font-black text-xs flex items-center justify-center">${idx + 1}</span>
          <span class="font-black text-white text-xs">${p.name}</span>
        </div>
      </td>
      <td class="py-2.5 px-3">
        <input type="number" min="40" max="150" placeholder="Blank = exempt" value="${p.gross_score}" onchange="updateLineupScore('${p.player_id}', this.value)" class="w-32 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-white font-mono text-xs focus:ring-1 focus:ring-sky-500">
      </td>
      <td class="py-2.5 px-3">
        <input type="number" placeholder="0" value="${p.cash_won_lost}" onchange="updateLineupCash('${p.player_id}', this.value)" class="w-32 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-white font-mono text-xs focus:ring-1 focus:ring-sky-500">
      </td>
      <td class="py-2.5 px-3 text-center">
        <button type="button" onclick="removePlayerFromAdminManualLineup('${p.player_id}')" class="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </td>
    </tr>
  `).join('');

  initIcons();
}

async function submitAdminManualRound() {
  if (adminData.manualLineup.length === 0) {
    showToast("Please add at least one player to the round.", "warning");
    return;
  }

  const courseId = document.getElementById('admin-manual-course')?.value;
  const teeName = document.getElementById('admin-manual-tee')?.value || 'White';
  const dateStr = document.getElementById('admin-manual-date')?.value || new Date().toISOString().substring(0, 10);
  const currency = document.getElementById('admin-manual-currency')?.value || 'THB';

  const payload = {
    course_id: courseId,
    tee_name: teeName,
    date_str: dateStr,
    currency: currency,
    players: adminData.manualLineup.map(p => ({
      player_id: p.player_id,
      gross_score: p.gross_score === "" || p.gross_score == null ? null : Number(p.gross_score),
      cash_won_lost: Number(p.cash_won_lost || 0)
    }))
  };

  try {
    const res = await fetch('/api/admin/manual-rounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      showToast("Manual round created successfully!");
      adminData.manualLineup = [];
      closeAdminModal();
      await openSavedRound(data.round_id);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to create manual round.", "error");
    }
  } catch (err) {
    console.error("Error creating manual round:", err);
    showToast("Network error creating manual round.", "error");
  }
}

async function loadAdminAllRounds() {
  const tbody = document.getElementById('admin-rounds-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-400 text-xs"><div class="inline-block w-4 h-4 border-2 border-rose-400 border-t-transparent rounded-full animate-spin mr-2"></div>Loading all rounds...</td></tr>`;
  }

  try {
    const res = await fetch('/api/admin/all-rounds');
    if (!res.ok) {
      showToast("Failed to load rounds.", "error");
      return;
    }
    const rounds = await res.json();
    adminData.allRounds = rounds;

    if (tbody) {
      if (rounds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-500 text-xs font-bold">No rounds recorded in database.</td></tr>`;
      } else {
        tbody.innerHTML = rounds.map(r => {
          const typeBadge = r.is_manual
            ? `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-sky-500/20 text-sky-300 border border-sky-400/40">MANUAL</span>`
            : `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">LIVE</span>`;

          const safeName = (r.name || 'Round').replace(/'/g, "\\'");
          const playersStr = Array.isArray(r.player_names) && r.player_names.length > 0
            ? `${r.players_count} (${r.player_names.slice(0, 3).join(', ')}${r.players_count > 3 ? '...' : ''})`
            : `${r.players_count || 0}`;

          return `
            <tr class="hover:bg-slate-800/40 transition">
              <td class="py-2.5 px-3">
                <div class="font-bold text-white text-xs">${r.date_str || '-'}</div>
                <div class="text-[11px] text-slate-400 truncate max-w-xs">${r.name || '-'}</div>
              </td>
              <td class="py-2.5 px-3 text-slate-300 text-xs">${r.course_name || 'Golf Course'}</td>
              <td class="py-2.5 px-3">
                <div class="font-bold text-white text-xs">${r.creator_name || '-'}</div>
                <div class="text-[10px] text-slate-500 font-mono">${r.creator_email || '-'}</div>
              </td>
              <td class="py-2.5 px-3 text-center">${typeBadge}</td>
              <td class="py-2.5 px-3 text-center text-slate-300 text-xs">${playersStr}</td>
              <td class="py-2.5 px-3 text-right">
                <button type="button" onclick="adminDeleteRound('${r.id}', '${safeName}')" class="p-1 rounded-lg hover:bg-rose-950 text-slate-500 hover:text-rose-400 transition" title="Delete round permanently">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    initIcons();
  } catch (err) {
    console.error("Error loading all rounds:", err);
    showToast("Network error loading rounds.", "error");
  }
}

async function adminDeleteRound(roundId, roundName) {
  if (!confirm(`Are you sure you want to PERMANENTLY delete round "${roundName}"?\nThis will remove the round from the database and recalculate WHS handicaps for all affected players.`)) return;

  try {
    const res = await fetch(`/api/admin/rounds/${encodeURIComponent(roundId)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast("Round permanently deleted and handicaps recalculated.");
      await loadAdminAllRounds();
      if (roundId === state.roundId) {
        window.location.href = '/';
      }
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to delete round.", "error");
    }
  } catch (err) {
    console.error("Error deleting round:", err);
    showToast("Network error deleting round.", "error");
  }
}
