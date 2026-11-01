// Optional simulator backend for the player tools. When SIM_BOARD_FILE points at a JSON
// file { grid, score, seed? }, get_board / move read and write that board through the pure
// rules in sim.ts instead of the mGBA bridge. Used to trace both agents on the same board.
import { readFileSync, writeFileSync } from "node:fs";
import type { Dir, Grid } from "./game.js";
import { legalMoves, slide } from "./sim.js";

type SimFile = { grid: Grid; score: number; seed?: number };
export const simBoardFile = () => process.env.SIM_BOARD_FILE || "";

function load(): SimFile { return JSON.parse(readFileSync(simBoardFile(), "utf8")); }
function save(s: SimFile) { writeFileSync(simBoardFile(), JSON.stringify(s)); }

function view(s: SimFile) {
  const flat = s.grid.flat();
  return { grid: s.grid, score: s.score, maxTile: Math.max(...flat), empty: flat.filter((v) => v === 0).length, gameOver: legalMoves(s.grid).length === 0, won: flat.includes(2048) };
}

export function simRead() { return view(load()); }

export function simMove(dir: Dir) {
  const s = load();
  const r = slide(s.grid, dir);
  if (!r.moved) return { moved: false, gained: 0, after: view(s) };
  let seed = (s.seed ?? 7) >>> 0;
  const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const e: [number, number][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (r.grid[i][j] === 0) e.push([i, j]);
  if (e.length) { const [i, j] = e[Math.floor(rand() * e.length)]; r.grid[i][j] = rand() < 0.9 ? 2 : 4; }
  const next = { grid: r.grid, score: s.score + r.gained, seed };
  save(next);
  return { moved: true, gained: r.gained, after: view(next) };
}
