#!/usr/bin/env bash
# Film the running game and cut out the frames around each marked event.
#
# The game prints "FILM <frame> <event>" at every moment worth looking at,
# and --write-movie runs a fixed timestep, so that frame number IS the movie
# frame index. That is what makes this exact rather than a scrub through a
# video hoping to land on contact.
#
#   tools/capture.sh <outdir> [seed] [seconds] [portrait|landscape]
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT=${1:?usage: capture.sh <outdir> [seed] [seconds] [portrait|landscape]}
SEED=${2:-1234}
SECS=${3:-40}
FPS=30
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/film.avi "$OUT"/marks.txt 2>/dev/null || true

# The project ships landscape; iOS-first means portrait is the primary read,
# so the orientation is an explicit argument rather than whatever the
# project file happens to default to.
RES=720x1280
[[ "${4:-}" == "landscape" ]] && RES=1280x720

xvfb-run -a --server-args="-screen 0 1600x1600x24" \
  godot --path threesewers --resolution "$RES" \
    --write-movie "$OUT/film.avi" --fixed-fps $FPS \
    --quit-after $((SECS * FPS)) \
    -- --smoke --rt --film "--seed=$SEED" \
  2>&1 | tee "$OUT/run.log" | grep -E "^(FILM|smoke:)" || true

grep "^FILM " "$OUT/run.log" > "$OUT/marks.txt" || true
echo "--- marks ---"; cat "$OUT/marks.txt"

# Pull a short strip around each mark: 4 frames before, 10 after. Contact and
# its hit-stop, shake and burst all live inside that window.
n=0
while read -r _ frame event; do
  n=$((n + 1))
  start=$((frame - 4)); (( start < 0 )) && start=0
  slug=$(echo "$event" | tr -c 'a-zA-Z0-9' '_' | cut -c1-20)
  ffmpeg -nostdin -loglevel error -y -i "$OUT/film.avi" \
    -vf "select='between(n\,$start\,$((frame + 10)))'" -vsync 0 \
    "$OUT/$(printf '%02d' $n)_${slug}_%02d.png"
done < "$OUT/marks.txt"

echo "--- frames ---"; ls "$OUT"/*.png | head -60
