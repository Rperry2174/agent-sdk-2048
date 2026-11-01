// Move policies. The Jev policy is the real one; the heuristic is a clearly
// labeled stand-in (expectimax, no model) used when TYPESAFE_API_KEY is absent
// and as the needsHuman fallback.
import { decide, needsHuman } from "@grok/agent-sdk/extensions/jev";
import { DIRS, type Dir, type Grid } from "./game.js";
import { hasJevKey } from "./env.js";
import { legalMoves, slide } from "./sim.js";

export type PolicyName = "jev" | "heuristic";

export type Decision = {
  dir: Dir; // best legal move
  ranking: Dir[]; // legal moves, best first (fallbacks if the emulator rejects one)
  policy: PolicyName; // who actually decided this move
  probabilities?: Record<Dir, number>;
  needsHuman?: boolean;
  fellBack?: boolean; // Jev was unsure, heuristic decided
  decisionMs: number;
};

// ---------------------------------------------------------------- heuristic

// Snake weights anchored in the bottom-left corner.
const W: number[][] = [
  [2 ** 0, 2 ** 1, 2 ** 2, 2 ** 3],
  [2 ** 7, 2 ** 6, 2 ** 5, 2 ** 4],
  [2 ** 8, 2 ** 9, 2 ** 10, 2 ** 11],
  [2 ** 15, 2 ** 14, 2 ** 13, 2 ** 12],
];

function staticScore(g: Grid): number {
  let s = 0, empty = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const v = g[r][c];
    if (v === 0) empty++;
    s += W[r][c] * v;
  }
  return s + empty * 2 ** 12;
}

function chance(g: Grid, depth: number): number {
  const empties: [number, number][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (g[r][c] === 0) empties.push([r, c]);
  if (empties.length === 0) return staticScore(g);
  let total = 0;
  for (const [r, c] of empties) {
    for (const [v, p] of [[2, 0.9], [4, 0.1]] as const) {
      g[r][c] = v;
      total += p * maxNode(g, depth - 1);
      g[r][c] = 0;
    }
  }
  return total / empties.length;
}

function maxNode(g: Grid, depth: number): number {
  if (depth <= 0) return staticScore(g);
  let best = -Infinity;
  for (const d of DIRS) {
    const s = slide(g, d);
    if (!s.moved) continue;
    best = Math.max(best, chance(s.grid, depth));
  }
  return best === -Infinity ? staticScore(g) - 2 ** 20 : best;
}

export function heuristicDecide(grid: Grid): Decision {
  const t0 = performance.now();
  const legal = legalMoves(grid);
  const empty = grid.flat().filter((v) => v === 0).length;
  const depth = empty >= 6 ? 2 : 3;
  const scored = legal.map((d) => ({ d, v: chance(slide(grid, d).grid, depth) }));
  scored.sort((a, b) => b.v - a.v);
  const ranking = scored.map((x) => x.d);
  return { dir: ranking[0] ?? "down", ranking, policy: "heuristic", decisionMs: performance.now() - t0 };
}

// ---------------------------------------------------------------------- jev

export const MOVE_QUESTION = {
  type: "choice",
  instructions:
    "You are playing 2048. Pick the single best next move for the board in `grid` (row 0 is the top, row 3 the bottom). " +
    "Strategy: keep the largest tile in the bottom-left corner, keep the bottom row full and in descending order from left to right, " +
    "prefer moves that merge tiles and leave more empty cells, and never pick a move whose `legal` is false. " +
    "`after` shows each move's resulting board before the new tile spawns.",
  criteria: {
    down: "Slide every tile down. Strong default: it keeps big tiles packed on the bottom row.",
    left: "Slide every tile left. Strong default with down: it keeps the biggest tile in the bottom-left corner.",
    right: "Slide every tile right. Use only when down and left are illegal or clearly worse; it can pull the biggest tile out of the corner.",
    up: "Slide every tile up. Last resort: it lifts tiles off the bottom row and breaks the corner.",
  },
} as const;

export function jevState(grid: Grid, score: number) {
  const moves: Record<string, unknown> = {};
  for (const d of DIRS) {
    const s = slide(grid, d);
    moves[d] = { legal: s.moved, after: s.moved ? s.grid : null, points: s.gained, merges: s.merges, emptyAfter: s.grid.flat().filter((v) => v === 0).length };
  }
  return { grid, score, maxTile: Math.max(...grid.flat()), moves };
}

export async function jevDecide(grid: Grid, score: number, opts: { fallback?: boolean; threshold?: number } = {}): Promise<Decision> {
  const t0 = performance.now();
  const answers = await decide({ state: jevState(grid, score), questions: { move: MOVE_QUESTION } });
  const ans = answers.move;
  const probs = ans.probabilities as Record<Dir, number>;
  const legal = new Set(legalMoves(grid));
  const ranking = [...DIRS].filter((d) => legal.has(d)).sort((a, b) => (probs[b] ?? 0) - (probs[a] ?? 0));
  const unsure = needsHuman(ans, opts.threshold);
  const decisionMs = performance.now() - t0;
  if (unsure && (opts.fallback ?? process.env.JEV_FALLBACK === "1")) { // off by default: the jev player plays pure Jev; low confidence is only counted
    const h = heuristicDecide(grid);
    return { ...h, policy: "heuristic", probabilities: probs, needsHuman: true, fellBack: true, decisionMs: decisionMs + h.decisionMs };
  }
  return { dir: ranking[0] ?? "down", ranking, policy: "jev", probabilities: probs, needsHuman: unsure, fellBack: false, decisionMs };
}

export function defaultPolicy(): PolicyName {
  return hasJevKey() ? "jev" : "heuristic";
}

export async function chooseMove(grid: Grid, score: number, policy: PolicyName = defaultPolicy(), opts: { fallback?: boolean } = {}): Promise<Decision> {
  if (policy === "jev") return jevDecide(grid, score, opts);
  return heuristicDecide(grid);
}
