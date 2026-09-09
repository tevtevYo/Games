/* ==========================================================================
   SUPER PLUMBER BROS  -  a Mario-style platformer in plain HTML5 Canvas + JS
   --------------------------------------------------------------------------
   Files: index.html (page + HUD), style.css (layout), game.js (everything else)
   No build step, no dependencies. Open index.html in a browser and play.
   ========================================================================== */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TILE = 32;                 // size of one tile in pixels
const VIEW_W = 800;              // canvas width
const VIEW_H = 480;              // canvas height
const LEVEL_W = 224;             // level width in tiles
const LEVEL_H = 15;              // level height in tiles
const GRAVITY = 1900;            // px / s^2
const MAX_FALL = 720;            // terminal velocity
const LEVEL_TIME = 400;          // seconds on the clock
const SMALL_H = 36;              // player height (px) when small
const BIG_H = 60;                // player height (px) after a mushroom

const PLAYER = {
  walkSpeed: 190,
  runSpeed: 300,
  accel: 1100,
  airAccel: 800,
  friction: 1300,
  jumpVel: -745,        // clears ~4.5 tiles standing
  runJumpBonus: -85,    // ~5.7 tiles at full run
  jumpCut: 0.45,        // multiply vy by this when jump is released early
  jumpBuffer: 0.15,     // seconds a jump press is remembered before landing
  coyoteTime: 0.1,      // seconds after leaving a ledge you can still jump
};

// Tile legend --------------------------------------------------------------
// ' ' empty     '#' ground     'B' brick       '?' question (coin)
// 'M' question (mushroom)      'U' used block  'X' stair block
// 'P','Q' pipe top-left/right  'p','q' pipe body left/right
// 'o' coin      'F' flag pole  '^' pole top
const SOLID = new Set(['#', 'B', '?', 'M', 'U', 'X', 'P', 'Q', 'p', 'q']);

// ---------------------------------------------------------------------------
// Tiny sound synthesizer (WebAudio) - no audio files needed
// ---------------------------------------------------------------------------
const Sound = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  }
  function tone(freq, dur, type = 'square', vol = 0.08, slideTo = null, delay = 0) {
    try {
      ensure();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t0 = ctx.currentTime + delay;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio not available - ignore */ }
  }
  return {
    unlock: ensure,
    jump: () => tone(300, 0.18, 'square', 0.07, 700),
    coin: () => { tone(988, 0.08, 'square', 0.07); tone(1319, 0.25, 'square', 0.07, null, 0.08); },
    stomp: () => tone(220, 0.12, 'square', 0.08, 90),
    bump: () => tone(140, 0.08, 'triangle', 0.1, 100),
    breakBrick: () => { tone(200, 0.1, 'sawtooth', 0.07, 60); tone(500, 0.08, 'square', 0.04, 200, 0.03); },
    powerup: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.12, 'square', 0.06, null, i * 0.06)); },
    powerupAppear: () => { [392, 523, 659].forEach((f, i) => tone(f, 0.1, 'square', 0.05, null, i * 0.05)); },
    hurt: () => tone(400, 0.3, 'sawtooth', 0.07, 100),
    fire: () => tone(900, 0.09, 'square', 0.06, 250),
    die: () => { [660, 520, 400, 300, 200].forEach((f, i) => tone(f, 0.2, 'square', 0.07, null, i * 0.15)); },
    flag: () => { [523, 587, 659, 698, 784, 880, 988, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.06, null, i * 0.07)); },
    win: () => { [784, 784, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.18, 'square', 0.07, null, i * 0.13)); },
    oneUp: () => { [659, 784, 1319, 1047, 1175, 1568].forEach((f, i) => tone(f, 0.1, 'square', 0.06, null, i * 0.07)); },
  };
})();

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
function buildLevel() {
  const grid = Array.from({ length: LEVEL_H }, () => Array(LEVEL_W).fill(' '));
  const enemies = [];
  const set = (x, y, c) => { if (x >= 0 && x < LEVEL_W && y >= 0 && y < LEVEL_H) grid[y][x] = c; };
  const ground = (x0, x1) => { for (let x = x0; x <= x1; x++) { set(x, 13, '#'); set(x, 14, '#'); } };
  const row = (x0, x1, y, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); };
  const pipe = (x, h) => {
    const top = 13 - h;
    set(x, top, 'P'); set(x + 1, top, 'Q');
    for (let y = top + 1; y < 13; y++) { set(x, y, 'p'); set(x + 1, y, 'q'); }
  };
  const stairsUp = (x, h) => { for (let i = 0; i < h; i++) for (let j = 0; j <= i; j++) set(x + i, 12 - j, 'X'); };
  const stairsDown = (x, h) => { for (let i = 0; i < h; i++) for (let j = 0; j < h - i; j++) set(x + i, 12 - j, 'X'); };
  const goomba = (x) => enemies.push({ type: 'goomba', x: x * TILE + 2, y: 12 * TILE + 4 });
  const koopa = (x) => enemies.push({ type: 'koopa', x: x * TILE + 2, y: 11 * TILE + 8 });

  // ---- Ground segments (gaps between them are pits) ----
  ground(0, 68);
  ground(71, 85);
  ground(89, 152);
  ground(155, 223);

  // ---- Section 1: intro ----
  set(16, 9, '?');
  row(20, 24, 9, 'B'); set(21, 9, '?'); set(22, 9, 'M'); set(23, 9, '?');
  set(22, 5, '?');
  goomba(22);
  pipe(28, 2);
  pipe(38, 3);
  goomba(40);
  pipe(46, 4);
  row(48, 50, 6, 'o');
  goomba(51); goomba(53);
  pipe(57, 4);
  row(62, 66, 9, 'B'); set(64, 9, '?');
  koopa(66);

  // ---- Section 2: across the first pit ----
  row(72, 74, 9, 'o');
  row(77, 79, 9, 'B'); set(78, 9, 'M');
  row(75, 82, 5, 'B'); set(78, 5, 'U');
  goomba(80);
  row(83, 85, 6, 'o');

  // ---- Section 3: bricks and coins ----
  row(91, 93, 5, 'B'); set(94, 5, '?'); set(94, 9, 'B');
  goomba(97); goomba(99);
  row(100, 101, 9, 'B'); set(102, 9, '?'); set(103, 9, '?'); set(104, 9, '?');
  row(101, 103, 5, 'o');
  set(106, 9, 'B'); set(106, 5, 'M');
  row(108, 110, 5, 'B'); row(111, 112, 9, 'B'); set(110, 9, '?');
  koopa(112);
  goomba(114); goomba(116);
  row(118, 121, 9, 'B'); set(119, 9, '?'); set(120, 9, '?');
  row(118, 121, 5, 'B');
  row(124, 128, 8, 'o');
  goomba(130);
  stairsUp(134, 4);
  row(135, 138, 4, 'o');
  stairsDown(140, 4);
  pipe(146, 2);
  goomba(149);

  // ---- Section 4: the big stairs and the flag ----
  row(157, 159, 9, 'o');
  stairsUp(160, 4); stairsDown(165, 4);
  goomba(170); goomba(172); koopa(176);
  row(174, 176, 9, 'B'); set(175, 9, '?'); set(175, 5, 'M');
  pipe(180, 2);
  goomba(184);
  stairsUp(188, 8);
  row(190, 194, 3, 'o');
  set(198, 12, 'X');
  for (let y = 4; y <= 11; y++) set(198, y, 'F');
  set(198, 3, '^');

  return {
    grid,
    enemies,
    flagX: 198,
    castleX: 206,
    playerStart: { x: 3 * TILE, y: 12 * TILE },
  };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const hud = {
  score: document.getElementById('hud-score'),
  coins: document.getElementById('hud-coins'),
  world: document.getElementById('hud-world'),
  time: document.getElementById('hud-time'),
  lives: document.getElementById('hud-lives'),
};

const keys = {};
const G = {
  state: 'title',      // title | playing | dying | flag | win | gameover
  level: null,
  player: null,
  enemies: [],
  items: [],
  fireballs: [],
  particles: [],
  popups: [],
  bumps: [],           // block bump animations {tx, ty, t}
  camX: 0,
  score: 0,
  coins: 0,
  lives: 3,
  time: LEVEL_TIME,
  timeAcc: 0,
  stateTimer: 0,
  flagY: 4 * TILE,
  elapsed: 0,
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
function makePlayer(x, y) {
  return {
    x, y, w: 24, h: SMALL_H,
    vx: 0, vy: 0,
    onGround: false,
    facing: 1,
    big: false,
    fire: false,
    fireHeld: false,
    invincible: 0,
    jumpHeld: false,
    jumpBufferT: 0,
    coyoteT: 0,
    animT: 0,
    growT: 0,
  };
}

function makeEnemy(spec) {
  if (spec.type === 'goomba') {
    return { type: 'goomba', x: spec.x, y: spec.y, w: 28, h: 28, vx: -55, vy: 0, alive: true, squashT: 0, active: false, animT: 0 };
  }
  return { type: 'koopa', x: spec.x, y: spec.y, w: 28, h: 40, vx: -50, vy: 0, alive: true, active: false, animT: 0, shell: false, shellMoving: false, kickCooldown: 0 };
}

function makeMushroom(tx, ty, kind) {
  // kind: 'mushroom' (grow) or 'firemushroom' (grow + fireballs)
  return { type: kind || 'mushroom', x: tx * TILE + 2, y: ty * TILE, w: 28, h: 28, vx: 0, vy: 0, emerging: 1, targetY: (ty - 1) * TILE + 4 };
}

function makeCoinPop(tx, ty) {
  return { type: 'coinpop', x: tx * TILE + 8, y: ty * TILE - 4, vy: -420, t: 0 };
}

function popup(x, y, text) {
  G.popups.push({ x, y, text, t: 0 });
}

function addScore(n, x, y) {
  G.score += n;
  if (x !== undefined) popup(x, y, String(n));
}

function addCoin() {
  G.coins++;
  Sound.coin();
  if (G.coins >= 100) { G.coins -= 100; G.lives++; Sound.oneUp(); }
}

// ---------------------------------------------------------------------------
// Level / round management
// ---------------------------------------------------------------------------
function startGame() {
  G.score = 0;
  G.coins = 0;
  G.lives = 3;
  startRound();
}

function startRound() {
  G.level = buildLevel();
  G.player = makePlayer(G.level.playerStart.x, G.level.playerStart.y);
  G.enemies = G.level.enemies.map(makeEnemy);
  G.items = [];
  G.fireballs = [];
  G.particles = [];
  G.popups = [];
  G.bumps = [];
  G.camX = 0;
  G.time = LEVEL_TIME;
  G.timeAcc = 0;
  G.flagY = 4 * TILE;
  G.state = 'playing';
  overlay.classList.add('hidden');
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  // On touch devices the prompt says "Tap" instead of naming keys
  overlayText.textContent = TouchControls.enabled ? text.replace(/Press ENTER( or SPACE)?/, 'Tap') : text;
  overlay.classList.remove('hidden');
}

function killPlayer() {
  if (G.state !== 'playing') return;
  const p = G.player;
  G.state = 'dying';
  G.stateTimer = 0;
  p.vy = -520;
  p.vx = 0;
  p.big = false;
  p.fire = false;
  p.h = SMALL_H;
  Sound.die();
}

function hurtPlayer() {
  const p = G.player;
  if (p.invincible > 0) return;
  if (p.big) {
    p.big = false;
    p.fire = false;
    p.y += BIG_H - SMALL_H;
    p.h = SMALL_H;
    p.invincible = 2;
    Sound.hurt();
  } else {
    killPlayer();
  }
}

function afterDeath() {
  G.lives--;
  if (G.lives <= 0) {
    G.state = 'gameover';
    showOverlay('GAME OVER', `Final score ${G.score}  -  Press ENTER to try again`);
  } else {
    startRound();
  }
}

// ---------------------------------------------------------------------------
// Tile helpers
// ---------------------------------------------------------------------------
function tileAt(tx, ty) {
  if (tx < 0) return '#';                 // left wall of the world
  if (tx >= LEVEL_W || ty < 0 || ty >= LEVEL_H) return ' ';
  return G.level.grid[ty][tx];
}
function isSolid(tx, ty) { return SOLID.has(tileAt(tx, ty)); }
function setTile(tx, ty, c) { if (tx >= 0 && tx < LEVEL_W && ty >= 0 && ty < LEVEL_H) G.level.grid[ty][tx] = c; }

// Move an axis-aligned box through the tile grid, resolving collisions.
// Returns which sides were hit.
function moveBox(e, dt) {
  const hit = { left: false, right: false, top: false, bottom: false, topTile: null };

  // Horizontal
  e.x += e.vx * dt;
  let x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 1) / TILE);
  let y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    if (e.vx > 0 && isSolid(x1, ty)) { e.x = x1 * TILE - e.w; hit.right = true; }
    else if (e.vx < 0 && isSolid(x0, ty)) { e.x = (x0 + 1) * TILE; hit.left = true; }
  }

  // Vertical
  e.y += e.vy * dt;
  x0 = Math.floor(e.x / TILE); x1 = Math.floor((e.x + e.w - 1) / TILE);
  y0 = Math.floor(e.y / TILE);
  if (e.vy >= 0) {
    // Include the row touching the bottom edge, so an entity resting exactly on
    // a tile counts as grounded every frame (no need to sink into the floor first).
    y1 = Math.floor((e.y + e.h) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(tx, y1)) { e.y = y1 * TILE - e.h; hit.bottom = true; break; }
    }
  } else {
    // Pick the solid tile above whose center is closest to the box center
    let best = null, bestD = Infinity;
    const cx = e.x + e.w / 2;
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(tx, y0)) {
        const d = Math.abs((tx + 0.5) * TILE - cx);
        if (d < bestD) { bestD = d; best = tx; }
      }
    }
    if (best !== null) { e.y = (y0 + 1) * TILE; hit.top = true; hit.topTile = { tx: best, ty: y0 }; }
  }
  return hit;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------------------------------------------------------------------------
// Block interaction
// ---------------------------------------------------------------------------
function hitBlockFromBelow(tx, ty) {
  const t = tileAt(tx, ty);
  const p = G.player;
  if (t === '?' || t === 'M') {
    setTile(tx, ty, 'U');
    G.bumps.push({ tx, ty, t: 0 });
    // Every question block releases a mushroom: half the time the normal one
    // (grow, smash bricks), half the time the fire one (grow + fireballs).
    G.items.push(makeMushroom(tx, ty, Math.random() < 0.5 ? 'firemushroom' : 'mushroom'));
    Sound.powerupAppear();
    bumpEnemiesOn(tx, ty);
  } else if (t === 'B') {
    if (p.big) {
      setTile(tx, ty, ' ');
      spawnBrickShards(tx, ty);
      addScore(50);
      Sound.breakBrick();
    } else {
      G.bumps.push({ tx, ty, t: 0 });
      Sound.bump();
    }
    bumpEnemiesOn(tx, ty);
  } else {
    Sound.bump();
  }
}

function bumpEnemiesOn(tx, ty) {
  const bx = tx * TILE, by = ty * TILE;
  for (const e of G.enemies) {
    if (!e.alive) continue;
    const onTop = Math.abs(e.y + e.h - by) < 4 && e.x + e.w > bx && e.x < bx + TILE;
    if (onTop) { e.alive = false; e.vy = -300; e.flipped = true; addScore(100, e.x, e.y); }
  }
}

function spawnBrickShards(tx, ty) {
  const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
  const dirs = [[-120, -420], [120, -420], [-80, -260], [80, -260]];
  for (const [vx, vy] of dirs) G.particles.push({ x: cx, y: cy, vx, vy, t: 0, life: 1.5, color: '#c8542c', size: 10 });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt) {
  G.elapsed += dt;
  TouchControls.setFireMode(!!(G.player && G.player.fire));
  for (const b of G.bumps) b.t += dt;
  G.bumps = G.bumps.filter(b => b.t < 0.25);

  if (G.state === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateItems(dt);
    updateFireballs(dt);
    updateTimer(dt);
    updateCamera(dt);
  } else if (G.state === 'dying') {
    const p = G.player;
    G.stateTimer += dt;
    if (G.stateTimer > 0.4) { p.vy += GRAVITY * dt; p.y += p.vy * dt; }
    if (G.stateTimer > 2.6) afterDeath();
  } else if (G.state === 'flag') {
    updateFlagSequence(dt);
  }
  updateParticles(dt);
  updateHud();
}

function updateTimer(dt) {
  G.timeAcc += dt;
  while (G.timeAcc >= 1) {
    G.timeAcc -= 1;
    G.time--;
    if (G.time <= 0) { G.time = 0; killPlayer(); }
  }
}

function updateCamera(dt) {
  // The camera follows in both directions, so you can walk back through the
  // level at any time. The player sits 40% from the left when heading right
  // and 60% when heading left, so you can see where you are going.
  const p = G.player;
  const anchor = p.facing < 0 ? 0.6 : 0.4;
  const target = p.x + p.w / 2 - VIEW_W * anchor;
  G.camX += (target - G.camX) * Math.min(1, dt * 6);
  G.camX = Math.max(0, Math.min(G.camX, LEVEL_W * TILE - VIEW_W));
}

function updatePlayer(dt) {
  const p = G.player;
  const left = keys.ArrowLeft || keys.KeyA;
  const right = keys.ArrowRight || keys.KeyD;
  const jump = keys.ArrowUp || keys.KeyW || keys.Space;
  const run = keys.ShiftLeft || keys.ShiftRight;

  const maxSpeed = run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const accel = p.onGround ? PLAYER.accel : PLAYER.airAccel;
  const dir = (right ? 1 : 0) - (left ? 1 : 0);

  if (dir !== 0) {
    p.vx += dir * accel * dt;
    p.facing = dir;
    // Skidding: turning around while fast is slower
    if (Math.sign(p.vx) !== dir && p.onGround) p.vx += dir * PLAYER.friction * dt;
  } else if (p.onGround) {
    const f = PLAYER.friction * dt;
    if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
  }
  p.vx = Math.max(-maxSpeed, Math.min(maxSpeed, p.vx));

  // Jumping with variable height.
  // A press is buffered so it fires the instant you land, and a short coyote
  // window lets you still jump right after walking off an edge.
  if (jump && !p.jumpHeld) p.jumpBufferT = PLAYER.jumpBuffer;
  p.jumpHeld = jump;
  if (p.onGround) p.coyoteT = PLAYER.coyoteTime;
  if (p.jumpBufferT > 0 && p.coyoteT > 0) {
    p.vy = PLAYER.jumpVel + (Math.abs(p.vx) > PLAYER.walkSpeed ? PLAYER.runJumpBonus : 0);
    p.onGround = false;
    p.jumpBufferT = 0;
    p.coyoteT = 0;
    Sound.jump();
  }
  if (p.jumpBufferT > 0) p.jumpBufferT -= dt;
  if (p.coyoteT > 0) p.coyoteT -= dt;
  if (!jump && p.vy < 0) p.vy *= (1 - (1 - PLAYER.jumpCut) * Math.min(1, dt * 30));

  p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);

  const hit = moveBox(p, dt);
  p.onGround = hit.bottom;
  if (hit.bottom && p.vy > 0) p.vy = 0;
  if (hit.top && p.vy < 0) { p.vy = 0; hitBlockFromBelow(hit.topTile.tx, hit.topTile.ty); }
  if (hit.left || hit.right) p.vx = 0;

  // Fireballs: X (or F) on the keyboard, the FIRE button on touch screens
  const fireKey = keys.KeyX || keys.KeyF;
  if (fireKey && !p.fireHeld) shootFireball();
  p.fireHeld = fireKey;

  if (p.invincible > 0) p.invincible -= dt;
  if (p.growT > 0) p.growT -= dt;
  p.animT += Math.abs(p.vx) * dt / 40;

  // Coins in the tile grid
  const cx0 = Math.floor(p.x / TILE), cx1 = Math.floor((p.x + p.w - 1) / TILE);
  const cy0 = Math.floor(p.y / TILE), cy1 = Math.floor((p.y + p.h - 1) / TILE);
  for (let ty = cy0; ty <= cy1; ty++) for (let tx = cx0; tx <= cx1; tx++) {
    if (tileAt(tx, ty) === 'o') { setTile(tx, ty, ' '); addCoin(); addScore(100, tx * TILE, ty * TILE); }
  }

  // Flag pole
  const flagX = G.level.flagX * TILE;
  if (p.x + p.w > flagX + 8 && p.x < flagX + 24 && p.y < 13 * TILE) {
    G.state = 'flag';
    G.stateTimer = 0;
    p.x = flagX - p.w + 6;
    p.vx = 0; p.vy = 0;
    const heightBonus = Math.max(100, Math.round((12 * TILE - p.y) / TILE) * 500);
    addScore(heightBonus, p.x, p.y);
    Sound.flag();
  }

  // Fell into a pit
  if (p.y > LEVEL_H * TILE + 40) killPlayer();
}

function updateEnemies(dt) {
  const p = G.player;
  for (const e of G.enemies) {
    // Activate when close to the screen
    if (!e.active) {
      if (e.x < G.camX + VIEW_W + 64) e.active = true; else continue;
    }
    if (!e.alive) {
      // Squashed goomba lingers; flipped enemies fall off screen
      if (e.flipped) { e.vy += GRAVITY * dt; e.y += e.vy * dt; e.x += e.vx * dt; }
      else e.squashT += dt;
      continue;
    }

    e.animT += dt;
    e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * dt);
    if (e.kickCooldown > 0) e.kickCooldown -= dt;

    const hit = moveBox(e, dt);
    if (hit.bottom) e.vy = 0;
    if (hit.left) { e.vx = Math.abs(e.vx); if (e.shellMoving) Sound.bump(); }
    if (hit.right) { e.vx = -Math.abs(e.vx); if (e.shellMoving) Sound.bump(); }
    if (e.y > LEVEL_H * TILE + 64) { e.alive = false; e.flipped = true; continue; }

    // Moving shell kills other enemies
    if (e.shellMoving) {
      for (const o of G.enemies) {
        if (o !== e && o.alive && o.active && overlaps(e, o)) {
          o.alive = false; o.flipped = true; o.vy = -300; o.vx = Math.sign(e.vx) * 60;
          addScore(200, o.x, o.y);
          Sound.stomp();
        }
      }
    }

    // Player collision
    if (G.state !== 'playing' || !overlaps(p, e)) continue;
    const stomping = p.vy > 0 && (p.y + p.h) - e.y < 18;

    if (e.type === 'goomba') {
      if (stomping) {
        e.alive = false; e.squashT = 0;
        p.vy = keys.Space || keys.ArrowUp || keys.KeyW ? -480 : -300;
        p.y = e.y - p.h;
        addScore(100, e.x, e.y);
        Sound.stomp();
      } else hurtPlayer();
    } else if (e.type === 'koopa') {
      if (!e.shell) {
        if (stomping) {
          e.shell = true; e.shellMoving = false; e.vx = 0;
          e.y += e.h - 28; e.h = 28;
          e.kickCooldown = 0.3;
          p.vy = -300; p.y = e.y - p.h;
          addScore(100, e.x, e.y);
          Sound.stomp();
        } else hurtPlayer();
      } else if (!e.shellMoving) {
        if (e.kickCooldown <= 0) {
          // Kick the shell away from the player
          e.shellMoving = true;
          e.vx = (p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1) * 320;
          e.kickCooldown = 0.4;
          if (stomping) { p.vy = -300; p.y = e.y - p.h; }
          addScore(400, e.x, e.y);
          Sound.stomp();
        }
      } else {
        if (stomping) {
          e.shellMoving = false; e.vx = 0; e.kickCooldown = 0.4;
          p.vy = -300; p.y = e.y - p.h;
          Sound.stomp();
        } else if (e.kickCooldown <= 0) hurtPlayer();
      }
    }
  }
  G.enemies = G.enemies.filter(e => e.alive || e.flipped ? e.y < LEVEL_H * TILE + 200 : e.squashT < 0.8);
}

function updateItems(dt) {
  const p = G.player;
  for (const it of G.items) {
    if (it.type === 'coinpop') {
      it.t += dt;
      it.vy += GRAVITY * dt;
      it.y += it.vy * dt;
      continue;
    }
    if (it.type === 'mushroom' || it.type === 'firemushroom') {
      if (it.emerging > 0) {
        it.y -= 40 * dt;
        if (it.y <= it.targetY) { it.y = it.targetY; it.emerging = 0; it.vx = 90; }
        continue;
      }
      it.vy = Math.min(MAX_FALL, it.vy + GRAVITY * dt);
      const hit = moveBox(it, dt);
      if (hit.bottom) it.vy = 0;
      if (hit.left) it.vx = Math.abs(it.vx);
      if (hit.right) it.vx = -Math.abs(it.vx);
      if (it.y > LEVEL_H * TILE + 64) it.dead = true;
      if (overlaps(p, it)) {
        it.dead = true;
        if (!p.big) { p.big = true; p.h = BIG_H; p.y -= BIG_H - SMALL_H; p.growT = 0.6; }
        if (it.type === 'firemushroom') p.fire = true;
        addScore(1000, it.x, it.y);
        Sound.powerup();
      }
    }
  }
  G.items = G.items.filter(it => !it.dead && !(it.type === 'coinpop' && it.t > 0.7));
}

// ---------------------------------------------------------------------------
// Fireballs (fire mushroom power): fly in a straight line, kill enemies
// ---------------------------------------------------------------------------
const FIREBALL = { speed: 460, life: 1.4, max: 2, size: 12 };

function shootFireball() {
  const p = G.player;
  if (!p.fire || G.state !== 'playing' || G.fireballs.length >= FIREBALL.max) return;
  const x = p.facing > 0 ? p.x + p.w : p.x - FIREBALL.size;
  const y = p.y + (p.big ? 26 : 14);
  G.fireballs.push({ x, y, w: FIREBALL.size, h: FIREBALL.size, vx: p.facing * FIREBALL.speed, t: 0, spin: 0 });
  Sound.fire();
}

function updateFireballs(dt) {
  for (const f of G.fireballs) {
    f.t += dt;
    f.spin += dt * 20;
    f.x += f.vx * dt;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    const hitWall = isSolid(Math.floor(cx / TILE), Math.floor(cy / TILE));
    const offScreen = f.x < G.camX - 64 || f.x > G.camX + VIEW_W + 64;
    if (f.t > FIREBALL.life || hitWall || offScreen) { f.dead = true; if (hitWall) firePuff(cx, cy); continue; }
    for (const e of G.enemies) {
      if (!e.alive || !e.active || !overlaps(f, e)) continue;
      e.alive = false; e.flipped = true; e.vy = -320; e.vx = Math.sign(f.vx) * 80;
      addScore(200, e.x, e.y);
      Sound.stomp();
      f.dead = true;
      firePuff(cx, cy);
      break;
    }
  }
  G.fireballs = G.fireballs.filter(f => !f.dead);
}

function firePuff(cx, cy) {
  for (let i = 0; i < 4; i++) {
    G.particles.push({ x: cx, y: cy, vx: (i % 2 ? 1 : -1) * (60 + i * 30), vy: -120 - i * 40, t: 0, life: 0.35, color: i % 2 ? '#ffb000' : '#ff5a1f', size: 5 });
  }
}

function drawFireball(f) {
  ctx.save();
  ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
  ctx.rotate(f.spin);
  ctx.fillStyle = '#ff5a1f'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff6c8'; ctx.fillRect(-2, -5, 4, 3);
  ctx.restore();
}

function updateFlagSequence(dt) {
  const p = G.player;
  G.stateTimer += dt;
  const poleBottom = 12 * TILE - p.h;
  if (p.y < poleBottom) {
    p.y = Math.min(poleBottom, p.y + 200 * dt);
    G.flagY = Math.min(11 * TILE, G.flagY + 200 * dt);
    return;
  }
  // Walk to the castle
  const castleDoor = G.level.castleX * TILE + 2 * TILE;
  if (p.x < castleDoor) {
    p.facing = 1;
    p.vx = 120;
    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    const hit = moveBox(p, dt);
    if (hit.bottom) p.vy = 0;
    p.animT += 4 * dt;
    p.onGround = hit.bottom;
    G.camX = Math.min(Math.max(G.camX, p.x - VIEW_W * 0.4), LEVEL_W * TILE - VIEW_W);
    // Count down the timer into score
    if (G.time > 0) { const take = Math.min(G.time, Math.ceil(120 * dt)); G.time -= take; G.score += take * 50; }
    return;
  }
  if (G.time > 0) { G.score += G.time * 50; G.time = 0; }
  G.state = 'win';
  p.hidden = true;
  Sound.win();
  showOverlay('COURSE CLEAR!', `Score ${G.score}  -  Press ENTER to play again`);
}

function updateParticles(dt) {
  for (const s of G.particles) {
    s.t += dt;
    s.vy += GRAVITY * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  G.particles = G.particles.filter(s => s.t < s.life);
  for (const pu of G.popups) { pu.t += dt; pu.y -= 60 * dt; }
  G.popups = G.popups.filter(pu => pu.t < 0.9);
}

function updateHud() {
  hud.score.textContent = 'SCORE ' + String(G.score).padStart(6, '0');
  hud.coins.textContent = 'COINS x' + String(G.coins).padStart(2, '0');
  hud.time.textContent = 'TIME ' + String(G.time).padStart(3, '0');
  hud.lives.textContent = 'LIVES x' + G.lives;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawBackground();
  if (!G.level) return;

  ctx.save();
  ctx.translate(-Math.floor(G.camX), 0);
  drawCastle();
  drawTiles();
  drawFlag();
  for (const it of G.items) drawItem(it);
  for (const f of G.fireballs) drawFireball(f);
  for (const e of G.enemies) drawEnemy(e);
  if (G.player && !G.player.hidden) drawPlayer(G.player);
  for (const s of G.particles) {
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.round(s.x - s.size / 2), Math.round(s.y - s.size / 2), s.size, s.size);
  }
  for (const pu of G.popups) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Courier New';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(pu.text, pu.x, pu.y);
    ctx.fillText(pu.text, pu.x, pu.y);
  }
  ctx.restore();
}

function drawBackground() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#5c94fc');
  sky.addColorStop(1, '#8ec0ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Hills (slow parallax)
  const hx = -(G.camX * 0.3) % 600;
  ctx.fillStyle = '#4caf50';
  for (let i = -1; i < 3; i++) {
    const bx = hx + i * 600;
    hill(bx + 80, 13 * TILE, 140, 90);
    hill(bx + 380, 13 * TILE, 90, 55);
  }
  // Clouds (faster parallax)
  const cxo = -(G.camX * 0.5) % 500;
  for (let i = -1; i < 3; i++) {
    const bx = cxo + i * 500;
    cloud(bx + 60, 70, 1);
    cloud(bx + 280, 130, 0.8);
    cloud(bx + 420, 50, 1.3);
  }
  // Bushes
  const bxo = -(G.camX * 0.9) % 700;
  for (let i = -1; i < 3; i++) {
    const bx = bxo + i * 700;
    bush(bx + 200, 13 * TILE);
    bush(bx + 520, 13 * TILE);
  }
}

function hill(x, baseY, w, h) {
  ctx.fillStyle = '#3d9b45';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY);
  ctx.quadraticCurveTo(x, baseY - h * 2, x + w / 2, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2e7d32';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x - 20 + i * 18, baseY - h * 0.5 + (i % 2) * 14, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cloud(x, y, s) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, 18 * s, 0, Math.PI * 2);
  ctx.arc(x + 22 * s, y - 8 * s, 22 * s, 0, Math.PI * 2);
  ctx.arc(x + 46 * s, y, 18 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e3f0ff';
  ctx.fillRect(x - 18 * s, y + 4 * s, 82 * s, 14 * s);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 18 * s, y, 82 * s, 6 * s);
}

function bush(x, baseY) {
  ctx.fillStyle = '#48b34c';
  ctx.beginPath();
  ctx.arc(x, baseY - 14, 16, 0, Math.PI * 2);
  ctx.arc(x + 22, baseY - 20, 20, 0, Math.PI * 2);
  ctx.arc(x + 46, baseY - 14, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 16, baseY - 14, 78, 14);
}

function drawTiles() {
  const tx0 = Math.max(0, Math.floor(G.camX / TILE));
  const tx1 = Math.min(LEVEL_W - 1, Math.floor((G.camX + VIEW_W) / TILE));
  for (let ty = 0; ty < LEVEL_H; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = G.level.grid[ty][tx];
      if (t === ' ' || t === 'F' || t === '^') continue;
      let oy = 0;
      const bump = G.bumps.find(b => b.tx === tx && b.ty === ty);
      if (bump) oy = -Math.sin(bump.t / 0.25 * Math.PI) * 10;
      drawTile(t, tx * TILE, ty * TILE + oy);
    }
  }
}

function drawTile(t, x, y) {
  switch (t) {
    case '#':
      ctx.fillStyle = '#c84c0c';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#e8a060';
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = '#c84c0c';
      ctx.fillRect(x + 4, y + 4, 10, 10); ctx.fillRect(x + 18, y + 4, 10, 10);
      ctx.fillRect(x + 4, y + 18, 10, 10); ctx.fillRect(x + 18, y + 18, 10, 10);
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y + TILE - 2, TILE, 2); ctx.fillRect(x + TILE - 2, y, 2, TILE);
      break;
    case 'B':
      ctx.fillStyle = '#9c3c14';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#e0703c';
      ctx.fillRect(x, y, 15, 14); ctx.fillRect(x + 17, y, 15, 14);
      ctx.fillRect(x, y + 17, 7, 14); ctx.fillRect(x + 9, y + 17, 15, 14); ctx.fillRect(x + 26, y + 17, 6, 14);
      break;
    case '?': case 'M': {
      const glow = 0.5 + 0.5 * Math.sin(G.elapsed * 6);
      ctx.fillStyle = '#b06000';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = glow > 0.5 ? '#ffb020' : '#f09010';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#b06000';
      ctx.fillRect(x + 3, y + 3, 3, 3); ctx.fillRect(x + 26, y + 3, 3, 3);
      ctx.fillRect(x + 3, y + 26, 3, 3); ctx.fillRect(x + 26, y + 26, 3, 3);
      ctx.fillStyle = '#5a2a00';
      ctx.font = 'bold 22px Courier New';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', x + TILE / 2, y + TILE / 2 + 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      break;
    }
    case 'U':
      ctx.fillStyle = '#5a2a00';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#8a4a1a';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#5a2a00';
      ctx.fillRect(x + 4, y + 4, 4, 4); ctx.fillRect(x + 24, y + 4, 4, 4);
      ctx.fillRect(x + 4, y + 24, 4, 4); ctx.fillRect(x + 24, y + 24, 4, 4);
      break;
    case 'X':
      ctx.fillStyle = '#7a4a1a';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#d8a060';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#b07030';
      ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
      break;
    case 'P': case 'Q':
      ctx.fillStyle = '#1e8a1e';
      ctx.fillRect(x - (t === 'P' ? 4 : 0), y, TILE + 4, TILE);
      ctx.fillStyle = '#5ce65c';
      ctx.fillRect(x - (t === 'P' ? 2 : 0), y + 2, t === 'P' ? 20 : 12, TILE - 4);
      ctx.fillStyle = '#0a4a0a';
      if (t === 'P') ctx.fillRect(x - 4, y, 3, TILE);
      if (t === 'Q') ctx.fillRect(x + TILE - 3, y, 3, TILE);
      ctx.fillRect(x - (t === 'P' ? 4 : 0), y + TILE - 3, TILE + 4, 3);
      break;
    case 'p': case 'q':
      ctx.fillStyle = '#1e8a1e';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#5ce65c';
      ctx.fillRect(x + (t === 'p' ? 4 : 0), y, t === 'p' ? 16 : 10, TILE);
      ctx.fillStyle = '#0a4a0a';
      if (t === 'p') ctx.fillRect(x, y, 3, TILE);
      if (t === 'q') ctx.fillRect(x + TILE - 3, y, 3, TILE);
      break;
    case 'o':
      drawCoin(x + TILE / 2, y + TILE / 2);
      break;
  }
}

function drawCoin(cx, cy) {
  const sx = Math.abs(Math.cos(G.elapsed * 5));
  ctx.fillStyle = '#c88000';
  ctx.beginPath(); ctx.ellipse(cx, cy, 11 * sx + 1, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd700';
  ctx.beginPath(); ctx.ellipse(cx, cy, 9 * sx, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff3b0';
  ctx.beginPath(); ctx.ellipse(cx - 2 * sx, cy - 3, 3 * sx, 5, 0, 0, Math.PI * 2); ctx.fill();
}

function drawFlag() {
  const fx = G.level.flagX * TILE + TILE / 2;
  const top = 3 * TILE + 8, bottom = 12 * TILE;
  ctx.fillStyle = '#2e7d32';
  ctx.fillRect(fx - 3, top, 6, bottom - top);
  ctx.fillStyle = '#5ce65c';
  ctx.fillRect(fx - 1, top, 2, bottom - top);
  ctx.fillStyle = '#4caf50';
  ctx.beginPath(); ctx.arc(fx, top, 9, 0, Math.PI * 2); ctx.fill();
  // Flag
  const fy = G.flagY;
  ctx.fillStyle = '#e8e8e8';
  ctx.beginPath();
  ctx.moveTo(fx - 3, fy); ctx.lineTo(fx - 3 - 30, fy + 14); ctx.lineTo(fx - 3, fy + 28);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath(); ctx.arc(fx - 16, fy + 14, 5, 0, Math.PI * 2); ctx.fill();
}

function drawCastle() {
  const x = G.level.castleX * TILE, base = 13 * TILE;
  if (x + 6 * TILE < G.camX || x > G.camX + VIEW_W) return;
  ctx.fillStyle = '#8a4a1a';
  ctx.fillRect(x, base - 4 * TILE, 5 * TILE, 4 * TILE);
  ctx.fillRect(x + TILE, base - 6 * TILE, 3 * TILE, 2 * TILE);
  ctx.fillStyle = '#c87a3a';
  for (let i = 0; i < 5; i += 2) ctx.fillRect(x + i * TILE, base - 4 * TILE - 12, 20, 12);
  for (let i = 1; i < 4; i += 2) ctx.fillRect(x + i * TILE + 6, base - 6 * TILE - 12, 20, 12);
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 2 * TILE, base - 2 * TILE, TILE, 2 * TILE);
  ctx.beginPath(); ctx.arc(x + 2.5 * TILE, base - 2 * TILE, TILE / 2, Math.PI, 0); ctx.fill();
  ctx.fillRect(x + 12, base - 5.5 * TILE, 10, 14); ctx.fillRect(x + 4 * TILE + 10, base - 5.5 * TILE, 10, 14);
  ctx.fillStyle = '#5a2a00';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) {
    if ((r + c) % 2 === 0) ctx.fillRect(x + c * 16, base - 4 * TILE + r * 32 + 4, 12, 2);
  }
}

function drawItem(it) {
  if (it.type === 'coinpop') { drawCoin(it.x + 8, it.y + 12); return; }
  if (it.type === 'mushroom' || it.type === 'firemushroom') {
    const fire = it.type === 'firemushroom';
    ctx.save();
    if (it.emerging) {
      // Clip to just above the block so it "rises" out
      ctx.beginPath(); ctx.rect(it.x - 4, 0, it.w + 8, it.targetY + 28); ctx.clip();
    }
    const x = it.x, y = it.y;
    ctx.fillStyle = '#ffe0b0';
    ctx.fillRect(x + 6, y + 16, 16, 12);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 9, y + 19, 3, 5); ctx.fillRect(x + 16, y + 19, 3, 5);
    ctx.fillStyle = fire ? '#ff6a00' : '#e03030';
    ctx.beginPath(); ctx.arc(x + 14, y + 14, 14, Math.PI, 0); ctx.fill();
    ctx.fillRect(x, y + 12, 28, 6);
    ctx.fillStyle = fire ? '#ffe14d' : '#fff';
    ctx.beginPath(); ctx.arc(x + 8, y + 10, 4, 0, Math.PI * 2); ctx.arc(x + 20, y + 10, 4, 0, Math.PI * 2);
    ctx.arc(x + 14, y + 4, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawEnemy(e) {
  const x = Math.round(e.x), y = Math.round(e.y);
  if (e.type === 'goomba') {
    if (!e.alive && !e.flipped) {
      // squashed
      ctx.fillStyle = '#8a4a1a';
      ctx.fillRect(x, y + e.h - 12, e.w, 12);
      ctx.fillStyle = '#4a2a0a';
      ctx.fillRect(x + 4, y + e.h - 6, 6, 6); ctx.fillRect(x + e.w - 10, y + e.h - 6, 6, 6);
      return;
    }
    ctx.save();
    if (e.flipped) { ctx.translate(x + e.w / 2, y + e.h / 2); ctx.scale(1, -1); ctx.translate(-(x + e.w / 2), -(y + e.h / 2)); }
    const step = Math.floor(e.animT * 6) % 2;
    ctx.fillStyle = '#8a4a1a';
    ctx.beginPath(); ctx.arc(x + e.w / 2, y + 12, 14, Math.PI, 0); ctx.fill();
    ctx.fillRect(x, y + 12, e.w, 8);
    ctx.fillStyle = '#e8c890';
    ctx.fillRect(x + 4, y + 18, e.w - 8, 6);
    ctx.fillStyle = '#4a2a0a';
    ctx.fillRect(x + (step ? 0 : 3), y + 22, 10, 6); ctx.fillRect(x + e.w - 10 - (step ? 0 : 3), y + 22, 10, 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 7, y + 6, 5, 8); ctx.fillRect(x + e.w - 12, y + 6, 5, 8);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 9, y + 9, 3, 4); ctx.fillRect(x + e.w - 12, y + 9, 3, 4);
    ctx.fillRect(x + 5, y + 5, 5, 2); ctx.fillRect(x + e.w - 10, y + 5, 5, 2);
    ctx.restore();
  } else {
    // koopa
    ctx.save();
    if (e.flipped) { ctx.translate(x + e.w / 2, y + e.h / 2); ctx.scale(1, -1); ctx.translate(-(x + e.w / 2), -(y + e.h / 2)); }
    if (e.shell) {
      ctx.fillStyle = '#1e8a1e';
      ctx.beginPath(); ctx.arc(x + 14, y + 16, 14, Math.PI, 0); ctx.fill();
      ctx.fillRect(x, y + 16, 28, 8);
      ctx.fillStyle = '#5ce65c';
      ctx.fillRect(x + 6, y + 8, 6, 6); ctx.fillRect(x + 16, y + 8, 6, 6); ctx.fillRect(x + 11, y + 15, 6, 6);
      ctx.fillStyle = '#e8c890';
      ctx.fillRect(x + 2, y + 22, 24, 6);
      if (e.shellMoving) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x - 6 * Math.sign(e.vx), y + 10, 6, 10); }
    } else {
      const step = Math.floor(e.animT * 6) % 2;
      const f = e.vx < 0 ? -1 : 1;
      ctx.translate(x + e.w / 2, 0); ctx.scale(f, 1); ctx.translate(-(x + e.w / 2), 0);
      // legs
      ctx.fillStyle = '#e8c890';
      ctx.fillRect(x + 4 + (step ? 2 : 0), y + 32, 8, 8); ctx.fillRect(x + 16 - (step ? 2 : 0), y + 32, 8, 8);
      // shell
      ctx.fillStyle = '#1e8a1e';
      ctx.beginPath(); ctx.arc(x + 12, y + 24, 13, Math.PI, 0); ctx.fill();
      ctx.fillRect(x - 1, y + 24, 26, 8);
      ctx.fillStyle = '#5ce65c';
      ctx.fillRect(x + 4, y + 16, 6, 6); ctx.fillRect(x + 13, y + 16, 6, 6);
      // head
      ctx.fillStyle = '#e8c890';
      ctx.fillRect(x + 12, y + 2, 16, 14);
      ctx.fillRect(x + 20, y + 12, 8, 8);
      ctx.fillStyle = '#000';
      ctx.fillRect(x + 22, y + 6, 3, 4);
    }
    ctx.restore();
  }
}

function drawPlayer(p) {
  if (p.invincible > 0 && Math.floor(p.invincible * 12) % 2 === 0) return;
  const x = Math.round(p.x), y = Math.round(p.y);
  const big = p.big;
  const h = p.h;
  const step = p.onGround && Math.abs(p.vx) > 10 ? Math.floor(p.animT * 2) % 3 : 0;
  const jumping = !p.onGround && G.state === 'playing';

  ctx.save();
  ctx.translate(x + p.w / 2, y);
  ctx.scale(p.facing, 1);
  ctx.translate(-p.w / 2, 0);

  const s = big ? 2 : 1;         // vertical scale for body parts
  // Colors
  const RED = '#e52521', SKIN = '#ffc890', BLUE = '#2a5fd0', BROWN = '#6b3a12', HAIR = '#4a2000';
  // Fire power swaps the outfit: white hat and shirt, red overalls
  const SHIRT = p.fire ? '#f6f6f6' : RED, PANTS = p.fire ? RED : BLUE;

  if (big) {
    // Hat
    ctx.fillStyle = SHIRT; ctx.fillRect(4, 0, 18, 8); ctx.fillRect(8, 8, 18, 4);
    // Face
    ctx.fillStyle = SKIN; ctx.fillRect(6, 8, 14, 14);
    ctx.fillStyle = HAIR; ctx.fillRect(4, 8, 4, 10);
    ctx.fillStyle = '#000'; ctx.fillRect(15, 11, 3, 4);
    ctx.fillStyle = HAIR; ctx.fillRect(12, 17, 10, 3);      // moustache
    // Shirt / arms
    ctx.fillStyle = SHIRT; ctx.fillRect(2, 22, 20, 12);
    // Overalls
    ctx.fillStyle = PANTS; ctx.fillRect(4, 30, 16, 20);
    ctx.fillRect(6, 24, 4, 8); ctx.fillRect(14, 24, 4, 8);
    ctx.fillStyle = '#ffd700'; ctx.fillRect(7, 32, 3, 3); ctx.fillRect(14, 32, 3, 3);
    // Arms: red sleeve at the shoulder, skin hand below. Back arm swings opposite
    // to the front arm while walking; both go up when jumping.
    const swing = step === 1 ? 2 : 0;
    if (jumping) {
      ctx.fillStyle = SHIRT; ctx.fillRect(-4, 20, 6, 5); ctx.fillRect(20, 20, 6, 5);
      ctx.fillStyle = SKIN; ctx.fillRect(-4, 13, 6, 8); ctx.fillRect(20, 13, 6, 8);
    } else {
      ctx.fillStyle = SHIRT; ctx.fillRect(-4, 22, 6, 6); ctx.fillRect(20, 22, 6, 6);
      ctx.fillStyle = SKIN; ctx.fillRect(-4, 28 + (2 - swing), 6, 8); ctx.fillRect(20, 28 + swing, 6, 8);
    }
    // Legs / shoes
    ctx.fillStyle = PANTS;
    ctx.fillStyle = BROWN;
    if (jumping) { ctx.fillRect(2, 50, 10, 10); ctx.fillRect(14, 48, 10, 10); }
    else if (step === 1) { ctx.fillRect(0, 50, 10, 10); ctx.fillRect(14, 50, 10, 10); }
    else if (step === 2) { ctx.fillRect(4, 50, 10, 10); ctx.fillRect(12, 46, 12, 10); }
    else { ctx.fillRect(3, 50, 10, 10); ctx.fillRect(13, 50, 10, 10); }
  } else {
    // Small sprite: 24 x 36
    // Hat
    ctx.fillStyle = SHIRT; ctx.fillRect(4, 0, 16, 5); ctx.fillRect(8, 5, 16, 3);
    // Face
    ctx.fillStyle = SKIN; ctx.fillRect(6, 5, 12, 11);
    ctx.fillStyle = HAIR; ctx.fillRect(4, 5, 3, 8);
    ctx.fillStyle = '#000'; ctx.fillRect(14, 8, 2, 3);
    ctx.fillStyle = HAIR; ctx.fillRect(11, 13, 8, 2);
    // Shirt
    ctx.fillStyle = SHIRT; ctx.fillRect(3, 16, 18, 7);
    // Overalls
    ctx.fillStyle = PANTS; ctx.fillRect(5, 21, 14, 9);
    ctx.fillRect(7, 16, 3, 6); ctx.fillRect(14, 16, 3, 6);
    ctx.fillStyle = '#ffd700'; ctx.fillRect(8, 22, 2, 2); ctx.fillRect(14, 22, 2, 2);
    // Arms: red sleeve at the shoulder, skin hand below (see big version)
    const swing = step === 1 ? 2 : 0;
    if (jumping) {
      ctx.fillStyle = SHIRT; ctx.fillRect(0, 15, 5, 3); ctx.fillRect(19, 15, 5, 3);
      ctx.fillStyle = SKIN; ctx.fillRect(0, 10, 5, 6); ctx.fillRect(19, 10, 5, 6);
    } else {
      ctx.fillStyle = SHIRT; ctx.fillRect(0, 16, 5, 4); ctx.fillRect(19, 16, 5, 4);
      ctx.fillStyle = SKIN; ctx.fillRect(0, 20 + (2 - swing), 5, 6); ctx.fillRect(19, 20 + swing, 5, 6);
    }
    // Shoes
    ctx.fillStyle = BROWN;
    if (jumping) { ctx.fillRect(2, 30, 9, 6); ctx.fillRect(13, 28, 9, 6); }
    else if (step === 1) { ctx.fillRect(0, 30, 9, 6); ctx.fillRect(14, 30, 9, 6); }
    else if (step === 2) { ctx.fillRect(4, 30, 9, 6); ctx.fillRect(12, 27, 10, 6); }
    else { ctx.fillRect(3, 30, 9, 6); ctx.fillRect(12, 30, 9, 6); }
  }
  ctx.restore();

  // Growing sparkle
  if (p.growT > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + (p.growT / 0.6) + ')';
    ctx.fillRect(x - 4, y - 4, p.w + 8, 4);
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
// Normalise to a KeyboardEvent.code even when the browser only supplies e.key
function keyCode(e) {
  if (e.code) return e.code;
  const k = e.key;
  if (k === ' ') return 'Space';
  if (k === 'Shift') return 'ShiftLeft';
  if (k.length === 1 && /[a-z]/i.test(k)) return 'Key' + k.toUpperCase();
  return k;
}

window.addEventListener('keydown', (e) => {
  const code = keyCode(e);
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)) e.preventDefault();
  keys[code] = true;
  if ((code === 'Enter' || code === 'Space') && (G.state === 'title' || G.state === 'gameover' || G.state === 'win')) {
    Sound.unlock();
    startGame();
  }
});
window.addEventListener('keyup', (e) => { keys[keyCode(e)] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ---------------------------------------------------------------------------
// Touch controls - mobile only. Nothing here runs on a mouse-and-keyboard
// desktop: the on-screen buttons stay hidden and the layout is unchanged.
// ---------------------------------------------------------------------------
const TouchControls = (() => {
  let enabled = false;
  const container = document.getElementById('game-container');
  const hudEl = document.getElementById('hud');
  const fsBtn = document.getElementById('fullscreen');
  const buttons = Array.from(document.querySelectorAll('#touch button[data-key]'));
  const pad = document.querySelector('#touch .pad');
  const held = new Map();            // pointerId -> button currently held

  // Scale the game so it fits a phone screen (landscape or portrait)
  function fit() {
    if (!enabled) return;
    const availW = window.innerWidth;
    const availH = window.innerHeight - hudEl.offsetHeight;
    const w = Math.max(240, Math.min(availW, availH * VIEW_W / VIEW_H));
    container.style.width = Math.floor(w) + 'px';
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    document.body.classList.add('touch');
    overlayText.textContent = overlayText.textContent.replace(/Press ENTER( or SPACE)?/, 'Tap');
    document.querySelector('#overlay .controls').innerHTML =
      'Hold &#9664; &#9654; to move &nbsp;|&nbsp; JUMP to jump (hold for higher) &nbsp;|&nbsp; RUN to sprint, it becomes FIRE with a fire mushroom<br />' +
      'Turn your phone sideways for a bigger view.';
    fit();
  }

  function press(btn, on) {
    keys[btn.dataset.key] = on;
    btn.classList.toggle('active', on);
  }
  function release(e) {
    const btn = held.get(e.pointerId);
    if (!btn) return;
    press(btn, false);
    held.delete(e.pointerId);
  }

  for (const btn of buttons) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      enable();
      Sound.unlock();
      held.set(e.pointerId, btn);
      press(btn, true);
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // Releases are tracked on the window so a finger that slides off a button
  // still lets go of it.
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // Sliding the thumb between left and right on the pad switches direction
  window.addEventListener('pointermove', (e) => {
    const btn = held.get(e.pointerId);
    if (!btn || btn.parentElement !== pad) return;
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && over !== btn && over.parentElement === pad && over.dataset.key) {
      press(btn, false);
      press(over, true);
      held.set(e.pointerId, over);
    }
  });
  window.addEventListener('blur', () => { for (const b of buttons) press(b, false); held.clear(); });

  // Tap anywhere on the title / game over / win screen to start
  overlay.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') enable();
    if (G.state === 'title' || G.state === 'gameover' || G.state === 'win') {
      Sound.unlock();
      startGame();
    }
  });

  // Full screen button (hidden on desktop). Locks to landscape where allowed.
  fsBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch (err) { /* not supported (e.g. iPhone Safari) - ignore */ }
    setTimeout(fit, 300);
  });

  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  // Turn on right away for devices that report a coarse pointer with no hover
  // (phones, tablets); otherwise wait for the first real touch.
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) enable();
  else window.addEventListener('touchstart', enable, { once: true, passive: true });

  // With the fire power the RUN button becomes FIRE (a phone has no room for a
  // third button). update() calls this every frame; it only acts on a change.
  const runBtn = document.querySelector('#touch button.run');
  let fireMode = false;
  function setFireMode(on) {
    if (on === fireMode) return;
    fireMode = on;
    for (const [id, b] of held) if (b === runBtn) { press(b, false); held.delete(id); }
    keys[runBtn.dataset.key] = false;
    runBtn.dataset.key = on ? 'KeyX' : 'ShiftLeft';
    runBtn.textContent = on ? 'FIRE' : 'RUN';
    runBtn.classList.toggle('fire', on);
  }

  return { get enabled() { return enabled; }, fit, setFireMode };
})();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;                     // avoid huge steps after tab switch
  // Sub-step physics so fast objects never tunnel through tiles
  const steps = Math.ceil(dt / (1 / 120));
  const sdt = dt / steps;
  // An error in one frame must not kill the loop for good: report it and keep going.
  try {
    for (let i = 0; i < steps; i++) update(sdt);
    render();
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

// Title screen shows the level behind the overlay
G.level = buildLevel();
G.player = makePlayer(G.level.playerStart.x, G.level.playerStart.y);
G.enemies = G.level.enemies.map(makeEnemy);
updateHud();
requestAnimationFrame(frame);
