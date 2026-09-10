# Super Plumber Bros

A Mario-style side-scrolling platformer written in plain HTML5 Canvas and JavaScript.
You play Gargamel chasing Smurfs through the level.
No build step, no dependencies.

## Play online

https://tevtevyo.github.io/Games/

Every push to `main` that touches `mario/` republishes the site automatically
(see `.github/workflows/pages.yml`).

## Run it locally

Open `index.html` in any modern browser, or in VS Code right-click it and choose
"Open with Live Server" if you have that extension.

## Controls

| Action | Keys                        |
| ------ | --------------------------- |
| Move   | Left / Right arrows, A / D  |
| Jump   | Up arrow, W, or Space       |
| Run    | Shift                       |
| Fire   | X (or F), with the fire power |
| Start  | Enter or Space              |

Hold jump longer to jump higher. Running makes you jump higher too.

## Features

- Tile-based level with pits, pipes, stairs, bricks, question blocks and a flag pole
- Enemies are Smurfs: little walkers in white hats (stomp them) and Papa Smurfs in red
  (stomp, then kick the curled-up hat into other enemies). Same behaviour as Goombas and Koopas
- Coins, and question blocks that release either a super mushroom (grow, smash bricks)
  or a fire mushroom (grow plus straight-flying fireballs) with equal odds
- Fireballs: X on the keyboard; on touch screens the RUN button becomes FIRE while you have the power
- Score, coin counter, 400-second timer, lives, and a course-clear time bonus
- Synthesized sound effects with WebAudio, no audio files needed

## Files

- `index.html` - page, HUD and overlay
- `style.css` - layout and styling
- `game.js` - level builder, physics, entities, rendering, input and sound

## Editing the level

The level is built in `buildLevel()` in `game.js` using small helpers such as
`ground(x0, x1)`, `pipe(x, height)`, `stairsUp(x, height)`, `row(x0, x1, y, tile)`,
`goomba(x)` and `koopa(x)`. Coordinates are in tiles (32 px). Row 13 and 14 are the
floor, row 12 is where the player stands.

## Single-file build and tests

`sh build.sh` bundles the three files into `dist/super-plumber-bros.html`, one
self-contained page you can share or publish anywhere.

`.claude/tests/bot.js` is a headless bot that plays the whole level (walking or
running) and `.claude/tests/features.js` checks the mechanics (blocks, mushroom,
bricks, damage, lives, timer, stomps, Koopa shells, coin reachability). Load either
in the browser console with fetch + eval while the game is open.
