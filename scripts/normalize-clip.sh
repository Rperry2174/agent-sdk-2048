#!/bin/bash
# Normalize a 2048 blog clip to the shared spec (agreed with Grok Bot):
#   title screen, START at exactly t=0.5 s, 30.000 s total at real speed,
#   640x576 (160x144 x4, nearest neighbor), constant 30 fps, H.264 yuv420p, no audio, no overlays.
#
# From our REC frames (every emulator frame, named fNNNNNNNN.png, START frame from <player>-clip.json):
#   scripts/normalize-clip.sh frames <frames-dir> <start-frame> <out.mp4>
#     takes emulator frames S-30, S-28, ... (900 frames = 30.0 s at 30 fps; START lands on output frame 15 = 0.500 s)
#     and fails if any frame is missing (a dropped/stalled take must be redone).
# From any video (e.g. Grok Bot's clip), given the time its START press happens:
#   scripts/normalize-clip.sh video <in.mp4> <start-seconds> <out.mp4>
#     cuts from start-0.5 s for 30.0 s, same filters.
# Composite (no labels), left to right in the given order:
#   scripts/normalize-clip.sh stack <out.mp4> <a.mp4> <b.mp4> [<c.mp4> ...]
set -euo pipefail
FF="${FFMPEG:-$(command -v ffmpeg)}"
ENC=(-an -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -r 30 -fps_mode cfr -movflags +faststart)
VF="scale=640:576:flags=neighbor,setsar=1,format=yuv420p"
mode="$1"; shift
case "$mode" in
  frames)
    DIR="$1"; S="$2"; OUT="$3"; TMP=$(mktemp -d)
    for i in $(seq 0 899); do
      f=$(printf "%s/f%08d.png" "$DIR" $((S - 30 + 2 * i)))
      [ -f "$f" ] || { echo "missing frame $((S - 30 + 2 * i)) (output frame $i): take is not clean, redo it" >&2; rm -rf "$TMP"; exit 3; }
      ln -s "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")" "$TMP/$(printf %06d $i).png"
    done
    "$FF" -y -loglevel error -framerate 30 -i "$TMP/%06d.png" -vf "$VF" -frames:v 900 "${ENC[@]}" "$OUT"
    rm -rf "$TMP" ;;
  video)
    IN="$1"; T="$2"; OUT="$3"
    SS=$(python3 -c "print(max(0.0, $T - 0.5))")
    "$FF" -y -loglevel error -ss "$SS" -i "$IN" -vf "fps=30,$VF" -frames:v 900 "${ENC[@]}" "$OUT" ;;
  stack)
    OUT="$1"; shift; IN=(); for f in "$@"; do IN+=(-i "$f"); done
    "$FF" -y -loglevel error "${IN[@]}" -filter_complex "hstack=inputs=$#,format=yuv420p" -frames:v 900 "${ENC[@]}" "$OUT" ;;
  *) echo "usage: see header" >&2; exit 2 ;;
esac
command -v ffprobe >/dev/null && ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=width,height,r_frame_rate,nb_read_frames,pix_fmt,codec_name:format=duration -of compact "$OUT" \
  || "$(dirname "$FF")/ffprobe" -v error -select_streams v:0 -count_frames -show_entries stream=width,height,r_frame_rate,nb_read_frames,pix_fmt,codec_name:format=duration -of compact "$OUT"
