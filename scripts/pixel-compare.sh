#!/usr/bin/env bash
# Safari vs Chrome pixel diff, on one Mac. macOS only.
#
#   ./scripts/pixel-compare.sh http://localhost:3100 /trips
#
# Requires: brew install imagemagick
# Requires: System Settings -> Privacy & Security -> Screen Recording -> allow Terminal.
#
# WHY BOTH BROWSERS ON THE SAME MACHINE
#
# Comparing Mac-Safari against Windows-Chrome would diff two GPUs, two device pixel ratios and two
# font rasterizers, and the engine difference you actually want would be lost in the noise. Same
# machine, same window geometry, same DPR: then a difference is the engine.
#
# WHAT A NON-ZERO DIFF MEANS
#
# Not much, on its own. Text antialiasing alone will light up thousands of pixels — Safari and
# Chrome do not rasterize glyphs identically and never have. Read the diff *image*, not the count:
# scattered speckle along type is expected, a solid block over a glass panel is a finding. Compare
# counts only between runs of this same script, never against an absolute threshold.
set -euo pipefail

BASE="${1:?usage: pixel-compare.sh <base-url> <route> — e.g. http://localhost:3100 /trips}"
ROUTE="${2:?usage: pixel-compare.sh <base-url> <route>}"
URL="$BASE$ROUTE"
OUT="${TMPDIR:-/tmp}/tripmate-pixel"
SLUG=$(echo "$ROUTE" | sed 's#[^a-zA-Z0-9]#_#g')
mkdir -p "$OUT"

# Fixed geometry so both captures cover the same CSS pixels. Position, not just size: `screencapture
# -R` takes screen coordinates, so the window has to land somewhere known.
X=40; Y=80; W=1200; H=800

command -v magick >/dev/null || { echo "magick not found — brew install imagemagick"; exit 2; }

shoot() { # shoot <AppName> <outfile>
  local app="$1" file="$2"
  osascript >/dev/null <<OSA
    tell application "$app"
      activate
      open location "$URL"
      delay 1
    end tell
    delay 7
    tell application "System Events" to tell process "$app"
      try
        set position of front window to {$X, $Y}
        set size of front window to {$W, $H}
      end try
    end tell
    delay 3
OSA
  # -x silences the shutter, -o drops the window shadow, -R takes an explicit rect.
  screencapture -x -o -R "$X,$Y,$W,$H" "$file"
}

echo "capturing Safari…"; shoot Safari "$OUT/safari$SLUG.png"
echo "capturing Chrome…"; shoot "Google Chrome" "$OUT/chrome$SLUG.png"

# Retina capture yields 2x pixels; identical for both, so no normalisation needed — but report it,
# because a mismatch here means one window was not where this script thought it was.
echo
echo "safari: $(magick identify -format '%wx%h' "$OUT/safari$SLUG.png")"
echo "chrome: $(magick identify -format '%wx%h' "$OUT/chrome$SLUG.png")"

DIFFERENT=$(magick compare -metric AE "$OUT/safari$SLUG.png" "$OUT/chrome$SLUG.png" \
  "$OUT/diff$SLUG.png" 2>&1 || true)
TOTAL=$(magick identify -format '%[fx:w*h]' "$OUT/safari$SLUG.png")

echo
echo "differing pixels: $DIFFERENT of $TOTAL"
echo "diff image:       $OUT/diff$SLUG.png"
echo
echo "Open the diff and judge it by shape, not by count:"
echo "  speckle along text        -> glyph antialiasing, expected, ignore"
echo "  solid block on a panel    -> a real backdrop-filter difference, report it"
echo "  offset/shifted geometry   -> a layout difference, report it"
echo "  the globe area differing  -> expected; the tileset is not frame-identical between runs"
open "$OUT/diff$SLUG.png" 2>/dev/null || true
