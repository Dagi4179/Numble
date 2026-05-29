/**
 * ═══════════════════════════════════════════════════════════════
 *  NUMBLE — game.js
 *  Daily 4-digit number puzzle · 8-guess edition
 *  Vanilla ES6+ · No dependencies
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const DIGITS      = 4;
const MAX_GUESSES = 8;
const LS_STATE    = 'numble_state_v2';
const LS_STATS    = 'numble_stats_v2';

/* ─────────────────────────────────────────────────────────────
   DAILY TARGET  —  deterministic PRNG seeded by UTC date
   Uses djb2 hash → LCG chain so everyone globally gets the
   same 4-digit number each calendar day, resetting at 00:00 UTC.
───────────────────────────────────────────────────────────── */

/**
 * Returns today's UTC date as "YYYY-MM-DD"
 * @returns {string}
 */
function getUTCDateString() {
  const n = new Date();
  const y = n.getUTCFullYear();
  const m = String(n.getUTCMonth() + 1).padStart(2, '0');
  const d = String(n.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * djb2-style string hash → unsigned 32-bit integer
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
 * Generate today's secret 4-digit string.
 * Digits may repeat; leading zeros are preserved.
 * @returns {string}
 */
function getDailyTarget() {
  let seed   = hashStr(getUTCDateString());
  const digs = [];
  for (let i = 0; i < DIGITS; i++) {
    // LCG step (Numerical Recipes params, 32-bit)
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    digs.push(seed % 10);
  }
  return digs.join('');
}

/**
 * Ordinal puzzle number (days since 2025-01-01 UTC).
 * @returns {number}
 */
function getPuzzleNumber() {
  const epoch = Date.UTC(2025, 0, 1);
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  return Math.floor((today - epoch) / 86_400_000) + 1;
}

/* ─────────────────────────────────────────────────────────────
   FEEDBACK ALGORITHM
   Mirrors Wordle's two-pass method to handle repeated digits
   correctly without double-counting.
───────────────────────────────────────────────────────────── */

/**
 * @param {string} guess   4-char digit string
 * @param {string} target  4-char digit string
 * @returns {{ green: number, yellow: number, gray: number }}
 */
function calcFeedback(guess, target) {
  const tArr   = target.split('');
  const gArr   = guess.split('');
  const result = Array(DIGITS).fill(null);
  const tLeft  = [...tArr];

  // Pass 1 — greens (exact position match)
  for (let i = 0; i < DIGITS; i++) {
    if (gArr[i] === tArr[i]) {
      result[i] = 'green';
      tLeft[i]  = null;   // consume so it can't be re-used
    }
  }

  // Pass 2 — yellows and grays
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

  return {
    green:  result.filter(r => r === 'green').length,
    yellow: result.filter(r => r === 'yellow').length,
    gray:   result.filter(r => r === 'gray').length,
  };
}

/* ─────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────── */
const TARGET   = getDailyTarget();
const TODAY    = getUTCDateString();

/** @type {{ date:string, guesses:string[], feedbacks:Array<{green:number,yellow:number,gray:number}>, status:'playing'|'won'|'lost', current:string }} */
let state = {
  date:      TODAY,
  guesses:   [],
  feedbacks: [],
  status:    'playing',
  current:   '',
};

/** @type {{ totalGames:number, totalWins:number, streak:number, maxStreak:number, distribution:number[] }} */
let stats = {
  totalGames:   0,
  totalWins:    0,
  streak:       0,
  maxStreak:    0,
  distribution: Array(MAX_GUESSES + 1).fill(0), // index 1-8 used; 0 unused
};

/* ─────────────────────────────────────────────────────────────
   PERSISTENCE
───────────────────────────────────────────────────────────── */
function saveState() {
  try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_STATE);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.date === TODAY) state = { ...state, ...saved };
  } catch {}
}

function saveStats() {
  try { localStorage.setItem(LS_STATS, JSON.stringify(stats)); } catch {}
}

function loadStats() {
  try {
    const raw = localStorage.getItem(LS_STATS);
    if (!raw) return;
    const saved = JSON.parse(raw);
    stats = { ...stats, ...saved };
    // Ensure distribution array is right length
    if (!Array.isArray(stats.distribution) || stats.distribution.length < MAX_GUESSES + 1) {
      stats.distribution = Array(MAX_GUESSES + 1).fill(0);
    }
  } catch {}
}

/* ─────────────────────────────────────────────────────────────
   DOM REFS
───────────────────────────────────────────────────────────── */
const boardEl        = document.getElementById('board');
const progressFill   = document.getElementById('progressFill');
const dateDisplay    = document.getElementById('dateDisplay');
const attemptsLeft   = document.getElementById('attemptsLeft');
const puzzleNumEl    = document.getElementById('puzzleNum');
const toastEl        = document.getElementById('toast');
const confettiCanvas = document.getElementById('confettiCanvas');
const bgCanvas       = document.getElementById('bgCanvas');

// Game Over Modal
const gameOverModal  = document.getElementById('gameOverModal');
const goOrb          = document.getElementById('goOrb');
const goEmoji        = document.getElementById('goEmoji');
const goStatus       = document.getElementById('goStatus');
const goSub          = document.getElementById('goSub');
const answerReveal   = document.getElementById('answerReveal');
const answerDigits   = document.getElementById('answerDigits');
const distributionWrap = document.getElementById('distributionWrap');
const distBarsEl     = document.getElementById('distBars');
const statPlayed     = document.getElementById('statPlayed');
const statWinPct     = document.getElementById('statWinPct');
const statStreak     = document.getElementById('statStreak');
const statBest       = document.getElementById('statBest');
const countdownEl    = document.getElementById('countdown');
const cdH            = document.getElementById('cdH');
const cdM            = document.getElementById('cdM');
const cdS            = document.getElementById('cdS');
const shareBtn       = document.getElementById('shareBtn');

// Stats Modal
const statsModal     = document.getElementById('statsModal');
const closeStatsBtn  = document.getElementById('closeStatsBtn');
const st2Played      = document.getElementById('st2Played');
const st2WinPct      = document.getElementById('st2WinPct');
const st2Streak      = document.getElementById('st2Streak');
const st2Best        = document.getElementById('st2Best');
const distBars2      = document.getElementById('distBars2');

// Info Modal
const infoModal      = document.getElementById('infoModal');
const closeInfoBtn   = document.getElementById('closeInfoBtn');
const closeInfoPlay  = document.getElementById('closeInfoPlay');

// Header
const statsBtn       = document.getElementById('statsBtn');
const infoBtn        = document.getElementById('infoBtn');

/* ─────────────────────────────────────────────────────────────
   BOARD  —  build & render
───────────────────────────────────────────────────────────── */

/** @type {HTMLElement[]} */
const rowEls  = [];
/** @type {HTMLElement[][]} */
const tileEls = [];

/**
 * Build the 8×4 guess grid DOM once.
 */
function buildBoard() {
  boardEl.innerHTML = '';
  rowEls.length     = 0;
  tileEls.length    = 0;

  for (let r = 0; r < MAX_GUESSES; r++) {
    // Row container
    const row = document.createElement('div');
    row.classList.add('guess-row');
    row.setAttribute('role', 'row');
    row.setAttribute('aria-label', `Guess ${r + 1}`);
    row.dataset.row = r;

    // Row number label
    const lbl = document.createElement('div');
    lbl.classList.add('row-label');
    lbl.textContent = r + 1;

    // Tiles group
    const tilesGroup = document.createElement('div');
    tilesGroup.classList.add('tiles-group');

    const rowTiles = [];
    for (let c = 0; c < DIGITS; c++) {
      const tile = document.createElement('div');
      tile.classList.add('tile');
      tile.setAttribute('role', 'gridcell');
      tile.setAttribute('aria-label', `Row ${r + 1} digit ${c + 1}`);
      tile.dataset.row = r;
      tile.dataset.col = c;
      tilesGroup.appendChild(tile);
      rowTiles.push(tile);
    }
    tileEls.push(rowTiles);

    // Feedback badge
    const badge = document.createElement('div');
    badge.classList.add('feedback-badge');
    badge.innerHTML = `
      <div class="badge-items">
        <div class="badge-item bi-green">
          <span class="badge-emoji">🟩</span>
          <span class="badge-count" data-g>0</span>
          <span class="badge-lbl">Green</span>
        </div>
        <div class="badge-item bi-yellow">
          <span class="badge-emoji">🟨</span>
          <span class="badge-count" data-y>0</span>
          <span class="badge-lbl">Yellow</span>
        </div>
        <div class="badge-item bi-gray">
          <span class="badge-emoji">⬛</span>
          <span class="badge-count" data-gr>0</span>
          <span class="badge-lbl">Gray</span>
        </div>
      </div>`;

    row.appendChild(lbl);
    row.appendChild(tilesGroup);
    row.appendChild(badge);
    boardEl.appendChild(row);
    rowEls.push(row);
  }
}

/**
 * Sync DOM to current `state`.
 */
function renderBoard() {
  const currentRow = state.guesses.length;

  for (let r = 0; r < MAX_GUESSES; r++) {
    const row   = rowEls[r];
    const tiles = tileEls[r];
    const badge = row.querySelector('.feedback-badge');

    // Reset classes
    row.classList.remove('row-active', 'row-submitted');

    if (r < currentRow) {
      // ── Submitted row ──────────────────────────────────────
      row.classList.add('row-submitted');
      const guess = state.guesses[r];
      const fb    = state.feedbacks[r];

      for (let c = 0; c < DIGITS; c++) {
        tiles[c].textContent = guess[c];
        tiles[c].classList.remove('tile-filled');
      }

      badge.querySelector('[data-g]').textContent  = fb.green;
      badge.querySelector('[data-y]').textContent  = fb.yellow;
      badge.querySelector('[data-gr]').textContent = fb.gray;
      badge.classList.add('badge-visible');

      if (fb.green === DIGITS) badge.classList.add('badge-win');

    } else if (r === currentRow && state.status === 'playing') {
      // ── Active row ─────────────────────────────────────────
      row.classList.add('row-active');

      for (let c = 0; c < DIGITS; c++) {
        const ch = state.current[c] ?? '';
        tiles[c].textContent = ch;
        ch ? tiles[c].classList.add('tile-filled')
           : tiles[c].classList.remove('tile-filled');
      }

      badge.classList.remove('badge-visible', 'badge-win');

    } else {
      // ── Future row ─────────────────────────────────────────
      for (let c = 0; c < DIGITS; c++) {
        tiles[c].textContent = '';
        tiles[c].classList.remove('tile-filled');
      }
      badge.classList.remove('badge-visible', 'badge-win');
    }
  }

  updateProgressBar();
  updateAttemptsLabel();
}

/* ─────────────────────────────────────────────────────────────
   PROGRESS BAR  &  ATTEMPTS LABEL
───────────────────────────────────────────────────────────── */
function updateProgressBar() {
  const pct = (state.guesses.length / MAX_GUESSES) * 100;
  progressFill.style.width = `${pct}%`;
}

function updateAttemptsLabel() {
  const remaining = MAX_GUESSES - state.guesses.length;
  attemptsLeft.textContent = state.status === 'playing'
    ? `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining`
    : state.status === 'won' ? '✅ Solved!' : '❌ No attempts left';

  attemptsLeft.className = '';
  if (remaining <= 1 && state.status === 'playing') attemptsLeft.classList.add('urgent');
  else if (remaining <= 2 && state.status === 'playing') attemptsLeft.classList.add('last');
}

/* ─────────────────────────────────────────────────────────────
   INPUT  —  digit, backspace, enter
───────────────────────────────────────────────────────────── */
function handleDigit(d) {
  if (state.status !== 'playing') return;
  if (state.current.length >= DIGITS) {
    // Visual feedback that row is full
    shakeActiveRow();
    return;
  }
  state.current += d;
  renderBoard();
}

function handleBackspace() {
  if (state.status !== 'playing') return;
  if (state.current.length === 0) return;
  state.current = state.current.slice(0, -1);
  renderBoard();
}

function handleEnter() {
  if (state.status !== 'playing') return;
  if (state.current.length < DIGITS) {
    showToast('Enter all 4 digits first!', 'error');
    shakeActiveRow();
    return;
  }
  submitGuess();
}

/* ─────────────────────────────────────────────────────────────
   SUBMIT GUESS
───────────────────────────────────────────────────────────── */
function submitGuess() {
  const guess   = state.current;
  const fb      = calcFeedback(guess, TARGET);
  const rowIdx  = state.guesses.length;

  state.guesses.push(guess);
  state.feedbacks.push(fb);
  state.current = '';

  // Flip animation on the row
  flipRow(rowIdx);

  // Determine outcome
  if (fb.green === DIGITS) {
    state.status = 'won';
    saveState();
    updateStats(true, rowIdx + 1);
    renderBoard();
    scheduleWinSequence(rowIdx + 1);

  } else if (state.guesses.length >= MAX_GUESSES) {
    state.status = 'lost';
    saveState();
    updateStats(false, null);
    renderBoard();
    setTimeout(() => openGameOverModal(false), 900);

  } else {
    saveState();
    renderBoard();
    // Hint if very close (3 greens!)
    if (fb.green === 3) showToast('🔥 So close — one digit off!', 'success', 2200);
    else if (fb.green === 2 && fb.yellow === 1) showToast('💡 Getting warmer…', '', 1800);
  }
}

function flipRow(rowIdx) {
  const row = rowEls[rowIdx];
  row.classList.add('row-flip');
  row.addEventListener('animationend', () => row.classList.remove('row-flip'), { once: true });
}

function shakeActiveRow() {
  const row = rowEls[state.guesses.length];
  if (!row) return;
  row.classList.add('row-shake');
  row.addEventListener('animationend', () => row.classList.remove('row-shake'), { once: true });
}

/* ─────────────────────────────────────────────────────────────
   WIN SEQUENCE  —  toast + confetti + modal
───────────────────────────────────────────────────────────── */
function scheduleWinSequence(attempts) {
  const msgs = [
    null,  // 0 unused
    '🎯 PERFECT — First try!!',
    '🔥 INCREDIBLE — Two tries!',
    '⚡ Outstanding!',
    '🌟 Excellent!',
    '👏 Well done!',
    '✅ Good solve!',
    '😅 Just made it!',
    '😌 Phew — got it!',
  ];
  const msg = msgs[Math.min(attempts, msgs.length - 1)] || '✅ Solved!';
  setTimeout(() => showToast(msg, 'success', 2000), 400);
  setTimeout(() => launchConfetti(), 600);
  setTimeout(() => openGameOverModal(true, attempts), 1400);
}

/* ─────────────────────────────────────────────────────────────
   STATS  —  update & persist
───────────────────────────────────────────────────────────── */
function updateStats(won, attempts) {
  stats.totalGames++;
  if (won) {
    stats.totalWins++;
    stats.streak++;
    if (stats.streak > stats.maxStreak) stats.maxStreak = stats.streak;
    if (attempts >= 1 && attempts <= MAX_GUESSES) {
      stats.distribution[attempts]++;
    }
  } else {
    stats.streak = 0;
  }
  saveStats();
}

/* ─────────────────────────────────────────────────────────────
   GAME OVER MODAL
───────────────────────────────────────────────────────────── */
function openGameOverModal(won, attempts) {
  // Orb colour
  goOrb.className = `modal-orb ${won ? 'orb-win' : 'orb-lose'}`;

  // Status text
  if (won) {
    goEmoji.textContent   = attempts <= 2 ? '🏆' : attempts <= 4 ? '🎯' : '✅';
    goStatus.textContent  = attempts === 1 ? 'PERFECT!' : 'SOLVED!';
    goStatus.className    = 'go-status status-win';
    goSub.textContent     = `Cracked in ${attempts} attempt${attempts !== 1 ? 's' : ''}`;
    answerReveal.style.display = 'none';
  } else {
    goEmoji.textContent   = '😔';
    goStatus.textContent  = 'GAME OVER';
    goStatus.className    = 'go-status status-lose';
    goSub.textContent     = 'Better luck tomorrow — the answer was:';
    answerReveal.style.display = 'block';
    answerDigits.innerHTML = TARGET.split('').map(d =>
      `<div class="ans-digit">${d}</div>`).join('');
  }

  // Fill stats
  populateStatsUI(
    statPlayed, statWinPct, statStreak, statBest,
    distBarsEl, won ? attempts : null
  );

  openModal(gameOverModal);
  startCountdown();
}

/* ─────────────────────────────────────────────────────────────
   STATS MODAL
───────────────────────────────────────────────────────────── */
function openStatsModal() {
  populateStatsUI(st2Played, st2WinPct, st2Streak, st2Best, distBars2, null);
  openModal(statsModal);
}

/**
 * Populate stat values + distribution bars into a given set of elements.
 */
function populateStatsUI(playedEl, winPctEl, streakEl, bestEl, barsEl, highlightRow) {
  playedEl.textContent = stats.totalGames;
  winPctEl.textContent = stats.totalGames > 0
    ? Math.round((stats.totalWins / stats.totalGames) * 100) + '%'
    : '0%';
  streakEl.textContent = stats.streak;
  bestEl.textContent   = stats.maxStreak;

  // Distribution bars
  const maxVal = Math.max(...stats.distribution.slice(1), 1);
  barsEl.innerHTML = '';
  for (let i = 1; i <= MAX_GUESSES; i++) {
    const count   = stats.distribution[i] || 0;
    const pct     = Math.max(4, Math.round((count / maxVal) * 100));
    const isHL    = i === highlightRow;

    const row = document.createElement('div');
    row.classList.add('dist-bar-row');
    row.innerHTML = `
      <div class="dist-bar-label">${i}</div>
      <div class="dist-bar-track">
        <div class="dist-bar-fill ${isHL ? 'dist-active' : ''}"
             style="width: 0%; transition-delay: ${(i - 1) * 60}ms">
          ${count}
        </div>
      </div>`;
    barsEl.appendChild(row);

    // Trigger CSS transition after paint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        row.querySelector('.dist-bar-fill').style.width = `${pct}%`;
      });
    });
  }
}

/* ─────────────────────────────────────────────────────────────
   MODAL  —  open / close helpers
───────────────────────────────────────────────────────────── */
function openModal(overlayEl) {
  overlayEl.classList.add('overlay-open');
  document.body.style.overflow = 'hidden';
}

function closeModal(overlayEl) {
  overlayEl.classList.remove('overlay-open');
  document.body.style.overflow = '';
}

/* ─────────────────────────────────────────────────────────────
   COUNTDOWN  —  ticks every second
───────────────────────────────────────────────────────────── */
let countdownInterval = null;

function startCountdown() {
  function tick() {
    const now      = new Date();
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
    ));
    const diff = midnight - now;
    const h    = Math.floor(diff / 3_600_000);
    const m    = Math.floor((diff % 3_600_000) / 60_000);
    const s    = Math.floor((diff % 60_000) / 1_000);
    cdH.textContent = String(h).padStart(2, '0');
    cdM.textContent = String(m).padStart(2, '0');
    cdS.textContent = String(s).padStart(2, '0');
  }
  tick();
  clearInterval(countdownInterval);
  countdownInterval = setInterval(tick, 1000);
}

/* ─────────────────────────────────────────────────────────────
   SHARE
───────────────────────────────────────────────────────────── */
function buildShareText() {
  const won      = state.status === 'won';
  const attempts = won ? `${state.guesses.length}/${MAX_GUESSES}` : 'X/8';
  const pNum     = getPuzzleNumber();

  const rows = state.feedbacks.map(fb => {
    const g  = '🟩'.repeat(fb.green);
    const y  = '🟨'.repeat(fb.yellow);
    const gr = '⬛'.repeat(fb.gray);
    return `${g}${y}${gr}`;
  });

  return [
    `NUMBLE #${pNum}  ${attempts}`,
    '',
    rows.join('\n'),
    '',
    'Play at numble.game',
  ].join('\n');
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
    showToast('Could not copy — try manually.', 'error');
  }
}

/* ─────────────────────────────────────────────────────────────
   TOAST
───────────────────────────────────────────────────────────── */
let toastTimer = null;

/**
 * @param {string} msg
 * @param {'error'|'success'|''} type
 * @param {number} duration  ms
 */
function showToast(msg, type = '', duration = 1700) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className   = `toast toast-show${type ? ' toast-' + type : ''}`;
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('toast-show', 'toast-error', 'toast-success');
  }, duration);
}

/* ─────────────────────────────────────────────────────────────
   CONFETTI  —  canvas-based particle burst
───────────────────────────────────────────────────────────── */
let confettiParticles = [];
let confettiRAF       = null;
const CONFETTI_COLORS = [
  '#6366f1', '#818cf8', '#22d46e', '#f59e0b',
  '#f472b6', '#38bdf8', '#a78bfa', '#34d399',
];

function launchConfetti() {
  const ctx    = confettiCanvas.getContext('2d');
  const W      = confettiCanvas.width  = window.innerWidth;
  const H      = confettiCanvas.height = window.innerHeight;

  confettiParticles = Array.from({ length: 120 }, () => ({
    x:   Math.random() * W,
    y:   Math.random() * H * 0.4 - H * 0.1,
    w:   Math.random() * 8 + 4,
    h:   Math.random() * 5 + 3,
    rot: Math.random() * 360,
    vx:  (Math.random() - 0.5) * 6,
    vy:  Math.random() * 4 + 2,
    vr:  (Math.random() - 0.5) * 8,
    col: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    life: 1,
    decay: Math.random() * 0.008 + 0.006,
  }));

  confettiCanvas.classList.add('active');
  cancelAnimationFrame(confettiRAF);

  function draw() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;

    confettiParticles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.12;   // gravity
      p.vx *= 0.99;   // drag
      p.rot += p.vr;
      p.life -= p.decay;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    if (alive) {
      confettiRAF = requestAnimationFrame(draw);
    } else {
      confettiCanvas.classList.remove('active');
      ctx.clearRect(0, 0, W, H);
    }
  }

  draw();
}

/* ─────────────────────────────────────────────────────────────
   BACKGROUND  —  drifting dot particles
───────────────────────────────────────────────────────────── */
(function initBgCanvas() {
  const ctx    = bgCanvas.getContext('2d');
  let   dots   = [];
  let   W, H;

  function resize() {
    W = bgCanvas.width  = window.innerWidth;
    H = bgCanvas.height = window.innerHeight;
  }

  function spawnDots(n) {
    dots = Array.from({ length: n }, () => ({
      x:    Math.random() * W,
      y:    Math.random() * H,
      r:    Math.random() * 1.4 + 0.3,
      vx:   (Math.random() - 0.5) * 0.18,
      vy:   (Math.random() - 0.5) * 0.18,
      a:    Math.random() * 0.5 + 0.15,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    dots.forEach(d => {
      d.x = (d.x + d.vx + W) % W;
      d.y = (d.y + d.vy + H) % H;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99,102,241,${d.a})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  resize();
  spawnDots(80);
  draw();
  window.addEventListener('resize', () => { resize(); });
})();

/* ─────────────────────────────────────────────────────────────
   HEADER  —  populate date & puzzle number
───────────────────────────────────────────────────────────── */
function populateHeader() {
  puzzleNumEl.textContent = `#${String(getPuzzleNumber()).padStart(3, '0')}`;
  dateDisplay.textContent = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/* ─────────────────────────────────────────────────────────────
   KEYBOARD  —  on-screen + physical
───────────────────────────────────────────────────────────── */
document.getElementById('keyboard').addEventListener('click', e => {
  const btn = e.target.closest('.key');
  if (!btn) return;
  const k = btn.dataset.key;
  if (/^\d$/.test(k))     handleDigit(k);
  else if (k === 'Backspace') handleBackspace();
  else if (k === 'Enter')     handleEnter();
});

document.addEventListener('keydown', e => {
  // If any modal is open, don't forward to game
  if (
    gameOverModal.classList.contains('overlay-open') ||
    statsModal.classList.contains('overlay-open')
  ) {
    if (e.key === 'Escape') {
      if (statsModal.classList.contains('overlay-open')) closeModal(statsModal);
    }
    return;
  }
  if (infoModal.classList.contains('overlay-open')) {
    if (e.key === 'Escape') closeModal(infoModal);
    return;
  }

  if (/^\d$/.test(e.key))        handleDigit(e.key);
  else if (e.key === 'Backspace') handleBackspace();
  else if (e.key === 'Enter')     handleEnter();
});

/* ─────────────────────────────────────────────────────────────
   MODAL BUTTONS  —  wire events
───────────────────────────────────────────────────────────── */
statsBtn.addEventListener('click', openStatsModal);
infoBtn.addEventListener('click',  () => openModal(infoModal));

closeStatsBtn.addEventListener('click', () => closeModal(statsModal));
closeInfoBtn.addEventListener('click',  () => closeModal(infoModal));
closeInfoPlay.addEventListener('click', () => closeModal(infoModal));

shareBtn.addEventListener('click', handleShare);

// Close modals by clicking backdrop (except game-over if game just ended)
statsModal.addEventListener('click',  e => { if (e.target === statsModal)  closeModal(statsModal);  });
infoModal.addEventListener('click',   e => { if (e.target === infoModal)   closeModal(infoModal);   });
gameOverModal.addEventListener('click', e => {
  // Only allow backdrop-close on game over if game is still playing (shouldn't normally happen)
  if (e.target === gameOverModal && state.status === 'playing') closeModal(gameOverModal);
});

/* ─────────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────────── */
function init() {
  loadStats();
  loadState();
  populateHeader();
  buildBoard();
  renderBoard();

  // Restore completed game
  if (state.status === 'won') {
    const attempts = state.guesses.length;
    setTimeout(() => openGameOverModal(true, attempts), 500);
  } else if (state.status === 'lost') {
    setTimeout(() => openGameOverModal(false), 500);
  } else if (state.guesses.length === 0 && stats.totalGames === 0) {
    // First-ever visit → show rules
    setTimeout(() => openModal(infoModal), 700);
  }
}

init();
