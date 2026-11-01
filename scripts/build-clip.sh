#!/bin/bash
# Clips from the emulator's own frames (REC), never a screen recording.
# Usage: scripts/build-clip.sh runs/race-<...>
# Writes <player>.mp4 (real time) for each player, and side-by-side.mp4 when both exist.
set -euo pipefail
RUN="${1:?race dir}"
for P in regular jev; do
  [ -d "$RUN/$P-frames" ] && [ -n "$(ls "$RUN/$P-frames" | head -1)" ] || continue
  ffmpeg -y -loglevel error -framerate 30 -pattern_type glob -i "$RUN/$P-frames/f*.png" -vf "scale=480:432:flags=neighbor,format=yuv420p" -c:v libx264 -crf 18 "$RUN/$P.mp4"
done
if [ -f "$RUN/regular.mp4" ] && [ -f "$RUN/jev.mp4" ]; then
  ffmpeg -y -loglevel error -i "$RUN/regular.mp4" -i "$RUN/jev.mp4" -filter_complex \
    "[0:v]pad=490:470:5:34:color=0x202020,drawtext=text='regular (model turn)':x=10:y=8:fontsize=20:fontcolor=white[a];[1:v]pad=490:470:5:34:color=0x202020,drawtext=text='jev':x=10:y=8:fontsize=20:fontcolor=white[b];[a][b]hstack=inputs=2:shortest=0" \
    -c:v libx264 -crf 20 -pix_fmt yuv420p "$RUN/side-by-side.mp4" || \
  ffmpeg -y -loglevel error -i "$RUN/regular.mp4" -i "$RUN/jev.mp4" -filter_complex "[0:v][1:v]hstack=inputs=2:shortest=0" -c:v libx264 -crf 20 -pix_fmt yuv420p "$RUN/side-by-side.mp4"
fi
ls -la "$RUN"/*.mp4
