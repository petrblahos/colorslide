/* Colorslide – a hex stack sorting puzzle. Everything is drawn on a canvas, no external assets. */
(() => {
  'use strict';

  // ---------- Constants ----------
  const RADIUS = 2;            // hex board radius (19 cells, 5 across)
  const CLEAR_AT = 10;         // tiles of one color needed to clear
  const Y_SCALE = 0.72;        // vertical squash for a tilted look
  const TILE_H = 0.17;         // tile thickness relative to hex size
  const TILE_R = 0.9;          // tile radius relative to cell size
  const CORNER_ROUND = 0.2;    // hexagon corner rounding relative to radius
  const FLY_MS = 260;          // tile flight duration
  const STAGGER_MS = 60;       // delay between tiles in a transfer
  const POP_MS = 320;
  const SQ3 = Math.sqrt(3);
  const PALETTE = ['#ff5d73', '#4cc9f0', '#ffd23f', '#6be08a', '#9b7bff', '#ff9a3c', '#f36bd6'];
  const START_COLORS = 3;
  const POINTS_PER_COLOR = 120;
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const BEST_KEY = 'colorslide.best';

  // ---------- DOM ----------
  const canvas = document.getElementById('board');
  let ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas'); // offscreen layer for faded stacks
  const layerCtx = layer.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const startOverlay = document.getElementById('startOverlay');
  const overOverlay = document.getElementById('overOverlay');
  const finalScoreEl = document.getElementById('finalScore');

  // ---------- State ----------
  let cells = [], cellMap = new Map(), drawOrder = [];
  let tray = [null, null, null];
  let score = 0, best = loadBest();
  let busy = false, over = false, started = false, gen = 0;
  let flyers = [], poppers = [], floaters = [];
  let drag = null, hover = null;
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
  const SHADES = PALETTE.map((c) => ({ base: c, light: shade(c, 0.35), dark: shade(c, -0.38), edge: shade(c, -0.55) }));

  // ---------- Board ----------
  function buildBoard() {
    cells = []; cellMap = new Map();
    for (let q = -RADIUS; q <= RADIUS; q++) {
      for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) {
        const c = { q, r, blocked: false, stack: [] };
        cells.push(c); cellMap.set(q + ',' + r, c);
      }
    }
    // a few random blocked cells (never the center)
    const nBlocked = randInt(0, 2);
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

  function activeColors() {
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
    tray = [null, null, null];
    score = 0; busy = false; over = false; started = true;
    flyers = []; poppers = []; floaters = [];
    drag = null; hover = null;
    refillTray();
    updateScore(false);
    startOverlay.classList.add('hidden');
    overOverlay.classList.add('hidden');
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
    setTimeout(() => overOverlay.classList.remove('hidden'), 400);
  }

  function place(cell, stack) {
    cell.stack = stack.slice();
    resolve(cell);
  }

  // Move `n` tiles one by one from `from` to `to` with a flight animation.
  function transfer(from, to, n, token) {
    return new Promise((res) => {
      let landed = 0;
      const base = to.stack.length;
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          if (token !== gen) return;
          const color = from.stack.pop();
          flyers.push({
            color, from, to, h0: from.stack.length, h1: base + i, t0: now(),
            land() { to.stack.push(color); if (++landed === n) res(); },
          });
        }, i * STAGGER_MS);
      }
    });
  }

  function clearTop(cell, n, token) {
    return new Promise((res) => {
      let done = 0;
      for (let i = 0; i < n; i++) {
        setTimeout(() => {
          if (token !== gen) return;
          const color = cell.stack.pop();
          poppers.push({ color, cell, h: cell.stack.length, t0: now() });
          if (++done === n) setTimeout(res, POP_MS * 0.6);
        }, i * 35);
      }
    });
  }

  async function resolve(start) {
    const token = gen;
    busy = true;
    const queue = [start];
    const enqueue = (c, front) => {
      const i = queue.indexOf(c);
      if (i >= 0) queue.splice(i, 1);
      if (front) queue.unshift(c); else queue.push(c);
    };
    let combo = 0, guard = 0;
    while (queue.length && guard++ < 500) {
      const c = queue.shift();
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
    refillTray();
    checkGameOver();
  }

  // ---------- Layout ----------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    L.dpr = window.devicePixelRatio || 1;
    L.w = rect.width; L.h = rect.height;
    canvas.width = Math.round(L.w * L.dpr);
    canvas.height = Math.round(L.h * L.dpr);
    layer.width = canvas.width; layer.height = canvas.height;
    const halfBoard = RADIUS * SQ3 * Y_SCALE + SQ3 / 2 * Y_SCALE; // in units of s
    const totalH = 1.6 + 2 * halfBoard + 1.0 + 2.6 + 0.6;
    const s = Math.max(8, Math.min(L.w / (RADIUS * 3 + 3.4), L.h / totalH));
    L.s = s;
    const used = totalH * s;
    const top0 = (L.h - used) / 2;
    L.cx = L.w / 2;
    L.cy = top0 + 1.6 * s + halfBoard * s;
    L.trayY = L.cy + halfBoard * s + 1.0 * s + 2.0 * s;
    const gap = Math.min(L.w / 3.2, 3.6 * s);
    L.slots = [-1, 0, 1].map((i) => ({ x: L.cx + i * gap, y: L.trayY }));
  }

  function cellPos(c) {
    return { x: L.cx + L.s * 1.5 * c.q, y: L.cy + L.s * SQ3 * (c.r + c.q / 2) * Y_SCALE };
  }

  // ---------- Drawing ----------
  // Hexagon outline with rounded corners (corner radius is a fraction of r).
  function hexPath(x, y, r, rot = 0, round = CORNER_ROUND) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i + rot;
      pts.push([x + r * Math.cos(a), y + r * Math.sin(a) * Y_SCALE]);
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
    const s = L.s, r = s * TILE_R * scale, th = s * TILE_H * scale;
    const sh = SHADES[color];
    ctx.globalAlpha = alpha;
    // side band
    hexPath(x, y + th, r);
    ctx.fillStyle = sh.dark; ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.03); ctx.strokeStyle = sh.edge; ctx.stroke();
    // top face
    hexPath(x, y, r);
    const g = ctx.createLinearGradient(x, y - r * Y_SCALE, x, y + r * Y_SCALE);
    g.addColorStop(0, sh.light); g.addColorStop(1, sh.base);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, s * 0.025); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawStack(x, y, stack, alpha = 1, label = true) {
    const th = L.s * TILE_H;
    for (let i = 0; i < stack.length; i++) drawTile(x, y - i * th, stack[i], 1, alpha);
    if (label && stack.length > 1) {
      const ty = y - (stack.length - 1) * th;
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
    if (c.blocked) {
      // light gray slab so disabled cells stand out against the dark board
      hexPath(p.x, p.y + s * 0.12, s * 0.92); ctx.fillStyle = '#7d808c'; ctx.fill();
      hexPath(p.x, p.y, s * 0.92);
      const g = ctx.createLinearGradient(p.x, p.y - s, p.x, p.y + s);
      g.addColorStop(0, '#e4e5ea'); g.addColorStop(1, '#b9bbc4');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = Math.max(1, s * 0.03); ctx.stroke();
      // cross mark
      const k = s * 0.28;
      ctx.strokeStyle = 'rgba(70,74,90,0.55)'; ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - k, p.y - k * Y_SCALE); ctx.lineTo(p.x + k, p.y + k * Y_SCALE);
      ctx.moveTo(p.x + k, p.y - k * Y_SCALE); ctx.lineTo(p.x - k, p.y + k * Y_SCALE);
      ctx.stroke(); ctx.lineCap = 'butt';
      return;
    }
    hexPath(p.x, p.y, s * 0.95);
    ctx.fillStyle = highlighted ? 'rgba(255,210,120,0.35)' : 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = highlighted ? 'rgba(255,210,120,0.9)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.stroke();
  }

  function drawPlatform() {
    const s = L.s;
    hexPath(L.cx, L.cy + s * 0.3, s * (RADIUS * 1.5 + 1.1) / Math.cos(Math.PI / 6), Math.PI / 6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    hexPath(L.cx, L.cy, s * (RADIUS * 1.5 + 1.1) / Math.cos(Math.PI / 6), Math.PI / 6);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
  }

  function render() {
    const t = now();
    const s = L.s, th = s * TILE_H;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);

    drawPlatform();

    // advance flyers first so landing tiles are in stacks before drawing
    for (let i = flyers.length - 1; i >= 0; i--) {
      if (t - flyers[i].t0 >= FLY_MS) { const f = flyers[i]; flyers.splice(i, 1); f.land(); }
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
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      for (const c of drawOrder) {
        if (c.blocked || c.stack.length) continue;
        const p = cellPos(c), on = c === hover;
        hexPath(p.x, p.y, s * 0.95);
        ctx.strokeStyle = on ? 'rgba(255,210,120,0.95)' : 'rgba(255,255,255,0.6)';
        ctx.lineWidth = Math.max(1.5, s * (on ? 0.07 : 0.045));
        ctx.stroke();
      }
      if (hover) { const p = cellPos(hover); drawStack(p.x, p.y, drag.stack, 0.45, false); }
    }

    // popping tiles (cleared)
    for (let i = poppers.length - 1; i >= 0; i--) {
      const pp = poppers[i], k = (t - pp.t0) / POP_MS;
      if (k >= 1) { poppers.splice(i, 1); continue; }
      const p = cellPos(pp.cell);
      drawTile(p.x, p.y - pp.h * th - k * s * 0.8, pp.color, 1 + k * 0.5, 1 - k);
    }

    // flying tiles
    for (const f of flyers) {
      const k = Math.min(1, (t - f.t0) / FLY_MS);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const a = cellPos(f.from), b = cellPos(f.to);
      const x = a.x + (b.x - a.x) * e;
      const y = (a.y - f.h0 * th) + ((b.y - f.h1 * th) - (a.y - f.h0 * th)) * e - Math.sin(Math.PI * k) * s * 1.1;
      drawTile(x, y, f.color);
    }

    // tray
    const tw = Math.min(L.w - 16, (L.slots[2].x - L.slots[0].x) + 3.2 * s);
    const tx = L.cx - tw / 2, ty = L.trayY - 2.0 * s, thh = 2.9 * s;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(tx, ty, tw, thh, s * 0.5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const sl = L.slots[i];
      hexPath(sl.x, sl.y, s * 0.95);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fill();
      if (tray[i] && !(drag && drag.slot === i)) {
        drawStack(sl.x, sl.y, tray[i], busy ? 0.6 : 1);
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

    requestAnimationFrame(render);
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
      const dx = x - p.x, dy = (y - p.y) / Y_SCALE;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    return bestD < L.s * 0.95 ? bestC : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!started || busy || over || drag) return;
    const p = pointerPos(e);
    const th = L.s * TILE_H;
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
    if (hover && !busy && !over) {
      const stack = drag.stack;
      tray[drag.slot] = null;
      const target = hover;
      drag = null; hover = null;
      place(target, stack);
    } else {
      drag = null; hover = null;
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag = null; hover = null; });

  document.getElementById('newGame').addEventListener('click', newGame);
  document.getElementById('startBtn').addEventListener('click', newGame);
  document.getElementById('againBtn').addEventListener('click', newGame);
  window.addEventListener('resize', resize);

  // ---------- Boot ----------
  buildBoard();
  bestEl.textContent = best;
  resize();
  requestAnimationFrame(render);

  // Small debug/test hook.
  window.__game = {
    get cells() { return cells; }, get tray() { return tray; }, get score() { return score; },
    get busy() { return busy; }, get over() { return over; },
    cell: (q, r) => cellMap.get(q + ',' + r),
    place: (q, r, stack) => place(cellMap.get(q + ',' + r), stack),
    cellScreenPos: (q, r) => cellPos(cellMap.get(q + ',' + r)),
    slotScreenPos: (i) => L.slots[i],
  };
})();
