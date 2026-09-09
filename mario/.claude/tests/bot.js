// Headless playthrough bot. Drives update() synchronously so it works even when
// the tab is hidden. Runs right, jumps at walls / pits / enemies, logs events.
window.bot = function (opts) {
  opts = opts || {};
  startGame();
  const dt = 1 / 120;
  let t = 0;
  const step = () => { update(dt); t += dt; };
  const clear = () => { for (const k in keys) keys[k] = false; };
  clear();
  const ev = [];
  let lastX = 0, lastProg = 0, jt = 0, lastState = 'playing', deaths = 0, maxX = 0;
  let jumpFor = '';                 // why the current jump was made: 'pit', 'enemy' or 'wall'
  const snap = (tag) => {
    const P = G.player;
    const near = G.enemies.filter(e => e.alive && Math.abs(e.x - P.x) < 120)
      .map(e => e.type + '@' + (e.x / 32).toFixed(1));
    ev.push([tag, +t.toFixed(1), 'tile ' + (P.x / 32).toFixed(1), 'row ' + (P.y / 32).toFixed(1),
      'big=' + P.big, 'lives=' + G.lives, near.join(',')]);
  };
  while (t < 380) {
    const P = G.player;
    if (G.state !== lastState) {
      snap(G.state);
      if (G.state === 'dying') deaths++;
      if (G.state === 'playing') { lastX = 0; lastProg = t; }
      lastState = G.state;
    }
    if (G.state === 'win' || G.state === 'gameover') break;
    if (G.state !== 'playing') { clear(); step(); continue; }
    keys.ShiftLeft = !!opts.run;
    const look = opts.run ? 110 : 70;
    const ty0 = Math.floor(P.y / 32), ty1 = Math.floor((P.y + P.h - 1) / 32);
    const solidCol = (px) => {
      const tx = Math.floor(px / 32);
      for (let ty = ty0; ty <= ty1; ty++) if (isSolid(tx, ty)) return true;
      return false;
    };
    const wall = solidCol(P.x + P.w + 8) || solidCol(P.x + P.w + 40);
    const footRow = Math.floor((P.y + P.h) / 32);
    const colA = Math.floor((P.x + P.w + 28) / 32);
    let groundAhead = false;
    for (let ty = footRow; ty < 15; ty++) if (isSolid(colA, ty)) groundAhead = true;
    const enemyAhead = G.enemies.some(e => e.alive && e.active && e.x > P.x && e.x - P.x < look
      && Math.abs((e.y + e.h) - (P.y + P.h)) < 40);
    const want = wall || !groundAhead || enemyAhead;
    if (P.onGround) jumpFor = '';
    if (P.onGround && jt <= 0 && want) { jt = 0.35; jumpFor = !groundAhead ? 'pit' : enemyAhead ? 'enemy' : 'wall'; }
    // Steer in the air, as a player would: if a pit is about to be under us and
    // this jump was not made to clear it, brake so we land short.
    const brake = !P.onGround && !groundAhead && jumpFor !== 'pit';
    if (brake) { keys.ArrowRight = false; keys.ArrowLeft = true; }
    else { keys.ArrowLeft = false; keys.ArrowRight = true; }
    if (jt > 0) { keys.Space = true; jt -= dt; }
    // Airborne but a hazard is coming up: tap jump every other frame so the
    // game's jump buffer fires the instant we land (as a player would).
    else if (!P.onGround && want) { keys.Space = (Math.round(t * 120) % 2) === 0; }
    else keys.Space = false;
    step();
    if (P.x > maxX) maxX = P.x;
    if (P.x > lastX + 1) { lastX = P.x; lastProg = t; }
    if (t - lastProg > 4) { snap('STUCK'); break; }
  }
  clear();
  return { events: ev, final: G.state, deaths, maxTile: +(maxX / 32).toFixed(1),
    score: G.score, coins: G.coins, lives: G.lives, simSeconds: +t.toFixed(1) };
};
'bot loaded';
