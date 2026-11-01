// Tool factories shared by both players. Each player gets its own emulator
// port, so the same tool code drives a different mGBA window.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool } from "@grok/agent-sdk/tools";
import { z } from "zod";
import { trace } from "@opentelemetry/api";
import { jevState, MOVE_QUESTION } from "./policy.js";
import { playerPort, type Player } from "./env.js";
import { move, newGame, readState, renderGrid } from "./game.js";
import { chooseMove, defaultPolicy } from "./policy.js";
import { simBoardFile, simMove, simRead } from "./simboard.js";

/** When RACE_DIR is set (by scripts/race.ts), every press is logged to <RACE_DIR>/<player>.presses.jsonl. */
function logPress(player: Player, row: Record<string, unknown>) {
  const dir = process.env.RACE_DIR;
  if (dir) appendFileSync(join(dir, `${player}.presses.jsonl`), JSON.stringify(row) + "\n");
}

export const getBoardTool = (player: Player) =>
  defineTool({
    description:
      "Read the live 2048 board from emulator RAM: `grid` is 4x4 tile values (row 0 is the top, 0 = empty), plus score, max tile, and whether the game is over.",
    inputSchema: z.object({}),
    effect: "read",
    async execute() {
      const s = simBoardFile() ? simRead() : await readState(playerPort(player));
      return { grid: s.grid, text: renderGrid(s.grid), score: s.score, maxTile: s.maxTile, empty: s.empty, gameOver: s.gameOver, won: s.won };
    },
  });

export const moveTool = (player: Player) =>
  defineTool({
    description:
      "Press one direction once and return the new board. `moved: false` means the move was invalid (board unchanged); pick another direction. The press is never repeated.",
    inputSchema: z.object({ dir: z.enum(["up", "down", "left", "right"]) }),
    effect: "write",
    dryRunResult: ({ dir }) => ({ dir, moved: false, dryRun: true }),
    async execute({ dir }, ctx) {
      if (ctx.session.purpose === "eval") return { dir, moved: false, reason: "eval" };
      if (simBoardFile()) {
        const r = simMove(dir);
        return { dir, moved: r.moved, gained: r.gained, grid: r.after.grid, text: renderGrid(r.after.grid), score: r.after.score, maxTile: r.after.maxTile, gameOver: r.after.gameOver, won: r.after.won, backend: "sim" };
      }
      const tStart = Date.now();
      const r = await move(playerPort(player), dir);
      const tEnd = Date.now();
      logPress(player, { tStart, tEnd, dir, moved: r.moved, confirmed: r.confirmed, emulatorMs: Math.round(r.emulatorMs), score: r.after.score, maxTile: r.after.maxTile, gameOver: r.after.gameOver, session: ctx.session.id ?? null });
      return {
        dir, moved: r.moved, gained: r.gained,
        grid: r.after.grid, text: renderGrid(r.after.grid), score: r.after.score, maxTile: r.after.maxTile,
        gameOver: r.after.gameOver, won: r.after.won, emulatorMs: Math.round(r.emulatorMs),
      };
    },
  });

export const newGameTool = (player: Player) =>
  defineTool({
    description: "Soft-reset the emulator and start a fresh 2048 game from the title screen. Ends the current game. Only when the user asks.",
    inputSchema: z.object({}),
    effect: "write",
    dryRunResult: () => ({ started: false, dryRun: true }),
    async execute(_input, ctx) {
      if (ctx.session.purpose === "eval") return { started: false, reason: "eval" };
      const s = await newGame(playerPort(player));
      return { started: true, grid: s.grid, text: renderGrid(s.grid), score: s.score };
    },
  });

export const chooseMoveTool = () =>
  defineTool({
    description:
      "Ask the move policy for the best next move on a 4x4 board. Jev (typed choice over up/down/left/right) when TYPESAFE_API_KEY is set; otherwise a labeled expectimax stand-in. Returns the move, ranked legal fallbacks, and which policy decided.",
    inputSchema: z.object({
      grid: z.array(z.array(z.number().int().min(0)).length(4)).length(4).describe("Row 0 is the top. 0 = empty."),
      score: z.number().int().min(0).default(0),
      policy: z.enum(["jev", "heuristic"]).optional(),
    }),
    effect: "read",
    async execute({ grid, score, policy }) {
      const which = policy ?? defaultPolicy();
      // A child span around the decision so traces show the state Jev saw and what it answered.
      return trace.getTracer("agent-sdk-2048").startActiveSpan(which === "jev" ? "jev.decide" : "heuristic.decide", async (span) => {
        try {
          if (which === "jev") {
            span.setAttribute("jev.model", "jev-latest");
            span.setAttribute("jev.question", JSON.stringify({ move: { type: MOVE_QUESTION.type, options: Object.keys(MOVE_QUESTION.criteria) } }));
            span.setAttribute("jev.state", JSON.stringify(jevState(grid, score)));
          }
          const d = await chooseMove(grid, score, which);
          span.setAttribute("decision.dir", d.dir);
          span.setAttribute("decision.ms", Math.round(d.decisionMs));
          if (d.probabilities) span.setAttribute("jev.probabilities", JSON.stringify(d.probabilities));
          if (d.needsHuman !== undefined) span.setAttribute("jev.needs_human", d.needsHuman);
          return { ...d, decisionMs: Math.round(d.decisionMs) };
        } finally { span.end(); }
      });
    },
  });
