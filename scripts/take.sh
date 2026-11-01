#!/bin/bash
# One blog clip take, to the shared spec. Fresh emulator on 8890, quit afterwards.
#   scripts/take.sh regular regular-30s
#   scripts/take.sh jev jev-30s
#   scripts/take.sh regular regular-warm-30s --warm
# Retries (up to 3 attempts) when a frame is missing or the speed check is below 0.97.
set -uo pipefail
cd "$(dirname "$0")/.."
PLAYER="$1"; NAME="$2"; EXTRA="${3:-}"; PORT=8890
mkdir -p recordings
quit_emu() {
  local P; P=$(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null)
  if [ -n "$P" ] && ps -p "$P" -o command= | grep -q "bridge-$PORT.lua"; then kill "$P"; sleep 2; fi
  lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && echo "WARN: $PORT still busy" || echo "emulator on $PORT quit"
}
for attempt in 1 2 3; do
  echo "== $NAME attempt $attempt $(date)"
  quit_emu
  bash emu/launch.sh $PORT || exit 1
  sleep 2   # fresh boot lands on the title screen
  OUT=$(REGULAR_PORT=$PORT JEV_PORT=$PORT npx tsx scripts/race.ts --only "$PLAYER" --seconds 34 --clip --no-launch $EXTRA 2>&1)
  echo "$OUT" | grep -v "^\[session\]\|INFO\|otel" | tail -8
  RUN=$(echo "$OUT" | sed -n 's/^race dir: //p' | tail -1)
  quit_emu
  [ -n "$RUN" ] && [ -f "$RUN/$PLAYER-clip.json" ] || { echo "no clip.json"; continue; }
  S=$(python3 -c "import json;print(json.load(open('$RUN/$PLAYER-clip.json'))['startFrame'])")
  SPEED=$(python3 -c "import json;print(json.load(open('$RUN/$PLAYER-clip.json'))['speed'])")
  echo "START frame $S, speed $SPEED"
  python3 -c "import sys; sys.exit(0 if $SPEED >= 0.97 else 1)" || { echo "speed below 0.97: redo"; continue; }
  bash scripts/normalize-clip.sh frames "$RUN/$PLAYER-frames" "$S" "recordings/$NAME.mp4" || { echo "normalize failed: redo"; continue; }
  python3 scripts/clip-stats.py "$RUN" "$PLAYER" | python3 -c "import json,sys;d=json.load(sys.stdin);d['run']='$RUN';d['attempt']=$attempt;json.dump(d,open('recordings/$NAME.json','w'),indent=2);print('STATS',json.dumps(d))"
  echo "TAKE OK $NAME"; exit 0
done
echo "TAKE FAILED $NAME"; exit 1
