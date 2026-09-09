#!/bin/sh
# Bundle index.html + style.css + game.js into one self-contained HTML file.
# Usage: sh build.sh [output-path]   (default: dist/super-plumber-bros.html)
cd "$(dirname "$0")"
OUT="${1:-dist/super-plumber-bros.html}"
mkdir -p "$(dirname "$OUT")"
{
  echo '<title>Super Plumber Bros</title>'
  echo '<style>'; cat style.css; echo '</style>'
  sed -n '/<div id="game-container">/,/<script src="game.js">/p' index.html | sed '$d'
  echo '<script>'; cat game.js; echo '</script>'
} > "$OUT"
echo "wrote $OUT"
