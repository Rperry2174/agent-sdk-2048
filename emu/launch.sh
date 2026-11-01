#!/bin/bash
# Launch one mGBA instance with the bridge on the given port (default 8889).
#   emu/launch.sh 8889   # regular player
#   emu/launch.sh 8890   # jev player
# Port 8888 is left free for a Grok Bot instance. Needs mGBA 0.11+ (0.10.x has no --script);
# set MGBA_APP to your mGBA.app path. Uses a per-port ROM copy so save files
# (high score SRAM) never collide between players.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8889}"
MGBA_APP="${MGBA_APP:-/Applications/mGBA.app}"
[ "$PORT" = "8888" ] && { echo "8888 is reserved for Grok Bot" >&2; exit 1; }
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "bridge already listening on $PORT"; exit 0; fi
sed "s/^local PORT = .*/local PORT = $PORT/" bridge.lua > "bridge-$PORT.lua"
[ -f "roms/2048-$PORT.gb" ] || cp roms/2048.gb "roms/2048-$PORT.gb"
open -n "$MGBA_APP" --args -4 --script "$PWD/bridge-$PORT.lua" "$PWD/roms/2048-$PORT.gb"
for i in $(seq 1 60); do
  lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && { echo "bridge up on $PORT"; exit 0; }
  sleep 0.25
done
echo "bridge on $PORT did not come up" >&2; exit 1
