#!/bin/bash
# Window placement only (no screen recording): regular (8889) on the left,
# jev (8890) on the right, each scripting console under its game window.
set -uo pipefail
place() { # port x
  local PID; PID=$(pgrep -f "bridge-$1.lua" | head -1)
  [ -z "$PID" ] && { echo "no mGBA on $1"; return; }
  osascript <<OSA
tell application "System Events"
  set p to first process whose unix id is $PID
  set gw to (first window of p whose name starts with "mGBA")
  set position of gw to {$2, 40}
  set size of gw to {660, 620}
  try
    set sw to window "Scripting" of p
    set position of sw to {$2, 670}
    set size of sw to {660, 260}
  end try
  perform action "AXRaise" of gw
end tell
OSA
}
place 8889 20
place 8890 700
