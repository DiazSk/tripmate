#!/usr/bin/env bash
# Safari vs Chrome pixel diff, on one Mac. macOS only.
#
#   ./scripts/pixel-compare.sh http://localhost:3100 /trips
#
# Requires: brew install imagemagick
# Requires: System Settings -> Privacy & Security -> Screen Recording -> allow this terminal.
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
#
# WHY THIS SCRIPT NEVER SAYS "front window"
#
# It used to. It opened the URL as a tab in whatever window happened to be frontmost, positioned
# that window through System Events inside a `try` block, and captured a fixed screen rectangle.
# Two things went wrong the first time it ran for real. With Accessibility permission denied the
# positioning failed silently, so `screencapture -R` photographed an unrelated personal window and
# the script still printed a confident "differing pixels" number for two unrelated images. Then its
# own cleanup closed "the front window" — which was that personal window, with fourteen tabs in it.
#
# So: every operation below addresses a window by the `id` returned when THIS SCRIPT created it.
# Never "front window", never an index, and nothing is closed that was not opened here. Positioning
# goes through each browser's own `bounds` property, which needs no Accessibility permission, and
# is read back and verified. The URL is verified before any capture. Every check aborts rather than
# continues, because a wrong screenshot is worse than no screenshot — the number it produces looks
# exactly as real as a correct one.
set -euo pipefail

BASE="${1:?usage: pixel-compare.sh <base-url> <route> — e.g. http://localhost:3100 /trips}"
ROUTE="${2:?usage: pixel-compare.sh <base-url> <route>}"
URL="$BASE$ROUTE"
OUT="${TMPDIR:-/tmp}/tripmate-pixel"
SLUG=$(echo "$ROUTE" | sed 's#[^a-zA-Z0-9]#_#g')
mkdir -p "$OUT"

# Fixed geometry so both captures cover the same CSS pixels. Position, not just size: `screencapture
# -R` takes screen coordinates, so the window has to land somewhere known — and be verified there.
X=40; Y=80; W=1200; H=800
SETTLE=10   # seconds after the URL is confirmed loaded, for Cesium to boot and tiles to arrive

command -v magick >/dev/null || { echo "magick not found — brew install imagemagick"; exit 2; }

die() { echo "ABORT: $*" >&2; exit 1; }

# Check the route serves before opening any browser. The per-window URL check further down cannot
# do this job: Safari's failed-load error page still reports the URL it *tried*, so a dead server
# sails straight through it and the script cheerfully diffs two error pages. Cheapest possible guard,
# and it fails before anything is opened, moved or captured.
curl -fsS -o /dev/null --max-time 15 "$URL" \
  || die "$URL did not serve. Start the server first (npm run build && npx next start -p 3100)."

osa() { osascript "$@" 2>/dev/null; }

# --- window operations, all addressed by an id this script owns ---------------------------------
win_ids() { osa -e "tell application \"$1\" to return id of every window" | tr -d ' '; }

# Identify the new window by diffing the id list across creation, NOT by asking which window is
# frontmost. Safari does not front a new document whose URL fails to load, so `id of front window`
# returned somebody else's window — and the cleanup below then closed it. Requiring exactly one new
# id also catches the case where something else opened a window at the same moment.
open_window() { # open_window <app> -> prints the new window id, or nothing
  local before after
  before=$(win_ids "$1")
  case "$1" in
    Safari)
      osa -e "tell application \"Safari\" to make new document with properties {URL:\"$URL\"}" >/dev/null ;;
    "Google Chrome")
      osa -e "tell application \"Google Chrome\"
                set w to make new window
                set URL of active tab of window id (id of w) to \"$URL\"
              end tell" >/dev/null ;;
  esac
  sleep 2
  after=$(win_ids "$1")
  python3 - "$before" "$after" <<'PY'
import sys
before = {x for x in sys.argv[1].split(',') if x}
new = [x for x in sys.argv[2].split(',') if x and x not in before]
print(new[0] if len(new) == 1 else "")
PY
}
window_url() { # window_url <app> <id>
  case "$1" in
    Safari) osa -e "tell application \"Safari\" to return URL of current tab of window id $2" ;;
    "Google Chrome") osa -e "tell application \"Google Chrome\" to return URL of active tab of window id $2" ;;
  esac
}
set_bounds()   { osa -e "tell application \"$1\" to set bounds of window id $2 to {$X, $Y, $((X+W)), $((Y+H))}"; }
get_bounds()   { osa -e "tell application \"$1\" to return bounds of window id $2"; }
close_window() { [ -n "${2:-}" ] && osa -e "tell application \"$1\" to close window id $2" || true; }

shoot() { # shoot <AppName> <outfile>
  local app="$1" file="$2" wid got want i front
  osa -e "tell application \"$app\" to activate"

  wid=$(open_window "$app" || true)
  case "$wid" in
    ''|*[!0-9]*) die "could not open a window in $app (got id '${wid:-none}'). Nothing captured, nothing closed." ;;
  esac

  # Confirm the window this script made is showing the route asked for. This check alone would have
  # caught the original failure.
  for i in $(seq 1 20); do
    got=$(window_url "$app" "$wid" || true)
    case "$got" in "$URL"*) break ;; esac
    sleep 1
  done
  case "$got" in
    "$URL"*) ;;
    *) close_window "$app" "$wid"; die "$app window $wid never loaded $URL (it is at '${got:-unknown}')." ;;
  esac

  set_bounds "$app" "$wid"; sleep 1
  # Read the geometry back: if the window is not where this script thinks it is, `-R` would
  # photograph something else entirely.
  want="$X, $Y, $((X+W)), $((Y+H))"
  got=$(get_bounds "$app" "$wid")
  [ "$got" = "$want" ] || { close_window "$app" "$wid"; die "$app window $wid is at [$got], expected [$want]."; }

  # Frontmost app + its own window verified at this rect means the rect *is* that window, so a
  # region capture is sound. Without both facts it is not.
  front=$(osa -e 'tell application "System Events" to return name of first application process whose frontmost is true' || echo "?")
  [ "$front" = "$app" ] || { close_window "$app" "$wid"; die "$app is not frontmost ($front is); something could cover the capture region."; }

  sleep "$SETTLE"
  # -x silences the shutter, -o drops the window shadow, -R takes an explicit rect.
  screencapture -x -o -R "$X,$Y,$W,$H" "$file"
  [ -s "$file" ] || { close_window "$app" "$wid"; die "screencapture produced nothing — grant Screen Recording to this terminal."; }
  close_window "$app" "$wid"   # only ever the window opened above
}

echo "capturing Safari…"; shoot Safari "$OUT/safari$SLUG.png"
echo "capturing Chrome…"; shoot "Google Chrome" "$OUT/chrome$SLUG.png"

# Retina capture yields 2x pixels; identical for both, so no normalisation needed — but verify it,
# because a mismatch means one window was not where this script thought it was.
SW=$(magick identify -format '%wx%h' "$OUT/safari$SLUG.png")
CW=$(magick identify -format '%wx%h' "$OUT/chrome$SLUG.png")
echo
echo "safari: $SW"
echo "chrome: $CW"
[ "$SW" = "$CW" ] || die "capture sizes differ ($SW vs $CW) — the diff would be meaningless."

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
echo
echo "These are screenshots of a screen region. Delete them when done:  rm -rf $OUT"
