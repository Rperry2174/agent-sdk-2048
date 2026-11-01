// Side-by-side race: two Agent SDK players, each on its own mGBA window/port.
//   regular (8889): a normal Agent SDK model turn (default model) picks each move via get_board + move. No Jev.
//   jev     (8890): Jev decide() picks each move (choose_move); moves are direct tool calls, no model turn.
// Both start from a soft reset to the title screen at the same instant. Score = what the game
// shows when the wall clock runs out.
//
// Usage: tsx scripts/race.ts [--minutes 5] [--to-game-over] [--max 500] [--only regular|jev]
//                            [--stand-in] [--no-rec] [--no-launch]
//   --stand-in  run the jev player with the expectimax heuristic instead of Jev (harness test only;
//               labeled STAND-IN everywhere). Without a TYPESAFE_API_KEY the jev player refuses to run
//               unless this flag is set.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@grok/agent-sdk";
import { bridge } from "../lib/bridge.js";
import { REPO_ROOT, hasJevKey, loadEnv, playerPort, type Player } from "../lib/env.js";
loadEnv(); // CURSOR_API_KEY / TYPESAFE_API_KEY from the git-ignored .env, before serve()
import { screenshot, type Dir, type Grid } from "../lib/game.js";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const toGameOver = flag("to-game-over");
// --clip: record every emulator frame for a 30 s blog clip (cut later by scripts/normalize-clip.sh)
const clip = flag("clip");
const minutes = toGameOver ? 0 : argv.includes("--seconds") ? Number(opt("seconds", "34")) / 60 : Number(opt("minutes", "5"));
const maxMoves = Number(opt("max", toGameOver ? "500" : "100000"));
const only = opt("only", "") as Player | "";
const players: Player[] = only ? [only] : ["regular", "jev"];
const standIn = flag("stand-in");
const jevPolicy = standIn ? "heuristic" : "jev";
if (players.includes("jev") && !standIn && !hasJevKey()) {
  console.error("jev player: TYPESAFE_API_KEY is not set in .env. Add it, or pass --stand-in for a labeled heuristic harness test.");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RACE_DIR = join(REPO_ROOT, "runs", `race-${stamp}${minutes ? `-${minutes}min` : "-to-game-over"}${standIn ? "-standin" : ""}`);
mkdirSync(RACE_DIR, { recursive: true });
process.env.RACE_DIR = RACE_DIR; // server tools run in this process and log presses here
const say = (s: string) => { console.log(s); appendFileSync(join(RACE_DIR, "race.log"), s + "\n"); };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. emulators, side by side
if (!flag("no-launch")) {
  for (const p of players) say(execFileSync("bash", [join(REPO_ROOT, "emu/launch.sh"), String(playerPort(p))]).toString().trim());
  await sleep(1500);
  try { execFileSync("bash", [join(REPO_ROOT, "emu/arrange.sh")], { stdio: "ignore" }); } catch { say("arrange.sh failed (window placement only; continuing)"); }
}

// 2. both agents in one Agent SDK server
const handle = await serve(join(REPO_ROOT, "agents"), { port: 0, mode: "multi" } as any);
const url = (p: Player) => handle.agents.find((a: any) => a.slug === p)!.url as string;
async function tool<T = any>(p: Player, name: string, input: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${url(p)}/v1/tools/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) });
  const j: any = await r.json();
  if (!j.ok || j.isError) throw new Error(`${p}/${name}: ${JSON.stringify(j.result ?? j).slice(0, 300)}`);
  return j.result as T;
}
const post = async (u: string, body: unknown) => (await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<any>;

say(`race dir: ${RACE_DIR}`);
say(`mode: ${minutes ? `${minutes} min wall clock` : `to game over (max ${maxMoves} moves)`}`);
say(`players: ${players.map((p) => `${p}@${playerPort(p)}${p === "jev" ? (standIn ? " [STAND-IN heuristic, NOT Jev]" : " [Jev]") : " [default model turn per move]"}`).join(", ")}`);

// 3. fresh games at the same instant
for (const p of players) {
  mkdirSync(join(RACE_DIR, `${p}-frames`), { recursive: true });
  if (!flag("no-rec")) await bridge(playerPort(p)).cmd(`REC ${join(RACE_DIR, `${p}-frames`)} ${clip ? 1 : 2}`);
}
// --warm: open the regular player's session and finish one throwaway model turn on the title screen,
// so the timed part starts with a warm session (blog backup take).
let warm: { sessionId: string; token: string; seen: number; warmMs: number } | null = null;
if (flag("warm") && players.includes("regular")) {
  const t = Date.now();
  const w = await post(`${url("regular")}/v1/session`, { message: "Warm-up: the game has not started yet. Reply with just READY and do not call any tools.", title: `warm ${stamp}` });
  if (!w.ok) throw new Error(`warm session failed: ${JSON.stringify(w).slice(0, 200)}`);
  for (;;) {
    await sleep(300);
    const ev: any = await (await fetch(`${url("regular")}/v1/session/${w.sessionId}/events?format=json`)).json();
    const evs: any[] = ev.events ?? [];
    if (evs.some((e) => e.type === "turn.failed")) throw new Error("warm-up turn failed");
    if (evs.some((e) => e.type === "turn.completed")) { warm = { sessionId: w.sessionId, token: w.continuationToken, seen: evs.length, warmMs: Date.now() - t }; break; }
    if (Date.now() - t > 120_000) throw new Error("warm-up turn timed out");
  }
  say(`[regular] warm-up turn done in ${warm.warmMs} ms (session ${warm.sessionId})`);
}
const raceStart = Date.now();
const deadline = minutes ? raceStart + minutes * 60_000 : Infinity;
await Promise.all(players.map((p) => tool(p, "new_game", {})));
const gamesReady = Date.now();
const clipInfo: Record<string, any> = {};
for (const p of players) {
  const f = Number(await bridge(playerPort(p)).cmd("FRAME"));
  clipInfo[p] = { startFrame: Number(await bridge(playerPort(p)).cmd("STARTF")), sample0: { frame: f, t: Date.now() }, warm: p === "regular" ? warm : null };
  const b0 = await tool(p, "get_board", {});
  clipInfo[p].startBoard = { score: b0.score, maxTile: b0.maxTile };
}
say(`games on screen after ${gamesReady - raceStart} ms; clock started at reset`);
const timeLeft = () => Date.now() < deadline;

type Result = Record<string, unknown>;

// 4a. jev player: get_board -> choose_move -> move, direct tool calls
async function runJev(): Promise<Result> {
  const p: Player = "jev";
  let b = await tool<{ grid: Grid; score: number; gameOver: boolean; won: boolean }>(p, "get_board", {});
  let moves = 0, invalid = 0, fallbacks = 0, errors = 0, lowConfidence = 0;
  const decision: number[] = [], emu: number[] = [];
  while (timeLeft() && moves < maxMoves && !b.gameOver && !b.won) {
    let d: { dir: Dir; ranking: Dir[]; decisionMs: number; fellBack?: boolean; needsHuman?: boolean; policy: string; probabilities?: unknown };
    try { d = await tool(p, "choose_move", { grid: b.grid, score: b.score, policy: jevPolicy }); }
    catch (e) { errors++; say(`jev decide error: ${(e as Error).message.slice(0, 160)}`); if (errors > 5) break; await sleep(500); continue; }
    if (!timeLeft()) break;
    let moved = false, emuMs = 0;
    for (const dir of d.ranking.length ? d.ranking : [d.dir]) {
      const m = await tool<any>(p, "move", { dir });
      emuMs += m.emulatorMs;
      if (m.moved) { moved = true; b = m; break; }
      invalid++;
    }
    if (!moved) break;
    moves++; decision.push(d.decisionMs); emu.push(emuMs); if (d.fellBack) fallbacks++; if (d.needsHuman) lowConfidence++;
    appendFileSync(join(RACE_DIR, "jev.moves.jsonl"), JSON.stringify({ n: moves, t: Date.now() - raceStart, dir: b && (b as any).dir, policy: d.policy, fellBack: !!d.fellBack, needsHuman: !!d.needsHuman, probabilities: d.probabilities ?? null, decisionMs: d.decisionMs, emulatorMs: emuMs, score: b.score, maxTile: (b as any).maxTile }) + "\n");
    if (moves % 50 === 0) say(`[jev] move ${moves}: score ${b.score}`);
  }
  return { decider: standIn ? "STAND-IN expectimax heuristic (no model) - NOT Jev" : "Jev decide() (jev-latest)", movesCounted: moves, invalidPresses: invalid, heuristicFallbacks: fallbacks, lowConfidenceMoves: lowConfidence, decideErrors: errors,
    medianDecisionMs: median(decision), p90DecisionMs: pct(decision, 0.9), medianEmulatorMs: median(emu) };
}

// 4b. regular player: one Agent SDK chat session; the model calls get_board/move each move
async function runRegular(): Promise<Result> {
  const p: Player = "regular";
  const base = url(p);
  const kickoff = "The game has started on your emulator. Play 2048 now: call get_board once, then keep calling move, one move per call, choosing from the board each call returns. Don't stop to write text; keep going until I stop you or the game is over.";
  let s = warm
    ? await post(`${base}/v1/session/${warm.sessionId}`, { continuationToken: warm.token, message: kickoff })
    : await post(`${base}/v1/session`, { message: kickoff, title: `race ${stamp}` });
  if (!s.ok) return { decider: "default model", error: `session create failed: ${JSON.stringify(s).slice(0, 200)}` };
  const sessionId = (warm?.sessionId ?? s.sessionId) as string; let token = s.continuationToken as string;
  say(`[regular] session ${sessionId}${warm ? " (warm)" : ""} (playground: ${s.playgroundUrl ?? "-"})`);
  let seen = warm?.seen ?? 0, turns = 1, failedTurns = 0, lastErr = "";
  let over = false;
  while (timeLeft() && !over) {
    await sleep(400);
    const ev: any = await (await fetch(`${base}/v1/session/${sessionId}/events?format=json`)).json();
    const events: any[] = ev.events ?? [];
    let ended = false;
    for (const e of events.slice(seen)) {
      if (e.type === "turn.completed") ended = true;
      if (e.type === "turn.failed") { ended = true; failedTurns++; lastErr = String(e.data?.message ?? e.data?.status ?? "").slice(0, 200); }
    }
    seen = events.length;
    const presses = readPresses(p);
    if (presses.at(-1)?.gameOver) over = true;
    if (presses.length >= maxMoves) break;
    if (ended && timeLeft() && !over) {
      if (failedTurns >= 3 && presses.length === 0) { say(`[regular] giving up: ${lastErr}`); break; }
      const f = await post(`${base}/v1/session/${sessionId}`, { continuationToken: token, message: "Keep playing. Next move." });
      if (f.ok) { token = f.continuationToken; turns++; } else { say(`[regular] follow-up refused: ${JSON.stringify(f).slice(0, 160)}`); break; }
    }
  }
  await post(`${base}/v1/session/${sessionId}/stop`, {}).catch(() => null);
  let cost: unknown = null;
  try { cost = await (await fetch(`${base}/v1/session/${sessionId}/cost`)).json(); } catch {}
  const presses = readPresses(p).filter((x) => x.tStart < deadline);
  const moved = presses.filter((x) => x.moved);
  // think time = gap between the end of one press and the start of the next (model step + tool round trip)
  const think: number[] = [];
  let prevEnd = raceStart;
  for (const x of presses) { think.push(x.tStart - prevEnd); prevEnd = x.tEnd; }
  return { decider: "default Agent SDK model (grok-4.7, reasoning_effort=high, fast)", sessionId, turns, failedTurns, lastTurnError: lastErr || null,
    movesCounted: moved.length, invalidPresses: presses.length - moved.length,
    medianDecisionMs: median(think.slice(1)), p90DecisionMs: pct(think.slice(1), 0.9), firstMoveMs: think[0] ?? null, medianEmulatorMs: median(presses.map((x) => x.emulatorMs)), cost };
}

function readPresses(p: Player): Array<{ tStart: number; tEnd: number; moved: boolean; emulatorMs: number; gameOver: boolean }> {
  const f = join(RACE_DIR, `${p}.presses.jsonl`);
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

const runners: Record<Player, () => Promise<Result>> = { regular: runRegular, jev: runJev };
const buzzer: Record<string, any> = {};
const results = await Promise.all(players.map(async (p) => {
  let r: Result;
  try { r = await runners[p](); } catch (e) { r = { error: (e as Error).message }; }
  return [p, r] as const;
}));
// Buzzer: score as shown when the clock ran out (or at game over)
for (const p of players) {
  buzzer[p] = await tool(p, "get_board", {});
  await screenshot(playerPort(p), join(RACE_DIR, `${p}-buzzer.png`));
}
const raceSeconds = (Date.now() - raceStart) / 1000;
await sleep(800);
for (const p of players) {
  const f = Number(await bridge(playerPort(p)).cmd("FRAME"));
  const c = clipInfo[p]; c.sample1 = { frame: f, t: Date.now() };
  // emulated seconds per wall second while playing; < ~0.97 means the emulator lagged (redo a clip take)
  c.speed = +(((c.sample1.frame - c.sample0.frame) / 60) / ((c.sample1.t - c.sample0.t) / 1000)).toFixed(4);
  if (!flag("no-rec")) c.recFrames = Number(await bridge(playerPort(p)).cmd("RECSTOP"));
  c.recEvery = clip ? 1 : 2;
  writeFileSync(join(RACE_DIR, `${p}-clip.json`), JSON.stringify(c, null, 2));
}

const summary: Record<string, unknown> = { mode: minutes ? `${minutes} min wall clock from title-screen reset` : `to game over (max ${maxMoves})`, raceSeconds: +raceSeconds.toFixed(1), players: {} };
for (const [p, r] of results) {
  const b = buzzer[p];
  const moves = Number(r.movesCounted ?? 0);
  // per-move latency, same definition for both players: time between consecutive board-changing presses
  // completing (decision + tool round trips + emulator), first one measured from the game being on screen.
  const ends = readPresses(p).filter((x) => x.moved && x.tStart < deadline).map((x) => x.tEnd);
  const lat = ends.map((t, i) => t - (i ? ends[i - 1] : gamesReady));
  Object.assign(r, { medianMoveLatencyMs: median(lat), p90MoveLatencyMs: pct(lat, 0.9) });
  (summary.players as any)[p] = { port: playerPort(p), ...r, score: b.score, maxTile: b.maxTile, gameOver: b.gameOver, movesPerMinute: +(moves / ((minutes ? minutes * 60 : raceSeconds) / 60)).toFixed(1), finalGrid: b.grid };
}
writeFileSync(join(RACE_DIR, "summary.json"), JSON.stringify(summary, null, 2));
say("\nplayer    decider                         moves  score  max   moves/min  move latency med/p90 ms  decision med/p90 ms");
for (const p of players) {
  const x = (summary.players as any)[p];
  say(`${p.padEnd(9)} ${String(x.decider ?? "").slice(0, 31).padEnd(31)} ${String(x.movesCounted ?? 0).padStart(5)} ${String(x.score).padStart(6)} ${String(x.maxTile).padStart(4)} ${String(x.movesPerMinute).padStart(10)} ${`${x.medianMoveLatencyMs}/${x.p90MoveLatencyMs}`.padStart(24)} ${`${x.medianDecisionMs ?? "-"}/${x.p90DecisionMs ?? "-"}`.padStart(20)}${x.error ? `  ERROR: ${x.error}` : ""}`);
}
say(`summary: ${join(RACE_DIR, "summary.json")}`);
for (const p of players) bridge(playerPort(p)).close();
await handle.close();
process.exit(0);
