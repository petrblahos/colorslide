/* Colorslide – a hex stack sorting puzzle. Everything is drawn on a canvas, no external assets. */
(() => {
  'use strict';

  // ---------- Constants ----------
  const RADIUS = 2;            // hex board radius (19 cells, 5 across)
  const CLEAR_AT = 10;         // tiles of one color needed to clear
  let Y_SCALE = 0.85;          // vertical squash for a tilted look
  let TILE_H = 0.17;           // tile thickness relative to hex size
  let FADE_ALPHA = 0.5;        // opacity of placed stacks while dragging
  const TILE_R = 0.9;          // tile radius relative to cell size
  const CORNER_ROUND = 0.2;    // hexagon corner rounding relative to radius
  const FLY_MS = 260;          // tile flight duration
  const STAGGER_MS = 60;       // delay between tiles in a transfer
  const POP_MS = 320;
  const FLATTEN_MS = 250;      // tiles flatten to zero height when a drag starts
  const UNFLATTEN_MS = 100;    // ...and spring back when it ends
  const RUSH = 2.5;            // animation speed-up while more drops wait in the queue
  const SQ3 = Math.sqrt(3);
  const PALETTE = ['#ff5d73', '#3a86ff', '#ffd23f', '#6be08a', '#a61be4', '#ff9a3c', '#8c909c'];
  const START_COLORS = 3;
  const POINTS_PER_COLOR = 100;
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const BEST_KEY = 'colorslide.best';
  const MODE_KEY = 'colorslide.mode';   // 'classic' | 'obstacles', last mode played
  const COUNTDOWN_S = 10;
  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  let ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas'); // offscreen layer for faded stacks
  const layerCtx = layer.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const introEl = document.getElementById('intro');
  const overInfoEl = document.getElementById('overInfo');
  const finalScoreEl = document.getElementById('finalScore');
  const autoBtn = document.getElementById('autoBtn');
  const tiltBtn = document.getElementById('tiltBtn');
  const modeOverlay = document.getElementById('modeOverlay');
  const countEl = document.getElementById('countdown');
  const modeBtns = { classic: document.getElementById('classicBtn'), obstacles: document.getElementById('obstaclesBtn') };

  // ---------- State ----------
  let cells = [], cellMap = new Map(), drawOrder = [];
  let tray = [null, null, null];
  let score = 0, best = loadBest(), mode = loadMode();
  let busy = false, over = false, started = false, gen = 0;
  // All placements feed one resolver: `queue` holds cells still to check, `dropped` the
  // player-placed cells among them that the resolver has not reached yet.
  let queue = [], dropped = new Set(), combo = 0;
  let flyers = [], poppers = [], floaters = [];
  let drag = null, hover = null;
  let flatP = 0, flatK = 1, lastFrame = 0; // flatten progress (0..1) and resulting height factor
  let yScale = Y_SCALE;                      // drawn vertical squash: eases to 1 (top-down) while dragging
  let tiltOnDrag = true;                     // Tilt button: whether dragging straightens the board
  let tiltP = 0;                             // straighten progress (0..1), runs once the finger leaves the tray
  let L = { w: 0, h: 0, dpr: 1, s: 20, cx: 0, cy: 0, trayY: 0, slots: [] };

  // ---------- Helpers ----------
  const rand = (n) => Math.floor(Math.random() * n);
  const randInt = (a, b) => a + rand(b - a + 1);
  const top = (c) => c.stack[c.stack.length - 1];
  const now = () => performance.now();

  function topRun(stack) {
    if (!stack.length) return 0;
    const t = stack[stack.length - 1];
    let n = 0;
    for (let i = stack.length - 1; i >= 0 && stack[i] === t; i--) n++;
    return n;
  }
  function runCount(stack) {
    let n = 0;
    for (let i = 0; i < stack.length; i++) if (i === 0 || stack[i] !== stack[i - 1]) n++;
    return n;
  }

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function loadMode() {
    try { return localStorage.getItem(MODE_KEY) === 'obstacles' ? 'obstacles' : 'classic'; } catch (e) { return 'classic'; }
  }
  function saveMode() {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* ignore */ }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  const SHADES = PALETTE.map((c) => ({ base: c, light: shade(c, 0.2), dark: shade(c, -0.38), edge: shade(c, -0.55) }));

  // ---------- Board ----------
  function buildBoard() {
    cells = []; cellMap = new Map();
    // Random mode grows the hexagon: the outer columns get one more cell at the top and
    // bottom, the second columns one more at the bottom (25 cells).
    const big = mode === 'obstacles';
    for (let q = -RADIUS; q <= RADIUS; q++) {
      // screen row is r + q/2, so a larger r is always lower on screen
      const [top, bottom] = !big ? [0, 0] : Math.abs(q) === 2 ? [1, 1] : Math.abs(q) === 1 ? [0, 1] : [0, 0];
      for (let r = Math.max(-RADIUS, -q - RADIUS) - top; r <= Math.min(RADIUS, -q + RADIUS) + bottom; r++) {
        const c = { q, r, blocked: false, stack: [] };
        cells.push(c); cellMap.set(q + ',' + r, c);
      }
    }
    // Random mode: 6-10 missing cells (never the center)
    const nBlocked = big ? randInt(6, 10) : 0;
    const pool = cells.filter((c) => !(c.q === 0 && c.r === 0));
    for (let i = 0; i < nBlocked; i++) pool.splice(rand(pool.length), 1)[0].blocked = true;
    drawOrder = cells.slice().sort((a, b) => (a.r + a.q / 2) - (b.r + b.q / 2) || a.q - b.q);
  }

  function neighbors(c) {
    const out = [];
    for (const [dq, dr] of DIRS) {
      const n = cellMap.get((c.q + dq) + ',' + (c.r + dr));
      if (n && !n.blocked) out.push(n);
    }
    return out;
  }

  let debugColors = null; // set by the debug slider; overrides the score-based count
  function activeColors() {
    if (debugColors !== null) return debugColors;
    return Math.min(PALETTE.length, START_COLORS + Math.floor(score / POINTS_PER_COLOR));
  }

  function makeStack() {
    const n = randInt(2, 6);
    const roll = Math.random();
    let runs = roll < 0.35 ? 1 : roll < 0.8 ? 2 : 3;
    runs = Math.min(runs, n);
    // split n into `runs` positive parts
    const lens = new Array(runs).fill(1);
    for (let i = runs; i < n; i++) lens[rand(runs)]++;
    const k = activeColors();
    const stack = [];
    let prev = -1;
    for (const len of lens) {
      let col;
      do { col = rand(k); } while (col === prev && k > 1);
      prev = col;
      for (let i = 0; i < len; i++) stack.push(col);
    }
    return stack;
  }

  function refillTray() {
    if (tray.every((t) => t === null)) tray = [makeStack(), makeStack(), makeStack()];
  }

  // ---------- Game flow ----------
  function newGame() {
    gen++;
    buildBoard();
    resize();
    tray = [null, null, null];
    score = 0; busy = false; over = false; started = true;
    queue = []; dropped = new Set(); combo = 0;
    flyers = []; poppers = []; floaters = [];
    drag = null; hover = null; autoMove = null; plan = [];
    refillTray();
    updateScore(false);
  }

  // Mode picker: the last played mode is pre-selected and starts when the countdown ends;
  // tapping either button starts that mode right away. `kind` picks the extra info shown:
  // 'start' (rules), 'over' (final score) or 'new' (nothing).
  let countdown = null;
  function openModePicker(kind) {
    clearInterval(countdown);
    let left = COUNTDOWN_S;
    countEl.textContent = left;
    for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('sel', k === mode);
    introEl.classList.toggle('hidden', kind !== 'start');
    overInfoEl.classList.toggle('hidden', kind !== 'over');
    modeOverlay.style.setProperty('--countdown', COUNTDOWN_S + 's');
    modeOverlay.classList.remove('hidden');
    countdown = setInterval(() => {
      if (--left > 0) countEl.textContent = left;
      else startMode(mode);
    }, 1000);
  }
  function startMode(m) {
    clearInterval(countdown); countdown = null;
    modeOverlay.classList.add('hidden');
    mode = m; saveMode();
    newGame();
  }

  function updateScore(bump) {
    scoreEl.textContent = score;
    if (score > best) { best = score; saveBest(); }
    bestEl.textContent = best;
    if (bump) {
      scoreEl.classList.remove('bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('bump');
    }
  }

  function checkGameOver() {
    if (cells.some((c) => !c.blocked && c.stack.length === 0)) return;
    over = true;
    finalScoreEl.textContent = score;
    setTimeout(() => openModePicker('over'), 400);
  }

  function place(cell, stack) {
    cell.stack = stack.slice();
    enqueue(cell, false);
    dropped.add(cell);
    if (!busy) resolve();
  }

  function enqueue(c, front) {
    const i = queue.indexOf(c);
    if (i >= 0) queue.splice(i, 1);
    if (front) queue.unshift(c); else queue.push(c);
  }

  // Animation time scale: faster while the player has more drops waiting.
  const pace = () => (dropped.size ? 1 / RUSH : 1);

  // Move `n` tiles one by one from `from` to `to` with a flight animation.
  function transfer(from, to, n, token) {
    return new Promise((res) => {
      let landed = 0;
      const base = to.stack.length, k = pace();
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          if (token !== gen) return;
          const color = from.stack.pop();
          flyers.push({
            color, from, to, h0: from.stack.length, h1: base + i, t0: now(), dur: FLY_MS * k,
            land() { to.stack.push(color); if (++landed === n) res(); },
          });
        }, i * STAGGER_MS * k);
      }
    });
  }

  function clearTop(cell, n, token) {
    return new Promise((res) => {
      let done = 0;
      const k = pace();
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          if (token !== gen) return;
          const color = cell.stack.pop();
          poppers.push({ color, cell, h: cell.stack.length, t0: now(), dur: POP_MS * k });
          if (++done === n) setTimeout(res, POP_MS * 0.6 * k);
        }, i * 35 * k);
      }
    });
  }

  async function resolve() {
    const token = gen;
    busy = true;
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      const c = queue.shift();
      dropped.delete(c);
      if (!c.stack.length) continue;
      const color = top(c);
      const nbs = neighbors(c).filter((n) => n.stack.length && top(n) === color);
      if (!nbs.length) continue;

      // Choose the stack that should receive the tiles: the purest one, then the one with the longest top run.
      const cands = [c, ...nbs];
      cands.sort((a, b) =>
        runCount(a.stack) - runCount(b.stack) ||
        topRun(b.stack) - topRun(a.stack) ||
        (a === c ? -1 : b === c ? 1 : 0));
      const target = cands[0];

      if (target === c) {
        for (const n of nbs) {
          await transfer(n, c, topRun(n.stack), token);
          if (token !== gen) return;
          enqueue(n, false);
        }
      } else {
        await transfer(c, target, topRun(c.stack), token);
        if (token !== gen) return;
        enqueue(c, false);
      }

      const run = topRun(target.stack);
      if (run >= CLEAR_AT) {
        combo++;
        await clearTop(target, run, token);
        if (token !== gen) return;
        const pts = run * combo;
        score += pts;
        floaters.push({ cell: target, text: combo > 1 ? `+${pts}  x${combo}` : `+${pts}`, t0: now() });
        updateScore(true);
      }
      enqueue(target, true);
    }
    busy = false;
    combo = 0;
    checkGameOver();
  }

  // ---------- Auto play ----------
  // The solver tries every order and position for the stacks left in the tray (the tray only
  // refills once it is empty, so that is everything known), simulating each chain instantly.
  // simResolve() mirrors resolve() without animation; keep the two in sync.
  const AUTO_PAUSE_MS = 350;   // idle time before the next auto move
  const AUTO_MOVE_MS = 450;    // flight of the stack from the tray to its cell
  const AUTO_DROP_MS = 120;    // final descent onto the cell once the board is idle
  const AUTO_LIFT = 1.5;       // hover height above the target cell while waiting, in cell sizes
  const EVAL_EMPTY = 3;        // leaf score per empty cell
  const EVAL_MIX = 1;          // leaf penalty per color change inside a stack
  const EVAL_CENTER = 0.01;    // tie-breaker per stack placed on the central line (q = 0)
  const GAME_OVER = -1e6;

  function simResolve(st, nb, start) {
    const q = [start];
    const enq = (i, front) => {
      const j = q.indexOf(i);
      if (j >= 0) q.splice(j, 1);
      if (front) q.unshift(i); else q.push(i);
    };
    let pts = 0, combo = 0, guard = 0;
    while (q.length && guard++ < 5000) {
      const c = q.shift();
      if (!st[c].length) continue;
      const color = st[c][st[c].length - 1];
      const nbs = nb[c].filter((n) => st[n].length && st[n][st[n].length - 1] === color);
      if (!nbs.length) continue;
      const cands = [c, ...nbs];
      cands.sort((a, b) =>
        runCount(st[a]) - runCount(st[b]) ||
        topRun(st[b]) - topRun(st[a]) ||
        (a === c ? -1 : b === c ? 1 : 0));
      const target = cands[0];
      const move = (from, to) => { st[to].push(...st[from].splice(-topRun(st[from]))); };
      if (target === c) {
        for (const n of nbs) { move(n, c); enq(n, false); }
      } else {
        move(c, target); enq(c, false);
      }
      const run = topRun(st[target]);
      if (run >= CLEAR_AT) {
        combo++;
        st[target].length -= run;
        pts += run * combo;
      }
      enq(target, true);
    }
    return pts;
  }

  function bestMove() {
    const idx = new Map(cells.map((c, i) => [c, i]));
    const nb = cells.map((c) => neighbors(c).map((n) => idx.get(n)));
    const open = cells.map((c, i) => (c.blocked ? -1 : i)).filter((i) => i >= 0);
    let best = null, bestV = -Infinity;
    const dfs = (st, left, pts, path) => {
      const empties = open.filter((i) => !st[i].length);
      let v = null;
      if (path.length && !empties.length) v = GAME_OVER + pts;
      else if (!left.length) {
        v = pts + EVAL_EMPTY * empties.length;
        for (const i of open) if (st[i].length) v -= EVAL_MIX * (runCount(st[i]) - 1);
      }
      if (v !== null) {
        for (const m of path) if (m.cell.q === 0) v += EVAL_CENTER;
        if (v > bestV) { bestV = v; best = path; }
        return;
      }
      for (const si of left) {
        // identical stacks in the tray give identical subtrees
        if (left.some((o) => o < si && tray[o].join() === tray[si].join())) continue;
        for (const ci of empties) {
          const st2 = st.map((s) => s.slice());
          st2[ci] = tray[si].slice();
          const p = simResolve(st2, nb, ci);
          dfs(st2, left.filter((o) => o !== si), pts + p, [...path, { slot: si, cell: cells[ci] }]);
        }
      }
    };
    dfs(cells.map((c) => c.stack.slice()), [0, 1, 2].filter((i) => tray[i]), 0, []);
    return best || [];
  }

  // Called every frame. Plans the whole tray once the board is idle, then flies the planned
  // stacks one after another: each takes off as soon as the previous one has dropped, hovers
  // above its cell while a chain is still animating, and drops only once the board is idle,
  // so the game plays out exactly as simulated. Drawn on its own, not through `drag`, so the
  // board is not flattened or faded meanwhile.
  let auto = false, plan = [], autoMove = null, autoIdle = 0;
  function autoTick(t) {
    if (countdown) return; // mode picker open
    if (over) { autoMove = null; plan = []; }
    if (autoMove) {
      const m = autoMove, b = cellPos(m.cell), lift = L.s * AUTO_LIFT;
      if (!m.drop) {
        const k = Math.min(1, (t - m.t0) / AUTO_MOVE_MS);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        m.x = m.x0 + (b.x - m.x0) * e;
        m.y = m.y0 + (b.y - lift - m.y0) * e;
        if (k >= 1 && !busy && !flyers.length) m.drop = t;
      } else {
        const k = Math.min(1, (t - m.drop) / AUTO_DROP_MS);
        m.x = b.x; m.y = b.y - lift * (1 - k);
        if (k >= 1) {
          autoMove = null;
          tray[m.slot] = null;
          refillTray();
          place(m.cell, m.stack);
        }
      }
      return;
    }
    if (!auto || !started || over || drag) { autoIdle = 0; return; }
    if (!plan.length) {
      if (busy || flyers.length) { autoIdle = 0; return; }
      if (!autoIdle) autoIdle = t;
      if (t - autoIdle < AUTO_PAUSE_MS) return;
      autoIdle = 0;
      plan = bestMove();
      if (!plan.length) return;
    }
    const m = plan.shift(), sl = L.slots[m.slot];
    autoMove = { slot: m.slot, stack: tray[m.slot], cell: m.cell, x0: sl.x, y0: sl.y, x: sl.x, y: sl.y, t0: t, drop: 0 };
  }

  function setAuto(on) {
    auto = on;
    plan = [];
    autoBtn.classList.toggle('on', on);
    autoBtn.setAttribute('aria-pressed', String(on));
    if (on && (!started || over)) startMode(mode);
  }

  // ---------- Layout ----------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    L.dpr = window.devicePixelRatio || 1;
    L.w = rect.width; L.h = rect.height;
    canvas.width = Math.round(L.w * L.dpr);
    canvas.height = Math.round(L.h * L.dpr);
    layer.width = canvas.width; layer.height = canvas.height;
    // vertical extent of the board in rows (r + q/2); the random board reaches lower
    const rows = cells.map((c) => c.r + c.q / 2);
    const yMin = Math.min(...rows), yMax = Math.max(...rows);
    const halfBoard = (yMax - yMin) / 2 * SQ3 * Y_SCALE + SQ3 / 2 * Y_SCALE; // in units of s
    const totalH = 1.6 + 2 * halfBoard + 1.0 + 2.6 + 0.6;
    const s = Math.max(8, Math.min(L.w / (RADIUS * 3 + 2.1), L.h / totalH));
    L.s = s;
    const used = totalH * s;
    const top0 = (L.h - used) / 2;
    L.cx = L.w / 2;
    L.my = (yMin + yMax) / 2;  // middle row; the board stretches around it while dragging
    L.cy = top0 + 1.6 * s + halfBoard * s - L.my * SQ3 * Y_SCALE * s;
    L.trayY = top0 + 1.6 * s + 2 * halfBoard * s + 1.0 * s + 2.0 * s;
    const gap = Math.min(L.w / 3.2, 3.6 * s);
    L.slots = [-1, 0, 1].map((i) => ({ x: L.cx + i * gap, y: L.trayY }));
  }

  function cellPos(c) {
    const row = c.r + c.q / 2;
    return { x: L.cx + L.s * 1.5 * c.q, y: L.cy + L.s * SQ3 * ((row - L.my) * yScale + L.my * Y_SCALE) };
  }

  // ---------- Drawing ----------
  // Hexagon outline with rounded corners (corner radius is a fraction of r).
  function hexPath(x, y, r, rot = 0, round = CORNER_ROUND) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i + rot;
      pts.push([x + r * Math.cos(a), y + r * Math.sin(a) * yScale]);
    }
    const cr = r * round;
    ctx.beginPath();
    ctx.moveTo((pts[5][0] + pts[0][0]) / 2, (pts[5][1] + pts[0][1]) / 2);
    for (let i = 0; i < 6; i++) {
      const p = pts[i], n = pts[(i + 1) % 6];
      ctx.arcTo(p[0], p[1], n[0], n[1], cr);
    }
    ctx.closePath();
  }

  function drawTile(x, y, color, scale = 1, alpha = 1) {
    const s = L.s, r = s * TILE_R * scale, th = s * TILE_H * flatK * scale;
    const sh = SHADES[color];
    ctx.globalAlpha = alpha;
    y -= th; // lift the tile so its bottom edge (not its top face) rests at y
    // side band
    hexPath(x, y + th, r);
    ctx.fillStyle = sh.dark; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.03); ctx.strokeStyle = sh.edge; ctx.stroke();
    // top face
    hexPath(x, y, r);
    const g = ctx.createLinearGradient(x, y - r * yScale, x, y + r * yScale);
    g.addColorStop(0, sh.light); g.addColorStop(1, sh.base);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, s * 0.025); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawStack(x, y, stack, alpha = 1, label = true) {
    const th = L.s * TILE_H * flatK;
    for (let i = 0; i < stack.length; i++) drawTile(x, y - i * th, stack[i], 1, alpha);
    if (label) {
      const ty = y - stack.length * th;
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${Math.round(L.s * 0.48)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, L.s * 0.09); ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      const t = String(topRun(stack));
      ctx.strokeText(t, x, ty + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(t, x, ty + 1);
      ctx.globalAlpha = 1;
    }
  }

  function drawSocket(c, highlighted) {
    const p = cellPos(c), s = L.s;
    if (c.blocked) return; // blocked cells are holes in the board
    hexPath(p.x, p.y, s * 0.95);
    ctx.fillStyle = highlighted ? 'rgba(255,210,120,0.35)' : 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = highlighted ? '#fff' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.stroke();
  }

  function render() {
    const t = now();
    const dt = lastFrame ? t - lastFrame : 0;
    lastFrame = t;
    autoTick(t);
    flatP = drag ? Math.min(1, flatP + dt / FLATTEN_MS) : Math.max(0, flatP - dt / UNFLATTEN_MS);
    flatK = 1 - flatP * flatP * (3 - 2 * flatP);
    // finger above the tray panel (drag.y - drag.oy is the pointer position)
    const outOfTray = drag && tiltOnDrag && drag.y - drag.oy < L.trayY - 2.0 * L.s;
    tiltP = outOfTray ? Math.min(1, tiltP + dt / FLATTEN_MS) : Math.max(0, tiltP - dt / UNFLATTEN_MS);
    yScale = Y_SCALE + (1 - Y_SCALE) * tiltP * tiltP * (3 - 2 * tiltP);
    const s = L.s, th = s * TILE_H * flatK;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);

    // advance flyers first so landing tiles are in stacks before drawing
    for (let i = flyers.length - 1; i >= 0; i--) {
      if (t - flyers[i].t0 >= flyers[i].dur) { const f = flyers[i]; flyers.splice(i, 1); f.land(); }
    }

    for (const c of drawOrder) drawSocket(c, c === hover);
    // While dragging, placed stacks are drawn into an offscreen layer and composited
    // semi-transparently, then free cells are outlined on top, so it is easy to see where
    // the stack can go.
    const fade = !!drag;
    const mainCtx = ctx;
    if (fade) {
      layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      layerCtx.clearRect(0, 0, layer.width, layer.height);
      layerCtx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      ctx = layerCtx;
    }
    for (const c of drawOrder) {
      if (!c.stack.length) continue;
      const p = cellPos(c);
      drawStack(p.x, p.y, c.stack);
    }
    ctx = mainCtx;
    if (fade) {
      // outline each occupied cell with nested rings, one per color run: the bottom run is the
      // outer ring, each run above it is drawn inside the previous one
      const ow = Math.max(3, s * 0.12);
      ctx.lineWidth = ow;
      for (const c of drawOrder) {
        if (!c.stack.length) continue;
        const p = cellPos(c);
        let r = s * 0.95;
        for (let i = 0; i < c.stack.length; i++) {
          if (i > 0 && c.stack[i] === c.stack[i - 1]) continue;
          hexPath(p.x, p.y, Math.max(r, s * 0.2));
          ctx.strokeStyle = SHADES[c.stack[i]].base; ctx.stroke();
          r -= ow * 1.4;
        }
      }
      for (const c of drawOrder) {
        if (c.blocked || c.stack.length) continue;
        const p = cellPos(c), on = c === hover;
        hexPath(p.x, p.y, s * 0.95);
        ctx.strokeStyle = on ? '#fff' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = Math.max(1.5, s * (on ? 0.07 : 0.045));
        ctx.stroke();
      }
      // faded stacks go on top of the outlines
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = FADE_ALPHA;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      if (hover) { const p = cellPos(hover); drawStack(p.x, p.y, drag.stack, 0.45, false); }
    }

    // popping tiles (cleared)
    for (let i = poppers.length - 1; i >= 0; i--) {
      const pp = poppers[i], k = (t - pp.t0) / pp.dur;
      if (k >= 1) { poppers.splice(i, 1); continue; }
      const p = cellPos(pp.cell);
      drawTile(p.x, p.y - pp.h * th - k * s * 0.8, pp.color, 1 + k * 0.5, 1 - k);
    }

    // flying tiles
    for (const f of flyers) {
      const k = Math.min(1, (t - f.t0) / f.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const a = cellPos(f.from), b = cellPos(f.to);
      const x = a.x + (b.x - a.x) * e;
      const y = (a.y - f.h0 * th) + ((b.y - f.h1 * th) - (a.y - f.h0 * th)) * e - Math.sin(Math.PI * k) * s * 1.1;
      drawTile(x, y, f.color);
    }

    // tray
    const tw = Math.min(L.w - 4, (L.slots[2].x - L.slots[0].x) + 3.2 * s);
    const tx = L.cx - tw / 2, ty = L.trayY - 2.0 * s, thh = 2.9 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(tx, ty, tw, thh, s * 0.5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const sl = L.slots[i];
      hexPath(sl.x, sl.y, s * 0.95);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
      if (tray[i] && !(drag && drag.slot === i) && !(autoMove && autoMove.slot === i)) {
        drawStack(sl.x, sl.y, tray[i]);
      }
    }

    // floating score text
    for (let i = floaters.length - 1; i >= 0; i--) {
      const fl = floaters[i], k = (t - fl.t0) / 1100;
      if (k >= 1) { floaters.splice(i, 1); continue; }
      const p = cellPos(fl.cell);
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `900 ${Math.round(s * 0.8)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = s * 0.14; ctx.strokeStyle = 'rgba(20,10,40,0.7)';
      ctx.strokeText(fl.text, p.x, p.y - s * 1.2 - k * s * 1.5);
      ctx.fillStyle = '#ffe28a'; ctx.fillText(fl.text, p.x, p.y - s * 1.2 - k * s * 1.5);
      ctx.globalAlpha = 1;
    }

    // dragged stack
    if (drag) drawStack(drag.x, drag.y, drag.stack, 0.95);
    if (autoMove) drawStack(autoMove.x, autoMove.y, autoMove.stack);

    if (DEBUG) drawPaletteColumn();

    requestAnimationFrame(render);
  }

  // Debug: every palette color as a numbered tile, stacked down the left edge of the whole
  // window, drawn on its own overlay canvas above everything else.
  let dbgCanvas = null, dbgScale = 1;
  // Push the whole game to the right of the column, then re-layout the board. Palette tiles
  // fit the window height but are never bigger than game tiles; since the game tile size
  // depends on the space left, repeat until the column width settles.
  function debugLayout() {
    const fit = window.innerHeight / PALETTE.length / 1.1;
    for (let i = 0; i < 5; i++) {
      dbgScale = Math.min(1, fit / (L.s * (TILE_R * SQ3 * Y_SCALE + TILE_H)));
      const pad = Math.ceil(2 * L.s * TILE_R * dbgScale + 16) + 'px';
      if (document.body.style.paddingLeft === pad) break;
      document.body.style.paddingLeft = pad;
      resize();
    }
  }
  function drawPaletteColumn() {
    const W = window.innerWidth, H = window.innerHeight;
    if (dbgCanvas.width !== Math.round(W * L.dpr) || dbgCanvas.height !== Math.round(H * L.dpr)) {
      dbgCanvas.width = Math.round(W * L.dpr); dbgCanvas.height = Math.round(H * L.dpr);
    }
    const mainCtx = ctx, mainK = flatK, mainY = yScale;
    ctx = dbgCanvas.getContext('2d');
    flatK = 1; yScale = Y_SCALE;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const n = PALETTE.length, scale = dbgScale;
    const r = L.s * TILE_R * scale, th = L.s * TILE_H * scale;
    const cellH = 1.1 * (r * SQ3 * Y_SCALE + th);
    const x = 8 + r;
    ctx.font = `800 ${Math.round(r * 0.6)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const y = (i + 0.5) * cellH + th / 2;
      drawTile(x, y, i, scale);
      ctx.lineWidth = Math.max(2, r * 0.1); ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.strokeText(String(i + 1), x, y - th + 1);
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), x, y - th + 1);
    }
    ctx = mainCtx; flatK = mainK; yScale = mainY;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Input ----------
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function cellAt(x, y) {
    let bestC = null, bestD = Infinity;
    for (const c of cells) {
      const p = cellPos(c);
      const dx = x - p.x, dy = (y - p.y) / yScale;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    return bestD < L.s * 0.95 ? bestC : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!started || over || drag || auto || autoMove) return;
    const p = pointerPos(e);
    const th = L.s * TILE_H * flatK;
    for (let i = 0; i < 3; i++) {
      if (!tray[i]) continue;
      const sl = L.slots[i];
      const h = tray[i].length * th;
      if (Math.abs(p.x - sl.x) < L.s * 1.1 && p.y > sl.y - h - L.s * 0.9 && p.y < sl.y + L.s * 0.9) {
        const lift = e.pointerType === 'touch' ? L.s * 1.4 : 0;
        drag = { slot: i, stack: tray[i], ox: sl.x - p.x, oy: sl.y - p.y - lift, x: sl.x, y: sl.y - lift };
        canvas.setPointerCapture(e.pointerId);
        updateHover();
        e.preventDefault();
        return;
      }
    }
  });

  function updateHover() {
    const c = drag ? cellAt(drag.x, drag.y) : null;
    hover = c && !c.blocked && c.stack.length === 0 ? c : null;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pointerPos(e);
    drag.x = p.x + drag.ox; drag.y = p.y + drag.oy;
    updateHover();
  });

  function endDrag() {
    if (!drag) return;
    updateHover();
    if (hover && !over) {
      const stack = drag.stack;
      tray[drag.slot] = null;
      const target = hover;
      drag = null; hover = null;
      refillTray();
      place(target, stack);
    } else {
      drag = null; hover = null;
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; hover = null; });

  document.getElementById('newGame').addEventListener('click', () => openModePicker('new'));
  autoBtn.addEventListener('click', () => setAuto(!auto));
  tiltBtn.addEventListener('click', () => {
    tiltOnDrag = !tiltOnDrag;
    tiltBtn.classList.toggle('on', tiltOnDrag);
    tiltBtn.setAttribute('aria-pressed', String(tiltOnDrag));
  });
  const clearBestOverlay = document.getElementById('clearBestOverlay');
  document.getElementById('bestStat').addEventListener('click', () => clearBestOverlay.classList.remove('hidden'));
  document.getElementById('clearBestNo').addEventListener('click', () => clearBestOverlay.classList.add('hidden'));
  document.getElementById('clearBestYes').addEventListener('click', () => {
    best = 0; saveBest();
    bestEl.textContent = best;
    clearBestOverlay.classList.add('hidden');
  });
  for (const [k, b] of Object.entries(modeBtns)) b.addEventListener('click', () => startMode(k));
  window.addEventListener('resize', resize);

  // ---------- Boot ----------
  buildBoard();
  bestEl.textContent = best;
  resize();
  requestAnimationFrame(render);
  openModePicker('start');

  // ?debug=1: sliders for tuning tilt and tile thickness live.
  if (DEBUG) {
    dbgCanvas = document.createElement('canvas');
    dbgCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:98;pointer-events:none';
    document.body.append(dbgCanvas);
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99;padding:6px 10px;' +
      'background:rgba(0,0,0,.75);color:#fff;font:12px monospace;border-radius:6px';
    const slider = (label, min, max, get, set, step = 0.01) => {
      const fmt = (v) => (step < 1 ? v.toFixed(2) : String(v));
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px';
      const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: get() });
      const out = document.createElement('span');
      out.textContent = fmt(get());
      input.addEventListener('input', () => { set(+input.value); out.textContent = fmt(get()); debugLayout(); });
      row.append(label, input, out);
      panel.append(row);
    };
    slider('Y_SCALE', 0.4, 1, () => Y_SCALE, (v) => { Y_SCALE = v; });
    slider('TILE_H ', 0.05, 0.4, () => TILE_H, (v) => { TILE_H = v; });
    slider('FADE   ', 0, 1, () => FADE_ALPHA, (v) => { FADE_ALPHA = v; });
    slider('COLORS ', 1, PALETTE.length, activeColors, (v) => { debugColors = v; }, 1);
    document.body.append(panel);
    window.addEventListener('resize', debugLayout);
    debugLayout();
  }

  // Small debug/test hook.
  window.__game = {
    get cells() { return cells; }, get tray() { return tray; }, get score() { return score; },
    get busy() { return busy; }, get over() { return over; },
    bestMove, setAuto,
    cell: (q, r) => cellMap.get(q + ',' + r),
    place: (q, r, stack) => place(cellMap.get(q + ',' + r), stack),
    cellScreenPos: (q, r) => cellPos(cellMap.get(q + ',' + r)),
    slotScreenPos: (i) => L.slots[i],
  };
})();
