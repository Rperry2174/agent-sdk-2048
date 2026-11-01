// Plays 2048 in the pure simulator (lib/sim.ts, seeded 2/4 spawns) with the real Jev policy
// (jevDecide, fallback off) and logs each move's exact state payload + decision.
// Usage: tsx scripts/sim-jev.ts [--seed 7] [--max 250] [--out runs/sim/jev-sim.jsonl]
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, hasJevKey, loadEnv } from "../lib/env.js";
loadEnv();
import type { Grid } from "../lib/game.js";
import { jevDecide, jevState } from "../lib/policy.js";
import { legalMoves, slide } from "../lib/sim.js";

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const seed0 = Number(opt("seed", "7"));
const max = Number(opt("max", "250"));
const out = join(REPO_ROOT, opt("out", "runs/sim/jev-sim.jsonl"));
if (!hasJevKey()) { console.error("TYPESAFE_API_KEY missing; refusing to fake Jev"); process.exit(1); }

let s = seed0 >>> 0;
const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function spawn(g: Grid) {
  const e: [number, number][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (g[r][c] === 0) e.push([r, c]);
  if (!e.length) return null;
  const [r, c] = e[Math.floor(rand() * e.length)];
  g[r][c] = rand() < 0.9 ? 2 : 4;
  return [r, c];
}

let grid: Grid = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
spawn(grid); spawn(grid);
let score = 0;
writeFileSync(out, "");
for (let n = 0; n < max; n++) {
  if (legalMoves(grid).length === 0) { console.log(`game over after ${n} moves, score ${score}`); break; }
  const state = jevState(grid, score);
  let d;
  for (let attempt = 0; ; attempt++) {
    try { d = await jevDecide(grid, score, { fallback: false }); break; }
    catch (e) { if (attempt >= 2) { console.error(`Jev failed at move ${n + 1}: ${(e as Error).message}`); process.exit(2); } }
  }
  const res = slide(grid, d.dir);
  const next = res.grid.map((r) => [...r]);
  const spawned = spawn(next);
  score += res.gained;
  appendFileSync(out, JSON.stringify({ n: n + 1, state, probabilities: d.probabilities, dir: d.dir, needsHuman: d.needsHuman, decisionMs: Math.round(d.decisionMs), gained: res.gained, spawned, next, scoreAfter: score }) + "\n");
  grid = next;
  if ((n + 1) % 25 === 0) console.log(`move ${n + 1} score ${score} max ${Math.max(...grid.flat())}`);
}
console.log(`done: score ${score}, max ${Math.max(...grid.flat())}`);
