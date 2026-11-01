// 2048-gb RAM map and game actions over the mGBA bridge.
// Addresses come from the 2048-gb source (constants.asm) and were verified
// against screenshots; see RAM.md.
import { bridge } from "./bridge.js";

export const RAM = {
  GRID: 0xc800, // W_2048GRID: 16 bytes, row-major, value = log2(tile) (0 = empty)
  SCORE: 0xffb0, // H_SCORE: 3 bytes, big-endian packed BCD
  HIGHSCORE: 0xffb3, // H_HIGHSCORE: 3 bytes BCD
  GAMEOVER: 0xffb8, // H_GAMEOVER: 0 playing, 1 lost, 2 reached 2048
  ANIMATE: 0xffa6, // H_ANIMATE: nonzero while a slide animation runs
} as const;

export type Dir = "up" | "down" | "left" | "right";
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];
export type Grid = number[][]; // 4x4 tile values (0, 2, 4, 8, ...)

export type GameState = {
  grid: Grid;
  score: number;
  highScore: number;
  maxTile: number;
  empty: number;
  gameOver: boolean;
  won: boolean;
  animating: boolean;
  busy: number;
  frame: number;
};

const bcd = (hex: string) => Number(hex.replace(/[^0-9]/g, "") || 0);

export function parseState(line: string): GameState {
  // STATE reply: <grid 32 hex> <score 6 hex> <hi 6 hex> <gameover> <animate> <busy> <frame>
  const [g, s, h, go, an, busy, frame] = line.trim().split(/\s+/);
  if (!g || g.length !== 32) throw new Error(`bad STATE reply: ${line.slice(0, 40)}`);
  const cells = Array.from({ length: 16 }, (_, i) => parseInt(g.slice(i * 2, i * 2 + 2), 16) & 0x1f);
  const grid = [0, 1, 2, 3].map((r) => cells.slice(r * 4, r * 4 + 4).map((e) => (e === 0 ? 0 : 2 ** e)));
  const flat = grid.flat();
  return {
    grid,
    score: bcd(s),
    highScore: bcd(h),
    maxTile: Math.max(...flat),
    empty: flat.filter((v) => v === 0).length,
    gameOver: Number(go) === 1,
    won: Number(go) === 2,
    animating: Number(an) !== 0,
    busy: Number(busy),
    frame: Number(frame),
  };
}

export async function readState(port: number): Promise<GameState> {
  return parseState(await bridge(port).read("STATE"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sameGrid = (a: Grid, b: Grid) => a.flat().join() === b.flat().join();

/** Wait until no input is queued and no animation runs. */
export async function settle(port: number, minFrame = 0, timeoutMs = 4000): Promise<GameState> {
  const t0 = Date.now();
  for (;;) {
    const s = await readState(port);
    if (s.busy === 0 && !s.animating && s.frame >= minFrame) return s;
    if (Date.now() - t0 > timeoutMs) return s;
    await sleep(8);
  }
}

export type MoveResult = {
  dir: Dir;
  moved: boolean;
  confirmed: boolean;
  before: GameState;
  after: GameState;
  gained: number;
  emulatorMs: number;
  frames: number;
};

const PRESS_FRAMES = 10; // Grok Bot bridge tip: hold every key >= 10 frames

/**
 * Press one direction exactly once and report whether the board changed.
 * The press is never resent: if the socket drops mid-command, the result is
 * read back from RAM instead.
 */
export async function move(port: number, dir: Dir): Promise<MoveResult> {
  const before = await settle(port);
  const t0 = performance.now();
  let confirmed = true;
  try {
    const ok = await bridge(port).cmd(`PRESS ${dir.toUpperCase()} ${PRESS_FRAMES}`);
    if (ok !== "OK") throw new Error(`PRESS refused: ${ok}`);
  } catch {
    confirmed = false; // unknown whether the press landed; RAM will tell
  }
  // press + release gap + at least one game-loop frame after release
  const after = await settle(port, before.frame + PRESS_FRAMES + 4);
  const emulatorMs = performance.now() - t0;
  const moved = !sameGrid(before.grid, after.grid);
  return {
    dir,
    moved,
    confirmed: confirmed || moved,
    before,
    after,
    gained: after.score - before.score,
    emulatorMs,
    frames: after.frame - before.frame,
  };
}

/** Soft-reset the emulator, then start a fresh game from the title screen. */
export async function newGame(port: number): Promise<GameState> {
  await bridge(port).cmd("RESET");
  await bridge(port).cmd("WAIT 90"); // boot + title fade-in
  await bridge(port).cmd("PRESS START 10");
  const t0 = Date.now();
  for (;;) {
    const s = await settle(port);
    const tiles = s.grid.flat().filter((v) => v > 0).length;
    if (tiles === 2 && s.score === 0 && !s.gameOver) {
      await bridge(port).cmd("WAIT 40"); // let the fade-from-white finish
      return await settle(port);
    }
    if (Date.now() - t0 > 8000) throw new Error("new game did not start");
    await sleep(50);
  }
}

export async function screenshot(port: number, path: string): Promise<void> {
  await bridge(port).cmd(`SHOT ${path}`);
}

export async function say(port: number, text: string): Promise<void> {
  await bridge(port).cmd(`LOG ${text.replace(/[\r\n]+/g, " ")}`);
}

export function renderGrid(grid: Grid): string {
  return grid.map((r) => r.map((v) => String(v || ".").padStart(5)).join("")).join("\n");
}
