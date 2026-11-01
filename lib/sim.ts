// Pure 2048 rules (same as 2048-gb): slide, merge once per tile per move.
import type { Dir, Grid } from "./game.js";

export type Slide = { grid: Grid; moved: boolean; gained: number; merges: number };

function slideRowLeft(row: number[]): { row: number[]; gained: number; merges: number } {
  const tiles = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0, merges = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2); gained += tiles[i] * 2; merges++; i++;
    } else out.push(tiles[i]);
  }
  while (out.length < 4) out.push(0);
  return { row: out, gained, merges };
}

const transpose = (g: Grid): Grid => g[0].map((_, c) => g.map((r) => r[c]));
const reverseRows = (g: Grid): Grid => g.map((r) => [...r].reverse());

export function slide(grid: Grid, dir: Dir): Slide {
  let g = grid.map((r) => [...r]);
  // normalize so that the move is "left"
  if (dir === "right") g = reverseRows(g);
  if (dir === "up") g = transpose(g);
  if (dir === "down") g = reverseRows(transpose(g));
  let gained = 0, merges = 0;
  g = g.map((r) => { const s = slideRowLeft(r); gained += s.gained; merges += s.merges; return s.row; });
  if (dir === "right") g = reverseRows(g);
  if (dir === "up") g = transpose(g);
  if (dir === "down") g = transpose(reverseRows(g));
  const moved = g.flat().join() !== grid.flat().join();
  return { grid: g, moved, gained, merges };
}

export function legalMoves(grid: Grid): Dir[] {
  return (["up", "down", "left", "right"] as Dir[]).filter((d) => slide(grid, d).moved);
}
