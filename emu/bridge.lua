-- emu/bridge.lua : Agent SDK <-> mGBA bridge for agent-sdk-2048.
-- Derived from Grok Bot's mGBA bridge (same line protocol), with:
--   * its own port (8889) so it never collides with a Grok Bot instance on 8888
--   * STATE: one-shot board/score/flags read for 2048-gb (one round trip per poll)
--   * RB <addr> <n>: read n bytes as hex (for RAM diffing)
--   * RESET: soft reset
-- Commands: PRESS <KEY> [frames] | WAIT <frames> | BUSY | FRAME | SHOT <png> | LOG <text>
--           REC <dir> [every] | RECSTOP | STARTF | R8/R16/R32 <addr> | RB <addr> <n> | STATE | RESET | SAVE/LOAD <slot>
local PORT = 8889
local KEYS = {A=0, B=1, SELECT=2, START=3, RIGHT=4, LEFT=5, UP=6, DOWN=7, R=8, L=9}
local RELEASE_GAP = 4 -- frames between presses (Grok Bot's bridge uses 8)
local queue, cur, frames = {}, nil, 0
local recDir, recN, recEvery, lastStart = nil, 0, 2, -1

callbacks:add("frame", function()
  frames = frames + 1
  -- REC frames are named by emulator frame number so clips can be cut on exact frames
  if recDir and frames % recEvery == 0 then recN = recN + 1; emu:screenshot(string.format("%s/f%08d.png", recDir, frames)) end
  if cur then
    cur.n = cur.n - 1
    if cur.n <= 0 then
      if cur.key then emu:clearKey(cur.key); cur = {n = RELEASE_GAP} else cur = nil end
    end
  elseif #queue > 0 then
    cur = table.remove(queue, 1)
    if cur.key then emu:addKey(cur.key); if cur.key == KEYS.START then lastStart = frames end end
  end
end)

local function hexbytes(addr, n)
  local t = {}
  for i = 0, n - 1 do t[#t + 1] = string.format("%02x", emu:read8(addr + i)) end
  return table.concat(t)
end

local function handle(line)
  local cmd, a, b = line:match("^(%S+)%s*(%S*)%s*(%S*)")
  cmd = cmd and cmd:upper()
  if cmd == "PRESS" and KEYS[a:upper()] then table.insert(queue, {key=KEYS[a:upper()], n=tonumber(b) or 4}); return "OK"
  elseif cmd == "WAIT" then table.insert(queue, {n=tonumber(a) or 30}); return "OK"
  elseif cmd == "BUSY" then return tostring(#queue + (cur and 1 or 0))
  elseif cmd == "FRAME" then return tostring(frames)
  elseif cmd == "STATE" then
    -- grid(16) score(3 BCD) hiscore(3 BCD) gameover animate busy frame
    return string.format("%s %s %s %d %d %d %d", hexbytes(0xC800, 16), hexbytes(0xFFB0, 3), hexbytes(0xFFB3, 3),
      emu:read8(0xFFB8), emu:read8(0xFFA6), #queue + (cur and 1 or 0), frames)
  elseif cmd == "RB" then return hexbytes(tonumber(a), math.min(tonumber(b) or 1, 1024))
  elseif cmd == "RESET" then queue = {}; if cur and cur.key then emu:clearKey(cur.key) end; cur = nil; emu:reset(); return "OK"
  elseif cmd == "REC" then recDir = a; recN = 0; recEvery = tonumber(b) or 2; return "OK"
  elseif cmd == "STARTF" then return tostring(lastStart) -- frame on which START last went down
  elseif cmd == "RECSTOP" then recDir = nil; return tostring(recN)
  elseif cmd == "LOG" then console:log(line:sub(5)); return "OK"
  elseif cmd == "SHOT" then emu:screenshot(a); return "OK"
  elseif cmd == "R8"  then return tostring(emu:read8(tonumber(a)))
  elseif cmd == "R16" then return tostring(emu:read16(tonumber(a)))
  elseif cmd == "R32" then return tostring(emu:read32(tonumber(a)))
  elseif cmd == "SAVE" then return tostring(emu:saveStateSlot(tonumber(a)))
  elseif cmd == "LOAD" then return tostring(emu:loadStateSlot(tonumber(a))) end
  return "ERR " .. tostring(line)
end

local clients = {}
local server = assert(socket.bind("127.0.0.1", PORT))
assert(server:listen())

local function onClient(id)
  local s = clients[id]
  while true do
    local data, err = s:receive(4096)
    if data and #data > 0 then
      s.buf = (s.buf or "") .. data
      while true do
        local line, rest = s.buf:match("^([^\r\n]*)\r?\n(.*)$")
        if not line then break end
        s.buf = rest
        if #line > 0 then s:send(handle(line) .. "\n") end
      end
    else
      if err ~= socket.ERRORS.AGAIN then clients[id] = nil; s:close() end
      return
    end
  end
end

local nextId = 1
server:add("received", function()
  local s = server:accept()
  if not s then return end
  local id = nextId; nextId = nextId + 1
  clients[id] = s
  s:add("received", function() onClient(id) end)
  s:add("error", function() clients[id] = nil end)
end)

callbacks:add("frame", function()
  server:poll()
  for id, s in pairs(clients) do s:poll() end
end)
console:log("agent-sdk-2048 bridge listening on 127.0.0.1:" .. PORT)
