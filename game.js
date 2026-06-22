/**
 * ═══════════════════════════════════════════════════════════════
 *  NUMBLE v2 — game.js
 *  Daily 4-digit number puzzle · 8-guess edition
 *  Vanilla ES6+ · No dependencies
 *
 *  Changes from v1:
 *  - Epoch changed to 2026-06-22 (Day #1)
 *  - Unique-digits enforcement on all generated numbers
 *  - Tile-by-tile Wordle-style flip reveal with color feedback
 *  - Keyboard digit state tracking (green > yellow > gray)
 *  - Input locked during flip animation
 *  - Practice mode (infinite, separate stats, no daily effect)
 *  - Hint system (2 per game, Easy mode only)
 *  - Achievements (10 milestones, localStorage-persisted)
 *  - Calendar/history view (from 2026-06-22, no fake data)
 *  - Difficulty modes (Easy/Normal/Hard/Nightmare)
 *  - 5 themes (CSS data-attribute driven)
 *  - Sound effects (Web Audio API, mute toggle)
 *  - Improved share text (emoji grid per tile)
 *  - State version + migration utility
 *  - All stats start at 0, no mock data anywhere
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   VERSION & MIGRATION
═══════════════════════════════════════════════════════════════ */
const STATE_VERSION = 3;
const LS_STATE      = 'numble_state_v3';
const LS_STATS      = 'numble_stats_v3';
const LS_HISTORY    = 'numble_history_v3';  // { "YYYY-MM-DD": "won"|"lost" }
const LS_ACHIEVE    = 'numble_achievements_v3';
const LS_PREFS      = 'numble_prefs_v3';
const LS_PSTATS     = 'numble_pstats_v3';   // practice stats

/** Wipe outdated keys from previous versions */
function migrateStorage() {
  const OLD_KEYS = [
    'numble_state_v1','numble_stats_v1',
    'numble_state_v2','numble_stats_v2',
  ];
  OLD_KEYS.forEach(k => {
    try { localStorage.removeItem(k); } catch {}
  });
}

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */
const DIGITS      = 4;
const MAX_GUESSES = 8;

/** June 22 2026 is Puzzle #1 */
const EPOCH_DATE  = Date.UTC(2026, 5, 22);   // month is 0-indexed: 5 = June

const FLIP_DELAY_PER_TILE = 300;  // ms between each tile flip
const FLIP_DURATION       = 500;  // ms for one tile's full flip animation

/* ═══════════════════════════════════════════════════════════════
   UTILITY — UNIQUE DIGITS
═══════════════════════════════════════════════════════════════ */

/**
 * Returns true if every character in a digit string is unique.
 * @param {string} numStr
 * @returns {boolean}
 */
function hasUniqueDigits(numStr) {
  return new Set(numStr.split('')).size === numStr.length;
}

/* ═══════════════════════════════════════════════════════════════
   DAILY TARGET — deterministic PRNG seeded by UTC date
   Guarantees unique digits by iterating LCG until satisfied.
═══════════════════════════════════════════════════════════════ */

/** @returns {string}  "YYYY-MM-DD" in UTC */
function getUTCDateString() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(n.getUTCDate()).padStart(2,'0')}`;
}

/**
 * djb2-style hash → unsigned 32-bit integer
 * @param {string} str
 * @returns {number}
 */
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * LCG step (Numerical Recipes, 32-bit unsigned).
 * @param {number} seed
 * @returns {number}
 */
function lcgStep(seed) {
  return (Math.imul(1664525, seed) + 1013904223) >>> 0;
}

/**
 * Generate a 4-digit string with ALL UNIQUE digits seeded by a date string.
 * Loops the LCG until a valid combination is found — always terminates fast.
 * @param {string} dateStr  "YYYY-MM-DD"
 * @returns {string}
 */
function generateUniqueDigitNumber(dateStr) {
  let seed = hashStr(dateStr);
  let attempt = 0;
  while (true) {
    const digits = [];
    let s = seed;
    for (let i = 0; i < DIGITS; i++) {
      s = lcgStep(s);
      digits.push(s % 10);
    }
    const result = digits.join('');
    if (hasUniqueDigits(result)) return result;
    // Perturb seed and retry
    seed = lcgStep(seed + ++attempt * 7919);
  }
}

/** Today's secret number */
function getDailyTarget() {
  return generateUniqueDigitNumber(getUTCDateString());
}

/**
 * Puzzle number: 2026-06-22 = #1, +1 each day.
 * @returns {number}
 */
function getPuzzleNumber() {
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  return Math.max(1, Math.floor((today - EPOCH_DATE) / 86_400_000) + 1);
}

/* ═══════════════════════════════════════════════════════════════
   FEEDBACK ALGORITHM
   Returns per-tile results: 'green' | 'yellow' | 'gray'
   Uses two-pass Wordle method to handle any repeated guesses.
═══════════════════════════════════════════════════════════════ */

/**
 * @param {string} guess   4-char
 * @param {string} target  4-char (unique digits)
 * @returns {('green'|'yellow'|'gray')[]}  array of length 4
 */
function calcTileFeedback(guess, target) {
  const tArr   = target.split('');
  const gArr   = guess.split('');
  const result = Array(DIGITS).fill(null);
  const tLeft  = [...tArr];

  // Pass 1 — greens
  for (let i = 0; i < DIGITS; i++) {
    if (gArr[i] === tArr[i]) {
      result[i] = 'green';
      tLeft[i]  = null;
    }
  }
  // Pass 2 — yellows / grays
  for (let i = 0; i < DIGITS; i++) {
    if (result[i] === 'green') continue;
    const idx = tLeft.indexOf(gArr[i]);
    if (idx !== -1) {
      result[i]  = 'yellow';
      tLeft[idx] = null;
    } else {
      result[i] = 'gray';
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════ */
const TARGET = getDailyTarget();
const TODAY  = getUTCDateString();

/**
 * Daily game state.
 * feedbacks: array of per-tile arrays, e.g. [['green','yellow','gray','gray'], ...]
 */
let state = {
  version:   STATE_VERSION,
  date:      TODAY,
  guesses:   [],
  feedbacks: [],   // Array of ('green'|'yellow'|'gray')[]
  status:    'playing',   // 'playing' | 'won' | 'lost'
  current:   '',
  hintsUsed: 0,
};

/** Lifetime statistics — all start at 0 */
let stats = {
  totalGames:   0,
  totalWins:    0,
  streak:       0,
  maxStreak:    0,
  lastWonDate:  null,
  distribution: Array(MAX_GUESSES + 1).fill(0),  // index 1–8
};

/** Per-date history: { "2026-06-22": "won", "2026-06-23": "lost" } */
let history = {};

/** Achievements — keyed by id */
let achievements = {};

/** User preferences */
let prefs = {
  theme:      'default',
  difficulty: 'normal',
  muted:      false,
};

/** Practice mode stats (separate from daily) */
let practiceStats = {
  played: 0,
  wins:   0,
};

/* ═══════════════════════════════════════════════════════════════
   ACHIEVEMENTS DEFINITIONS
═══════════════════════════════════════════════════════════════ */
const ACHIEVEMENT_DEFS = [
  { id: 'first_win',     icon: '🎯', name: 'First Victory',       desc: 'Win your first daily puzzle.' },
  { id: 'streak_3',      icon: '🔥', name: 'On Fire',             desc: 'Win 3 days in a row.' },
  { id: 'streak_7',      icon: '📅', name: '7-Day Streak',        desc: 'Win 7 days in a row.' },
  { id: 'streak_30',     icon: '🏅', name: '30-Day Streak',       desc: 'Win 30 days in a row.' },
  { id: 'ace',           icon: '⚡', name: 'Ace',                 desc: 'Guess the number on the first try.' },
  { id: 'clutch',        icon: '😅', name: 'Clutch',              desc: 'Win with only 1 attempt remaining.' },
  { id: 'played_10',     icon: '📊', name: '10 Games Played',     desc: 'Play 10 daily puzzles.' },
  { id: 'played_100',    icon: '💯', name: '100 Games Played',    desc: 'Play 100 daily puzzles.' },
  { id: 'wins_10',       icon: '🏆', name: '10 Wins',             desc: 'Win 10 daily puzzles.' },
  { id: 'perfect_week',  icon: '🌟', name: 'Perfect Week',        desc: 'Win every day for 7 consecutive days.' },
];

/* ═══════════════════════════════════════════════════════════════
   PERSISTENCE
═══════════════════════════════════════════════════════════════ */
function saveState()    { try { localStorage.setItem(LS_STATE,   JSON.stringify(state));        } catch {} }
function saveStats()    { try { localStorage.setItem(LS_STATS,   JSON.stringify(stats));        } catch {} }
function saveHistory()  { try { localStorage.setItem(LS_HISTORY, JSON.stringify(history));      } catch {} }
function saveAchieve()  { try { localStorage.setItem(LS_ACHIEVE, JSON.stringify(achievements)); } catch {} }
function savePrefs()    { try { localStorage.setItem(LS_PREFS,   JSON.stringify(prefs));        } catch {} }
function savePStats()   { try { localStorage.setItem(LS_PSTATS,  JSON.stringify(practiceStats));} catch {} }

function loadState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.date === TODAY) state = { ...state, ...s };
  } catch {}
}

function loadStats() {
  try {
    const raw = localStorage.getItem(LS_STATS);
    if (!raw) return;
    const s = JSON.parse(raw);
    stats = { ...stats, ...s };
    if (!Array.isArray(stats.distribution) || stats.distribution.length < MAX_GUESSES + 1) {
      stats.distribution = Array(MAX_GUESSES + 1).fill(0);
    }
  } catch {}
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    if (raw) history = JSON.parse(raw);
  } catch {}
}

function loadAchieve() {
  try {
    const raw = localStorage.getItem(LS_ACHIEVE);
    if (raw) achievements = JSON.parse(raw);
  } catch {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (raw) prefs = { ...prefs, ...JSON.parse(raw) };
  } catch {}
}

function loadPStats() {
  try {
    const raw = localStorage.getItem(LS_PSTATS);
    if (raw) practiceStats = { ...practiceStats, ...JSON.parse(raw) };
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════
   SOUND ENGINE (Web Audio API — no files needed)
═══════════════════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  return audioCtx;
}

/**
 * Play a simple synthesized tone.
 * @param {number} freq   Hz
 * @param {number} dur    seconds
 * @param {'sine'|'square'|'sawtooth'|'triangle'} type
 * @param {number} gain   0–1
 */
function playTone(freq, dur, type = 'sine', gain = 0.18) {
  if (prefs.muted) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env);
    env.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch {}
}

const SFX = {
  keyPress:   () => playTone(880, 0.06, 'sine',     0.10),
  submit:     () => playTone(440, 0.12, 'sine',     0.14),
  invalid:    () => playTone(180, 0.22, 'sawtooth', 0.16),
  tileGreen:  () => playTone(660, 0.10, 'sine',     0.14),
  tileYellow: () => playTone(520, 0.10, 'sine',     0.12),
  tileGray:   () => playTone(260, 0.10, 'sine',     0.10),
  win:        () => { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f,0.22,'sine',0.18), i*90)); },
  lose:       () => { [400,300,220].forEach((f,i) => setTimeout(() => playTone(f,0.3,'sawtooth',0.15), i*100)); },
  hint:       () => playTone(740, 0.14, 'triangle', 0.14),
  achieve:    () => { [660,784,1047].forEach((f,i) => setTimeout(() => playTone(f,0.18,'sine',0.18), i*70)); },
};

/* ═══════════════════════════════════════════════════════════════
   DOM REFS
═══════════════════════════════════════════════════════════════ */
const boardEl        = document.getElementById('board');
const progressFill   = document.getElementById('progressFill');
const dateDisplayEl  = document.getElementById('dateDisplay');
const attemptsLeft   = document.getElementById('attemptsLeft');
const puzzleNumEl    = document.getElementById('puzzleNum');
const toastEl        = document.getElementById('toast');
const confettiCanvas = document.getElementById('confettiCanvas');
const bgCanvas       = document.getElementById('bgCanvas');
const difficultyPill = document.getElementById('difficultyPill');
const hintBar        = document.getElementById('hintBar');
const hintUsedLabel  = document.getElementById('hintUsedLabel');
const hint1Btn       = document.getElementById('hint1Btn');
const hint2Btn       = document.getElementById('hint2Btn');

// Game Over Modal
const gameOverModal = document.getElementById('gameOverModal');
const goOrb         = document.getElementById('goOrb');
const goEmoji       = document.getElementById('goEmoji');
const goStatus      = document.getElementById('goStatus');
const goSub         = document.getElementById('goSub');
const answerReveal  = document.getElementById('answerReveal');
const answerDigits  = document.getElementById('answerDigits');
const distBarsEl    = document.getElementById('distBars');
const statPlayed    = document.getElementById('statPlayed');
const statWinPct    = document.getElementById('statWinPct');
const statStreak    = document.getElementById('statStreak');
const statBest      = document.getElementById('statBest');
const cdH           = document.getElementById('cdH');
const cdM           = document.getElementById('cdM');
const cdS           = document.getElementById('cdS');
const shareBtn      = document.getElementById('shareBtn');
const practiceBtn   = document.getElementById('practiceBtn');

// Stats Modal
const statsModal    = document.getElementById('statsModal');
const closeStatsBtn = document.getElementById('closeStatsBtn');
const st2Played     = document.getElementById('st2Played');
const st2WinPct     = document.getElementById('st2WinPct');
const st2Streak     = document.getElementById('st2Streak');
const st2Best       = document.getElementById('st2Best');
const distBars2     = document.getElementById('distBars2');

// Practice Modal
const practiceModal   = document.getElementById('practiceModal');
const closePracticeBtn = document.getElementById('closePracticeBtn');
const practiceStatusEl = document.getElementById('practiceStatus');
const practiceRoundEl  = document.getElementById('practiceRound');
const practiceBoardEl  = document.getElementById('practiceBoard');
const practiceKeyboard = document.getElementById('practiceKeyboard');
const practiceResultEl = document.getElementById('practiceResult');
const practiceResultTxt = document.getElementById('practiceResultText');
const nextRoundBtn     = document.getElementById('nextRoundBtn');
const pWinsEl          = document.getElementById('pWins');
const pPlayedEl        = document.getElementById('pPlayed');

// Achievements Modal
const achievementsModal    = document.getElementById('achievementsModal');
const closeAchievementsBtn = document.getElementById('closeAchievementsBtn');
const achievementsGrid     = document.getElementById('achievementsGrid');

// Calendar Modal
const calendarModal   = document.getElementById('calendarModal');
const closeCalendarBtn = document.getElementById('closeCalendarBtn');
const calPrevBtn      = document.getElementById('calPrevBtn');
const calNextBtn      = document.getElementById('calNextBtn');
const calMonthLabel   = document.getElementById('calMonthLabel');
const calendarGrid    = document.getElementById('calendarGrid');

// Theme Modal
const themeModal    = document.getElementById('themeModal');
const closeThemeBtn = document.getElementById('closeThemeBtn');

// Info Modal
const infoModal     = document.getElementById('infoModal');
const closeInfoBtn  = document.getElementById('closeInfoBtn');
const closeInfoPlay = document.getElementById('closeInfoPlay');

// Header buttons
const statsBtn       = document.getElementById('statsBtn');
const infoBtn        = document.getElementById('infoBtn');
const themeBtn       = document.getElementById('themeBtn');
const calendarBtn    = document.getElementById('calendarBtn');
const achievementsBtn = document.getElementById('achievementsBtn');
const muteBtn        = document.getElementById('muteBtn');

// Achievement toast
const achievementToast = document.getElementById('achievementToast');
const achToastIcon     = document.getElementById('achToastIcon');
const achToastName     = document.getElementById('achToastName');

/* ═══════════════════════════════════════════════════════════════
   BOARD — build & render (daily)
═══════════════════════════════════════════════════════════════ */
/** @type {HTMLElement[]}   */  const rowEls  = [];
/** @type {HTMLElement[][]} */  const tileEls = [];

/** Build the 8×4 daily guess grid. */
function buildBoard() {
  boardEl.innerHTML = '';
  rowEls.length = tileEls.length = 0;

  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement('div');
    row.classList.add('guess-row');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-label', `Guess ${r+1}`);
    row.dataset.row = r;

    const lbl = document.createElement('div');
    lbl.classList.add('row-label');
    lbl.textContent = r + 1;

    const tilesGroup = document.createElement('div');
    tilesGroup.classList.add('tiles-group');

    const rowTiles = [];
    for (let c = 0; c < DIGITS; c++) {
      const tile = document.createElement('div');
      tile.classList.add('tile');
      tile.setAttribute('role', 'gridcell');
      tile.dataset.row = r; tile.dataset.col = c;
      tilesGroup.appendChild(tile);
      rowTiles.push(tile);
    }
    tileEls.push(rowTiles);

    row.appendChild(lbl);
    row.appendChild(tilesGroup);
    boardEl.appendChild(row);
    rowEls.push(row);
  }
}

/**
 * Sync DOM to current state (non-animating; used on load restore).
 */
function renderBoard() {
  const currentRow = state.guesses.length;

  for (let r = 0; r < MAX_GUESSES; r++) {
    const row   = rowEls[r];
    const tiles = tileEls[r];
    row.classList.remove('row-active', 'row-submitted', 'row-reveal-done');

    if (r < currentRow) {
      row.classList.add('row-submitted', 'row-reveal-done');
      const fb = state.feedbacks[r];
      for (let c = 0; c < DIGITS; c++) {
        tiles[c].textContent = state.guesses[r][c];
        tiles[c].classList.remove('tile-filled');
        setTileColor(tiles[c], fb[c]);
      }
    } else if (r === currentRow && state.status === 'playing') {
      row.classList.add('row-active');
      for (let c = 0; c < DIGITS; c++) {
        const ch = state.current[c] ?? '';
        tiles[c].textContent = ch;
        tiles[c].classList.remove('tile-green','tile-yellow','tile-gray');
        ch ? tiles[c].classList.add('tile-filled')
           : tiles[c].classList.remove('tile-filled');
      }
    } else {
      for (let c = 0; c < DIGITS; c++) {
        tiles[c].textContent = '';
        tiles[c].classList.remove('tile-filled','tile-green','tile-yellow','tile-gray');
      }
    }
  }

  renderKeyboardStates();
  updateProgressBar();
  updateAttemptsLabel();
}

/** Apply a color class to a tile element. */
function setTileColor(tileEl, color) {
  tileEl.classList.remove('tile-green','tile-yellow','tile-gray');
  tileEl.classList.add(`tile-${color}`);
}

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD STATE TRACKING
═══════════════════════════════════════════════════════════════ */
/** Map digit → best known state */
const keyStates = {};   // '0'-'9' → 'green' | 'yellow' | 'gray' | undefined

const STATE_RANK = { green: 3, yellow: 2, gray: 1 };

function updateKeyStates(guess, feedback) {
  for (let i = 0; i < DIGITS; i++) {
    const d = guess[i];
    const f = feedback[i];
    const cur = keyStates[d];
    if (!cur || STATE_RANK[f] > STATE_RANK[cur]) {
      keyStates[d] = f;
    }
  }
}

function renderKeyboardStates() {
  document.querySelectorAll('#keyboard .key[data-key]').forEach(btn => {
    const k = btn.dataset.key;
    if (!/^\d$/.test(k)) return;
    btn.classList.remove('key-state-green','key-state-yellow','key-state-gray');
    if (keyStates[k]) btn.classList.add(`key-state-${keyStates[k]}`);
  });
}

/** Rebuild keyStates from existing guesses (used on page restore). */
function rebuildKeyStates() {
  Object.keys(keyStates).forEach(k => delete keyStates[k]);
  state.guesses.forEach((g, i) => updateKeyStates(g, state.feedbacks[i]));
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS BAR & ATTEMPTS LABEL
═══════════════════════════════════════════════════════════════ */
function updateProgressBar() {
  progressFill.style.width = `${(state.guesses.length / MAX_GUESSES) * 100}%`;
}

function updateAttemptsLabel() {
  const rem = MAX_GUESSES - state.guesses.length;
  if (state.status === 'won')  { attemptsLeft.textContent = '✅ Solved!'; attemptsLeft.className = ''; return; }
  if (state.status === 'lost') { attemptsLeft.textContent = '❌ No attempts left'; attemptsLeft.className = ''; return; }
  attemptsLeft.textContent = `${rem} attempt${rem !== 1 ? 's' : ''} remaining`;
  attemptsLeft.className = rem <= 1 ? 'urgent' : rem <= 2 ? 'last' : '';
}

/* ═══════════════════════════════════════════════════════════════
   INPUT — digit, backspace, enter
═══════════════════════════════════════════════════════════════ */
let inputLocked = false;   // true while tile flip animation plays

function handleDigit(d) {
  if (inputLocked || state.status !== 'playing') return;
  if (state.current.length >= DIGITS) { shakeActiveRow(); return; }

  // Hard mode: if a green digit is confirmed, it must appear in same position
  if (prefs.difficulty === 'hard' && state.guesses.length > 0) {
    const pos = state.current.length;
    const required = getHardModeRequired();
    if (required[pos] && required[pos] !== d) {
      showToast(`Position ${pos+1} must be ${required[pos]}`, 'error', 2000);
      shakeActiveRow();
      return;
    }
  }

  SFX.keyPress();
  state.current += d;
  renderBoard();
}

/**
 * For Hard mode: returns a map of position → required digit (if green-confirmed).
 * @returns {Object.<number,string>}
 */
function getHardModeRequired() {
  const req = {};
  state.feedbacks.forEach((fb, gi) => {
    fb.forEach((color, pos) => {
      if (color === 'green') req[pos] = state.guesses[gi][pos];
    });
  });
  return req;
}

function handleBackspace() {
  if (inputLocked || state.status !== 'playing') return;
  if (state.current.length === 0) return;
  state.current = state.current.slice(0, -1);
  renderBoard();
}

function handleEnter() {
  if (inputLocked || state.status !== 'playing') return;
  if (state.current.length < DIGITS) {
    showToast('Enter all 4 digits!', 'error');
    shakeActiveRow();
    SFX.invalid();
    return;
  }
  SFX.submit();
  submitGuess();
}

/* ═══════════════════════════════════════════════════════════════
   SUBMIT & ANIMATED REVEAL
═══════════════════════════════════════════════════════════════ */
function submitGuess() {
  const guess  = state.current;
  const fb     = calcTileFeedback(guess, TARGET);
  const rowIdx = state.guesses.length;

  state.guesses.push(guess);
  state.feedbacks.push(fb);
  state.current = '';
  saveState();

  const won  = fb.every(c => c === 'green');
  const lost = !won && state.guesses.length >= MAX_GUESSES;

  // Nightmare: reveal only on game end
  const revealColors = prefs.difficulty !== 'nightmare' || won || lost;

  inputLocked = true;
  animateRowReveal(rowIdx, fb, revealColors, () => {
    // After all tiles revealed:
    updateKeyStates(guess, fb);
    renderKeyboardStates();
    updateProgressBar();
    updateAttemptsLabel();
    rowEls[rowIdx].classList.add('row-reveal-done');
    inputLocked = false;

    if (won) {
      state.status = 'won';
      saveState();
      updateStats(true, rowIdx + 1);
      recordHistory(TODAY, 'won');
      checkAchievements(rowIdx + 1);
      scheduleWinSequence(rowIdx + 1);
    } else if (lost) {
      state.status = 'lost';
      saveState();
      updateStats(false, null);
      recordHistory(TODAY, 'lost');
      checkAchievements(null);
      SFX.lose();
      setTimeout(() => openGameOverModal(false), 700);
    } else {
      // Proximity hints
      const greens = fb.filter(c => c === 'green').length;
      if (greens === 3) showToast('🔥 One digit off!', 'success', 2000);
    }
  });
}

/**
 * Animate tile flips one-by-one, revealing colors sequentially.
 * @param {number} rowIdx
 * @param {('green'|'yellow'|'gray')[]} fb
 * @param {boolean} revealColors
 * @param {Function} onComplete
 */
function animateRowReveal(rowIdx, fb, revealColors, onComplete) {
  const tiles = tileEls[rowIdx];
  const guess = state.guesses[rowIdx];

  rowEls[rowIdx].classList.add('row-submitted');

  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add('tile-flipping');
      tile.textContent = guess[i];

      // At the midpoint of the flip, swap to colour
      setTimeout(() => {
        tile.classList.remove('tile-filled');
        if (revealColors) {
          setTileColor(tile, fb[i]);
          const sfxMap = { green: SFX.tileGreen, yellow: SFX.tileYellow, gray: SFX.tileGray };
          sfxMap[fb[i]]?.();
        } else {
          // Nightmare: keep dark
          tile.classList.add('tile-gray');
        }
      }, FLIP_DURATION / 2);

      tile.addEventListener('animationend', () => {
        tile.classList.remove('tile-flipping');
      }, { once: true });

      // After last tile
      if (i === DIGITS - 1) {
        setTimeout(onComplete, FLIP_DURATION);
      }
    }, i * FLIP_DELAY_PER_TILE);
  });
}

function shakeActiveRow() {
  const row = rowEls[state.guesses.length];
  if (!row) return;
  row.classList.add('row-shake');
  row.addEventListener('animationend', () => row.classList.remove('row-shake'), { once: true });
}

/* ═══════════════════════════════════════════════════════════════
   WIN SEQUENCE
═══════════════════════════════════════════════════════════════ */
function scheduleWinSequence(attempts) {
  const msgs = [null,'🎯 First try — PERFECT!!','🔥 INCREDIBLE — 2 tries!','⚡ Outstanding!','🌟 Excellent!','👏 Well done!','✅ Good solve!','😅 Close one!','😌 Phew!'];
  const msg  = msgs[Math.min(attempts, msgs.length - 1)] || '✅ Solved!';
  setTimeout(() => showToast(msg, 'success', 2200), 200);
  setTimeout(() => { SFX.win(); launchConfetti(); }, 400);
  setTimeout(() => openGameOverModal(true, attempts), 1600);
}

/* ═══════════════════════════════════════════════════════════════
   STATS UPDATE
═══════════════════════════════════════════════════════════════ */
function updateStats(won, attempts) {
  stats.totalGames++;
  if (won) {
    stats.totalWins++;
    // Streak: must be consecutive days
    if (stats.lastWonDate) {
      const prev = new Date(stats.lastWonDate + 'T00:00:00Z');
      const today = new Date(TODAY + 'T00:00:00Z');
      const diffDays = Math.round((today - prev) / 86_400_000);
      stats.streak = diffDays === 1 ? stats.streak + 1 : 1;
    } else {
      stats.streak = 1;
    }
    stats.lastWonDate = TODAY;
    if (stats.streak > stats.maxStreak) stats.maxStreak = stats.streak;
    if (attempts >= 1 && attempts <= MAX_GUESSES) stats.distribution[attempts]++;
  } else {
    stats.streak = 0;
  }
  saveStats();
}

/** Record to history object. */
function recordHistory(dateStr, result) {
  history[dateStr] = result;
  saveHistory();
}

/* ═══════════════════════════════════════════════════════════════
   HINTS (Easy mode only, 2 per game)
═══════════════════════════════════════════════════════════════ */
const MAX_HINTS = 2;

function updateHintBar() {
  if (prefs.difficulty !== 'easy') {
    hintBar.classList.remove('hint-bar-visible');
    return;
  }
  hintBar.classList.add('hint-bar-visible');
  const remaining = MAX_HINTS - state.hintsUsed;
  hintUsedLabel.textContent = `${remaining} remaining`;
  hint1Btn.disabled = state.hintsUsed >= 1 || state.status !== 'playing';
  hint2Btn.disabled = state.hintsUsed >= 2 || state.status !== 'playing';
}

function useHint1() {
  if (state.hintsUsed >= 1 || prefs.difficulty !== 'easy') return;
  state.hintsUsed++;
  saveState();
  const num = parseInt(TARGET, 10);
  const parity = num % 2 === 0 ? 'Even' : 'Odd';
  showToast(`💡 The number is ${parity}`, 'success', 3000);
  SFX.hint();
  updateHintBar();
}

function useHint2() {
  if (state.hintsUsed >= 2 || prefs.difficulty !== 'easy') return;
  state.hintsUsed = Math.max(state.hintsUsed, 1);   // ensure hint 1 counted
  state.hintsUsed++;
  saveState();
  const sum = TARGET.split('').reduce((a, d) => a + parseInt(d), 0);
  showToast(`💡 Digit sum = ${sum}`, 'success', 3000);
  SFX.hint();
  updateHintBar();
}

/* ═══════════════════════════════════════════════════════════════
   ACHIEVEMENTS
═══════════════════════════════════════════════════════════════ */
let achToastQueue = [];
let achToastActive = false;

/**
 * Check and unlock achievements after each game outcome.
 * @param {number|null} attempts  null = loss
 */
function checkAchievements(attempts) {
  const unlock = (id) => {
    if (achievements[id]) return;
    achievements[id] = { id, unlockedAt: TODAY };
    saveAchieve();
    queueAchievementToast(id);
  };

  if (attempts !== null) {
    // Won
    unlock('first_win');
    if (attempts === 1)          unlock('ace');
    if (attempts === MAX_GUESSES) unlock('clutch');
    if (stats.streak >= 3)       unlock('streak_3');
    if (stats.streak >= 7)       unlock('streak_7');
    if (stats.streak >= 30)      unlock('streak_30');
    if (stats.streak >= 7)       unlock('perfect_week');
    if (stats.totalWins >= 10)   unlock('wins_10');
  }
  if (stats.totalGames >= 10)  unlock('played_10');
  if (stats.totalGames >= 100) unlock('played_100');
}

function queueAchievementToast(id) {
  const def = ACHIEVEMENT_DEFS.find(d => d.id === id);
  if (!def) return;
  achToastQueue.push(def);
  if (!achToastActive) flushAchievementToast();
}

function flushAchievementToast() {
  if (achToastQueue.length === 0) { achToastActive = false; return; }
  achToastActive = true;
  const def = achToastQueue.shift();
  achToastIcon.textContent = def.icon;
  achToastName.textContent = def.name;
  achievementToast.classList.add('ach-show');
  SFX.achieve();
  setTimeout(() => {
    achievementToast.classList.remove('ach-show');
    setTimeout(flushAchievementToast, 400);
  }, 3000);
}

function renderAchievementsModal() {
  achievementsGrid.innerHTML = '';
  ACHIEVEMENT_DEFS.forEach(def => {
    const unlocked = !!achievements[def.id];
    const card = document.createElement('div');
    card.classList.add('achievement-card', unlocked ? 'ach-unlocked' : 'ach-locked');
    card.innerHTML = `
      <div class="ach-icon">${def.icon}</div>
      <div class="ach-name">${def.name}</div>
      <div class="ach-desc">${def.desc}</div>
      <div class="ach-badge">${unlocked ? '✓ Unlocked' : 'Locked'}</div>`;
    achievementsGrid.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════════
   GAME OVER MODAL
═══════════════════════════════════════════════════════════════ */
function openGameOverModal(won, attempts) {
  goOrb.className = `modal-orb ${won ? 'orb-win' : 'orb-lose'}`;

  if (won) {
    goEmoji.textContent  = attempts <= 2 ? '🏆' : attempts <= 4 ? '🎯' : '✅';
    goStatus.textContent = attempts === 1 ? 'PERFECT!' : 'SOLVED!';
    goStatus.className   = 'go-status status-win';
    goSub.textContent    = `Cracked in ${attempts} attempt${attempts !== 1 ? 's' : ''}`;
    answerReveal.style.display = 'none';
  } else {
    goEmoji.textContent  = '😔';
    goStatus.textContent = 'GAME OVER';
    goStatus.className   = 'go-status status-lose';
    goSub.textContent    = 'Better luck tomorrow — the answer was:';
    answerReveal.style.display = 'block';
    answerDigits.innerHTML = TARGET.split('').map(d => `<div class="ans-digit">${d}</div>`).join('');
  }

  populateStatsUI(statPlayed, statWinPct, statStreak, statBest, distBarsEl, won ? attempts : null);
  openModal(gameOverModal);
  startCountdown();
}

/* ═══════════════════════════════════════════════════════════════
   STATS MODAL
═══════════════════════════════════════════════════════════════ */
function openStatsModal() {
  populateStatsUI(st2Played, st2WinPct, st2Streak, st2Best, distBars2, null);
  renderDifficultySelector();
  openModal(statsModal);
}

function populateStatsUI(playedEl, winPctEl, streakEl, bestEl, barsEl, highlightRow) {
  playedEl.textContent = stats.totalGames;
  winPctEl.textContent = stats.totalGames > 0
    ? Math.round((stats.totalWins / stats.totalGames) * 100) + '%' : '0%';
  streakEl.textContent = stats.streak;
  bestEl.textContent   = stats.maxStreak;

  const maxVal = Math.max(...stats.distribution.slice(1), 1);
  barsEl.innerHTML = '';
  for (let i = 1; i <= MAX_GUESSES; i++) {
    const count = stats.distribution[i] || 0;
    const pct   = Math.max(4, Math.round((count / maxVal) * 100));
    const isHL  = i === highlightRow;
    const row   = document.createElement('div');
    row.classList.add('dist-bar-row');
    row.innerHTML = `
      <div class="dist-bar-label">${i}</div>
      <div class="dist-bar-track">
        <div class="dist-bar-fill ${isHL ? 'dist-active' : ''}"
             style="width:0%;transition-delay:${(i-1)*60}ms">${count}</div>
      </div>`;
    barsEl.appendChild(row);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.querySelector('.dist-bar-fill').style.width = `${pct}%`;
    }));
  }
}

/* ═══════════════════════════════════════════════════════════════
   DIFFICULTY
═══════════════════════════════════════════════════════════════ */
const DIFF_DESCS = {
  easy:      'Tile colours shown + 2 hints available per game.',
  normal:    'Standard rules. Tile colours shown. No hints.',
  hard:      'Confirmed green digits must be reused in same position.',
  nightmare: 'No tile colours revealed until the game ends.',
};

function setDifficulty(diff) {
  prefs.difficulty = diff;
  savePrefs();
  document.body.dataset.difficulty = diff;
  difficultyPill.textContent = diff.toUpperCase();
  updateHintBar();
  renderDifficultySelector();
}

function renderDifficultySelector() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('diff-active', btn.dataset.diff === prefs.difficulty);
  });
  const desc = document.getElementById('diffDesc');
  if (desc) desc.textContent = DIFF_DESCS[prefs.difficulty] || '';
}

/* ═══════════════════════════════════════════════════════════════
   THEMES
═══════════════════════════════════════════════════════════════ */
function setTheme(theme) {
  prefs.theme = theme;
  savePrefs();
  document.body.dataset.theme = theme;
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('theme-selected', c.dataset.theme === theme);
  });
}

/* ═══════════════════════════════════════════════════════════════
   CALENDAR / HISTORY
═══════════════════════════════════════════════════════════════ */
let calViewYear, calViewMonth;

function openCalendarModal() {
  const now = new Date();
  calViewYear  = now.getUTCFullYear();
  calViewMonth = now.getUTCMonth();
  renderCalendar();
  openModal(calendarModal);
}

function renderCalendar() {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  calMonthLabel.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

  // Disable prev if we'd go before June 2026
  const minYear = 2026, minMonth = 5;   // June 2026
  calPrevBtn.disabled = (calViewYear === minYear && calViewMonth <= minMonth);

  // Disable next if future
  const now = new Date();
  calNextBtn.disabled = (calViewYear === now.getUTCFullYear() && calViewMonth >= now.getUTCMonth());

  calendarGrid.innerHTML = '';

  // Day headers
  ['S','M','T','W','T','F','S'].forEach(d => {
    const h = document.createElement('div');
    h.classList.add('cal-day-header');
    h.textContent = d;
    calendarGrid.appendChild(h);
  });

  // First day of month (UTC)
  const firstDay = new Date(Date.UTC(calViewYear, calViewMonth, 1)).getUTCDay();
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.classList.add('cal-day','cal-empty');
    calendarGrid.appendChild(empty);
  }

  const daysInMonth = new Date(Date.UTC(calViewYear, calViewMonth + 1, 0)).getUTCDate();
  const todayUTC = new Date().toISOString().slice(0,10);
  const epochStr = '2026-06-22';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calViewYear}-${String(calViewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const day = document.createElement('div');
    day.classList.add('cal-day');
    day.textContent = d;

    if (dateStr === todayUTC) day.classList.add('cal-today');

    if (dateStr < epochStr) {
      // Before the game launched — blank
      day.classList.add('cal-empty');
      day.textContent = '';
    } else if (dateStr > todayUTC) {
      day.classList.add('cal-future');
    } else if (history[dateStr] === 'won') {
      day.classList.add('cal-won');
    } else if (history[dateStr] === 'lost') {
      day.classList.add('cal-lost');
    } else {
      day.classList.add('cal-unplayed');
    }

    calendarGrid.appendChild(day);
  }
}

/* ═══════════════════════════════════════════════════════════════
   MODAL HELPERS
═══════════════════════════════════════════════════════════════ */
function openModal(el)  { el.classList.add('overlay-open');    document.body.style.overflow = 'hidden'; }
function closeModal(el) { el.classList.remove('overlay-open'); document.body.style.overflow = ''; }

/* ═══════════════════════════════════════════════════════════════
   COUNTDOWN
═══════════════════════════════════════════════════════════════ */
let countdownInterval = null;

function startCountdown() {
  function tick() {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const diff = midnight - now;
    cdH.textContent = String(Math.floor(diff / 3_600_000)).padStart(2,'0');
    cdM.textContent = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2,'0');
    cdS.textContent = String(Math.floor((diff % 60_000) / 1_000)).padStart(2,'0');
  }
  tick();
  clearInterval(countdownInterval);
  countdownInterval = setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════════════════════════
   SHARE — emoji grid per tile (true Wordle-style)
═══════════════════════════════════════════════════════════════ */
const EMOJI = { green: '🟩', yellow: '🟨', gray: '⬛' };

function buildShareText() {
  const won      = state.status === 'won';
  const attempts = won ? `${state.guesses.length}/${MAX_GUESSES}` : 'X/8';
  const pNum     = getPuzzleNumber();

  const rows = state.feedbacks.map(fb => fb.map(c => EMOJI[c]).join(''));

  const lines = [
    `NUMBLE #${pNum}  ${attempts}`,
    prefs.difficulty !== 'normal' ? `[${prefs.difficulty.toUpperCase()} MODE]` : '',
    '',
    rows.join('\n'),
  ];
  if (stats.streak > 1) lines.push(`\n🔥 Streak: ${stats.streak}`);
  lines.push('\nnumble.game');

  return lines.filter(l => l !== null).join('\n');
}

async function handleShare() {
  const text = buildShareText();
  try {
    if (navigator.share) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(text);
      showToast('📋 Result copied!', 'success');
    }
  } catch {
    showToast('Could not copy result.', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════════ */
let toastTimer = null;

function showToast(msg, type = '', duration = 1700) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className   = `toast toast-show${type ? ' toast-'+type : ''}`;
  toastTimer = setTimeout(() => toastEl.classList.remove('toast-show','toast-error','toast-success'), duration);
}

/* ═══════════════════════════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════════════════════════════ */
let confettiParticles = [], confettiRAF = null;
const CONF_COLORS = ['#6366f1','#818cf8','#22d46e','#f59e0b','#f472b6','#38bdf8','#a78bfa','#34d399'];

function launchConfetti() {
  const ctx = confettiCanvas.getContext('2d');
  const W   = confettiCanvas.width  = window.innerWidth;
  const H   = confettiCanvas.height = window.innerHeight;
  confettiParticles = Array.from({length: 120}, () => ({
    x: Math.random()*W, y: Math.random()*H*0.4 - H*0.1,
    w: Math.random()*8+4, h: Math.random()*5+3,
    rot: Math.random()*360, vx: (Math.random()-0.5)*6,
    vy: Math.random()*4+2,  vr: (Math.random()-0.5)*8,
    col: CONF_COLORS[Math.floor(Math.random()*CONF_COLORS.length)],
    life: 1, decay: Math.random()*0.008+0.006,
  }));
  confettiCanvas.classList.add('active');
  cancelAnimationFrame(confettiRAF);
  (function draw() {
    ctx.clearRect(0,0,W,H);
    let alive = false;
    confettiParticles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.99; p.rot += p.vr; p.life -= p.decay;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.globalAlpha = Math.max(0,p.life); ctx.fillStyle = p.col;
      ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    });
    if (alive) confettiRAF = requestAnimationFrame(draw);
    else { confettiCanvas.classList.remove('active'); ctx.clearRect(0,0,W,H); }
  })();
}

/* ═══════════════════════════════════════════════════════════════
   BACKGROUND PARTICLES
═══════════════════════════════════════════════════════════════ */
(function initBgCanvas() {
  const ctx = bgCanvas.getContext('2d');
  let dots = [], W, H;
  function resize() { W = bgCanvas.width = window.innerWidth; H = bgCanvas.height = window.innerHeight; }
  function spawnDots() {
    dots = Array.from({length: 80}, () => ({
      x: Math.random()*W, y: Math.random()*H,
      r: Math.random()*1.4+0.3,
      vx: (Math.random()-0.5)*0.18, vy: (Math.random()-0.5)*0.18,
      a: Math.random()*0.5+0.15,
    }));
  }
  function draw() {
    ctx.clearRect(0,0,W,H);
    // Read CSS variable for theming
    const rgb = getComputedStyle(document.body).getPropertyValue('--particle-rgb').trim() || '99,102,241';
    dots.forEach(d => {
      d.x = (d.x+d.vx+W)%W; d.y = (d.y+d.vy+H)%H;
      ctx.beginPath(); ctx.arc(d.x,d.y,d.r,0,Math.PI*2);
      ctx.fillStyle = `rgba(${rgb},${d.a})`; ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  resize(); spawnDots(); draw();
  window.addEventListener('resize', () => { resize(); });
})();

/* ═══════════════════════════════════════════════════════════════
   PRACTICE MODE
═══════════════════════════════════════════════════════════════ */
let practiceState = null;
let practiceTiles = [];
let practiceRowEls = [];
let practiceKeyMap = {};   // digit → best state
let practiceLocked = false;

function startPracticeRound() {
  // Generate random unique-digit number
  let target;
  do { target = generateUniqueDigitNumber(Math.random().toString()); } while (!hasUniqueDigits(target));
  
  practiceState = {
    target,
    guesses:   [],
    feedbacks: [],
    current:   '',
    status:    'playing',
  };
  practiceKeyMap = {};
  practiceLocked = false;

  buildPracticeBoard();
  renderPracticeBoard();
  practiceResultEl.style.display = 'none';
  updatePracticeKeyboard();

  practiceRoundEl.textContent = practiceStats.played + 1;
  pWinsEl.textContent   = practiceStats.wins;
  pPlayedEl.textContent = practiceStats.played;
}

function buildPracticeBoard() {
  practiceBoardEl.innerHTML = '';
  practiceRowEls = [];
  practiceTiles  = [];
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement('div');
    row.classList.add('guess-row');
    const tg = document.createElement('div');
    tg.classList.add('tiles-group');
    const rowT = [];
    for (let c = 0; c < DIGITS; c++) {
      const t = document.createElement('div');
      t.classList.add('tile');
      tg.appendChild(t); rowT.push(t);
    }
    practiceTiles.push(rowT);
    row.appendChild(tg);
    practiceBoardEl.appendChild(row);
    practiceRowEls.push(row);
  }
}

function renderPracticeBoard() {
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row   = practiceRowEls[r];
    const tiles = practiceTiles[r];
    row.classList.remove('row-active','row-submitted');
    const curRow = practiceState.guesses.length;
    if (r < curRow) {
      row.classList.add('row-submitted');
      for (let c = 0; c < DIGITS; c++) {
        tiles[c].textContent = practiceState.guesses[r][c];
        setTileColor(tiles[c], practiceState.feedbacks[r][c]);
        tiles[c].classList.remove('tile-filled');
      }
    } else if (r === curRow && practiceState.status === 'playing') {
      row.classList.add('row-active');
      for (let c = 0; c < DIGITS; c++) {
        const ch = practiceState.current[c] ?? '';
        tiles[c].textContent = ch;
        tiles[c].classList.remove('tile-green','tile-yellow','tile-gray');
        ch ? tiles[c].classList.add('tile-filled') : tiles[c].classList.remove('tile-filled');
      }
    } else {
      for (let c = 0; c < DIGITS; c++) {
        tiles[c].textContent = '';
        tiles[c].classList.remove('tile-filled','tile-green','tile-yellow','tile-gray');
      }
    }
  }
}

function updatePracticeKeyboard() {
  document.querySelectorAll('#practiceKeyboard .key[data-pkey]').forEach(btn => {
    const k = btn.dataset.pkey;
    if (!/^\d$/.test(k)) return;
    btn.classList.remove('key-state-green','key-state-yellow','key-state-gray');
    if (practiceKeyMap[k]) btn.classList.add(`key-state-${practiceKeyMap[k]}`);
  });
}

function handlePracticeInput(k) {
  if (practiceLocked || practiceState.status !== 'playing') return;
  if (/^\d$/.test(k)) {
    if (practiceState.current.length >= DIGITS) return;
    practiceState.current += k;
    renderPracticeBoard();
  } else if (k === 'Backspace') {
    practiceState.current = practiceState.current.slice(0,-1);
    renderPracticeBoard();
  } else if (k === 'Enter') {
    if (practiceState.current.length < DIGITS) return;
    submitPracticeGuess();
  }
}

function submitPracticeGuess() {
  const guess = practiceState.current;
  const fb    = calcTileFeedback(guess, practiceState.target);
  const rowIdx = practiceState.guesses.length;
  practiceState.guesses.push(guess);
  practiceState.feedbacks.push(fb);
  practiceState.current = '';
  practiceLocked = true;

  // Animate
  const tiles = practiceTiles[rowIdx];
  practiceRowEls[rowIdx].classList.add('row-submitted');
  tiles.forEach((tile, i) => {
    setTimeout(() => {
      tile.classList.add('tile-flipping');
      tile.textContent = guess[i];
      setTimeout(() => {
        tile.classList.remove('tile-filled');
        setTileColor(tile, fb[i]);
        // Update key map
        const d = guess[i], f = fb[i];
        if (!practiceKeyMap[d] || STATE_RANK[f] > STATE_RANK[practiceKeyMap[d]]) practiceKeyMap[d] = f;
      }, FLIP_DURATION / 2);
      tile.addEventListener('animationend', () => tile.classList.remove('tile-flipping'), {once:true});
      if (i === DIGITS - 1) setTimeout(() => {
        updatePracticeKeyboard();
        practiceLocked = false;
        const won  = fb.every(c => c === 'green');
        const lost = !won && practiceState.guesses.length >= MAX_GUESSES;
        if (won || lost) endPracticeRound(won);
      }, FLIP_DURATION);
    }, i * FLIP_DELAY_PER_TILE);
  });
}

function endPracticeRound(won) {
  practiceStats.played++;
  if (won) practiceStats.wins++;
  savePStats();
  practiceState.status = won ? 'won' : 'lost';
  practiceResultEl.style.display = 'block';
  practiceResultTxt.innerHTML = won
    ? `✅ <strong>${practiceState.target}</strong> — solved in ${practiceState.guesses.length} guess${practiceState.guesses.length !== 1 ? 'es' : ''}!`
    : `😔 The number was <strong>${practiceState.target}</strong>. Better luck next time!`;
  pWinsEl.textContent   = practiceStats.wins;
  pPlayedEl.textContent = practiceStats.played;
}

/* ═══════════════════════════════════════════════════════════════
   MUTE TOGGLE
═══════════════════════════════════════════════════════════════ */
function setMute(muted) {
  prefs.muted = muted;
  savePrefs();
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.querySelector('.icon-sound-on').style.display  = muted ? 'none' : '';
  muteBtn.querySelector('.icon-sound-off').style.display = muted ? '' : 'none';
}

/* ═══════════════════════════════════════════════════════════════
   HEADER — populate date & puzzle number
═══════════════════════════════════════════════════════════════ */
function populateHeader() {
  puzzleNumEl.textContent = `#${String(getPuzzleNumber()).padStart(3,'0')}`;
  dateDisplayEl.textContent = new Date().toLocaleDateString('en-GB', {
    day:'numeric', month:'short', year:'numeric', timeZone:'UTC',
  });
}

/* ═══════════════════════════════════════════════════════════════
   KEYBOARD — on-screen + physical
═══════════════════════════════════════════════════════════════ */
document.getElementById('keyboard').addEventListener('click', e => {
  const btn = e.target.closest('.key');
  if (!btn) return;
  const k = btn.dataset.key;
  if (/^\d$/.test(k))       handleDigit(k);
  else if (k === 'Backspace') handleBackspace();
  else if (k === 'Enter')     handleEnter();
});

document.getElementById('practiceKeyboard').addEventListener('click', e => {
  const btn = e.target.closest('.key');
  if (!btn) return;
  handlePracticeInput(btn.dataset.pkey);
});

document.addEventListener('keydown', e => {
  if (practiceModal.classList.contains('overlay-open')) {
    if (e.key === 'Escape') { closeModal(practiceModal); return; }
    if (/^\d$/.test(e.key))       handlePracticeInput(e.key);
    else if (e.key === 'Backspace') handlePracticeInput('Backspace');
    else if (e.key === 'Enter')     handlePracticeInput('Enter');
    return;
  }
  if (gameOverModal.classList.contains('overlay-open') ||
      statsModal.classList.contains('overlay-open')    ||
      achievementsModal.classList.contains('overlay-open') ||
      calendarModal.classList.contains('overlay-open') ||
      themeModal.classList.contains('overlay-open')) {
    if (e.key === 'Escape') {
      [statsModal, achievementsModal, calendarModal, themeModal].forEach(m => {
        if (m.classList.contains('overlay-open')) closeModal(m);
      });
    }
    return;
  }
  if (infoModal.classList.contains('overlay-open')) {
    if (e.key === 'Escape') closeModal(infoModal);
    return;
  }
  if (/^\d$/.test(e.key))       handleDigit(e.key);
  else if (e.key === 'Backspace') handleBackspace();
  else if (e.key === 'Enter')     handleEnter();
});

/* ═══════════════════════════════════════════════════════════════
   WIRE MODAL BUTTONS
═══════════════════════════════════════════════════════════════ */
// Header buttons
statsBtn.addEventListener('click', openStatsModal);
infoBtn.addEventListener('click', () => openModal(infoModal));
themeBtn.addEventListener('click', () => { setTheme(prefs.theme); openModal(themeModal); });
calendarBtn.addEventListener('click', openCalendarModal);
achievementsBtn.addEventListener('click', () => { renderAchievementsModal(); openModal(achievementsModal); });
muteBtn.addEventListener('click', () => setMute(!prefs.muted));

// Close buttons
closeStatsBtn.addEventListener('click',       () => closeModal(statsModal));
closeInfoBtn.addEventListener('click',        () => closeModal(infoModal));
closeInfoPlay.addEventListener('click',       () => closeModal(infoModal));
closeAchievementsBtn.addEventListener('click',() => closeModal(achievementsModal));
closeCalendarBtn.addEventListener('click',    () => closeModal(calendarModal));
closeThemeBtn.addEventListener('click',       () => closeModal(themeModal));
closePracticeBtn.addEventListener('click',    () => closeModal(practiceModal));

// Backdrop close
[statsModal, achievementsModal, calendarModal, themeModal, infoModal].forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeModal(m); });
});

// Share & Practice
shareBtn.addEventListener('click', handleShare);
practiceBtn.addEventListener('click', () => {
  closeModal(gameOverModal);
  practiceStats = loadedPStats();
  startPracticeRound();
  openModal(practiceModal);
});

nextRoundBtn.addEventListener('click', () => startPracticeRound());

// Difficulty buttons
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => setDifficulty(btn.dataset.diff));
});

// Theme cards
document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', () => setTheme(card.dataset.theme));
});

// Calendar nav
calPrevBtn.addEventListener('click', () => {
  calViewMonth--;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderCalendar();
});
calNextBtn.addEventListener('click', () => {
  calViewMonth++;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderCalendar();
});

// Hints
hint1Btn.addEventListener('click', useHint1);
hint2Btn.addEventListener('click', useHint2);

/* ═══════════════════════════════════════════════════════════════
   HELPER — load practice stats safely
═══════════════════════════════════════════════════════════════ */
function loadedPStats() {
  try {
    const raw = localStorage.getItem(LS_PSTATS);
    return raw ? { ...practiceStats, ...JSON.parse(raw) } : { ...practiceStats };
  } catch { return { ...practiceStats }; }
}

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
function init() {
  migrateStorage();
  loadStats();
  loadState();
  loadHistory();
  loadAchieve();
  loadPrefs();
  loadPStats();

  // Apply persisted prefs
  document.body.dataset.theme      = prefs.theme;
  document.body.dataset.difficulty = prefs.difficulty;
  difficultyPill.textContent       = prefs.difficulty.toUpperCase();
  setMute(prefs.muted);

  populateHeader();
  buildBoard();
  rebuildKeyStates();
  renderBoard();
  updateHintBar();
  renderDifficultySelector();

  // Theme cards initial state
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('theme-selected', c.dataset.theme === prefs.theme);
  });

  // Restore completed game
  if (state.status === 'won') {
    setTimeout(() => openGameOverModal(true, state.guesses.length), 500);
  } else if (state.status === 'lost') {
    setTimeout(() => openGameOverModal(false), 500);
  } else if (state.guesses.length === 0 && stats.totalGames === 0) {
    // First ever visit → show how to play
    setTimeout(() => openModal(infoModal), 700);
  }
}

init();
