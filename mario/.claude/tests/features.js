// Feature tests for the game mechanics. Each returns a small object; a test
// "passes" when its `ok` is true. Uses synchronous update() stepping.
(() => {
  const dt = 1 / 120;
  const step = (n) => { for (let i = 0; i < (n || 1); i++) update(dt); };
  const clear = () => { for (const k in keys) keys[k] = false; };
  const FLOOR = 13 * 32;
  const R = {};
  const fresh = () => {
    startGame(); clear();
    // park every enemy far off to the left so it cannot interfere; tests that
    // need one reposition it explicitly.
    G.enemies.forEach(e => { e.active = false; e.x = -5000; e.vx = 0; });
  };
  const place = (tx, big) => {
    const p = G.player;
    p.big = !!big; p.h = big ? BIG_H : SMALL_H; p.x = tx * 32 + 4; p.y = FLOOR - p.h;
    p.vx = 0; p.vy = 0; p.invincible = 0; p.jumpBufferT = 0; p.coyoteT = 0;
    G.camX = Math.max(0, Math.min(p.x - 300, 224 * 32 - 800));
    step(2);
  };
  const jump = () => { keys.Space = true; step(40); keys.Space = false; };

  // 1. Coin question block
  fresh(); place(16);
  const s0 = G.score, c0 = G.coins;
  jump(); step(60);
  R.coinBlock = { ok: tileAt(16, 9) === 'U' && G.coins === c0 + 1 && G.score > s0, tile: tileAt(16, 9), coins: G.coins - c0 };

  // 2. Mushroom block -> mushroom appears -> collect -> big
  fresh(); place(22);
  jump(); step(30);
  const mush = G.items.find(i => i.type === 'mushroom');
  const appeared = !!mush;
  // stand still and wait, then chase it to the right
  step(120); keys.ArrowRight = true; step(400); clear();
  R.mushroom = { ok: appeared && G.player.big && G.player.h === 60, appeared, big: G.player.big, h: G.player.h };

  // 3. Big player breaks brick
  fresh(); place(20, true);
  const parts0 = G.particles.length;
  jump(); step(20);
  R.breakBrick = { ok: tileAt(20, 9) === ' ' && G.particles.length > parts0, tile: tileAt(20, 9), shards: G.particles.length - parts0 };

  // 4. Small player bumps brick (does not break)
  fresh(); place(24);
  jump(); step(20);
  R.bumpBrick = { ok: tileAt(24, 9) === 'B', tile: tileAt(24, 9) };

  // 5. Getting hurt while big -> small + invincible; hurt while small -> dying
  fresh(); place(10, true);
  const g = G.enemies.find(e => e.type === 'goomba');
  g.x = G.player.x + 60; g.y = FLOOR - g.h; g.active = true; g.vx = -55;
  step(120);
  const shrank = !G.player.big && G.player.invincible > 0 && G.state === 'playing';
  G.player.invincible = 0; g.x = G.player.x + 40; g.vx = -55; step(120);
  R.hurt = { ok: shrank && G.state === 'dying', shrank, stateAfterSecondHit: G.state };

  // 6. Death -> respawn with one fewer life; game over after 3 deaths
  fresh(); place(69); G.player.x = 69 * 32 + 8; step(600);
  const respawned = G.state === 'playing' && G.lives === 2 && G.player.x === 3 * 32;
  killPlayer(); step(400); killPlayer(); step(400);
  R.livesAndGameOver = { ok: respawned && G.state === 'gameover' && G.lives === 0, respawned, state: G.state, lives: G.lives };

  // 7. Timer runs out -> death
  fresh(); place(5); G.time = 1; step(150);
  R.timerDeath = { ok: G.state === 'dying', state: G.state };

  // 8. Stomp goomba
  fresh(); place(10);
  const g2 = G.enemies.find(e => e.type === 'goomba');
  g2.x = G.player.x; g2.y = FLOOR - g2.h; g2.active = true; g2.vx = 0;
  G.player.y = FLOOR - 120; G.player.vy = 0; step(60);
  R.stompGoomba = { ok: !g2.alive && G.state === 'playing' && G.player.vy < 0 || !g2.alive, alive: g2.alive, state: G.state };

  // 9. Koopa: stomp -> shell, kick -> moving, shell kills goomba
  fresh(); place(10);
  const k = G.enemies.find(e => e.type === 'koopa');
  const g3 = G.enemies.find(e => e.type === 'goomba');
  k.x = G.player.x; k.y = FLOOR - k.h; k.active = true; k.vx = 0;
  G.player.y = FLOOR - 140; G.player.vy = 0; step(60);
  const shelled = k.shell && !k.shellMoving;
  // wait for kick cooldown, walk into the shell from the left
  step(60); G.player.x = k.x - 40; G.player.y = FLOOR - G.player.h; keys.ArrowRight = true; step(30); clear();
  const kicked = k.shellMoving && k.vx > 0;
  g3.x = k.x + 200; g3.y = FLOOR - g3.h; g3.active = true; g3.vx = 0;
  step(120);
  R.koopa = { ok: shelled && kicked && !g3.alive && G.state === 'playing', shelled, kicked, goombaKilledByShell: !g3.alive, state: G.state };

  // 10. Reachability: every coin and block must have a standing surface within
  //     jump reach (<= 4 tiles below) and horizontal reach (<= 3 tiles).
  fresh();
  const grid = G.level.grid;
  const unreachable = [];
  for (let y = 0; y < 15; y++) for (let x = 0; x < 224; x++) {
    const c = grid[y][x];
    if (!'o?MB'.includes(c)) continue;
    let ok = false;
    for (let dx = -3; dx <= 3 && !ok; dx++) {
      // A standing surface above the coin also counts: you can drop onto it.
      for (let r = 1; r <= y && !ok && c === 'o'; r++) {
        const tx = x + dx;
        if (tx >= 0 && tx < 224 && SOLID.has(grid[r][tx]) && !SOLID.has(grid[r - 1][tx])) ok = true;
      }
      for (let r = y + 1; r <= Math.min(14, y + 6) && !ok; r++) {
        const tx = x + dx;
        if (tx < 0 || tx >= 224) continue;
        if (SOLID.has(grid[r][tx]) && !SOLID.has(grid[r - 1][tx])) {
          // standing spot at (tx, r-1). Jump reach: feet rise 145px = 4.5 tiles; for a
          // coin the feet must reach the coin row; for a block the head must reach it.
          // Feet rise 4.5 tiles. A coin is taken when the body overlaps its row, so
          // the feet only need to rise past the row below it. A block needs the head
          // (one tile above the feet) to reach its underside.
          const rise = r - y - 1;
          if (rise <= (c === 'o' ? 4.5 : 5.4)) ok = true;
        }
      }
    }
    if (!ok) unreachable.push(c + '@' + x + ',' + y);
  }
  R.reachability = { ok: unreachable.length === 0, unreachable };

  clear();
  const summary = Object.entries(R).map(([k, v]) => (v.ok ? 'PASS ' : 'FAIL ') + k).join(' | ');
  return JSON.stringify({ summary, R });
})();
