/**
 * Board-fixture evals for the per-move policy. No emulator, no chat model.
 * - tag "offline": the heuristic stand-in (always runs).
 * - tag "jev": the same fixtures through Jev; skipped without TYPESAFE_API_KEY.
 * Each case asserts which move was chosen.
 */
import { defineEval, equals } from "@grok/agent-sdk/evals";
import { readFileSync } from "node:fs";
import type { Dir, Grid } from "../../../lib/game.js";
import { hasJevKey } from "../../../lib/env.js";
import { heuristicDecide, jevDecide } from "../../../lib/policy.js";
import { legalMoves } from "../../../lib/sim.js";

type Fixture = { id: string; description: string; grid: Grid; expectOneOf: Dir[]; forbid?: Dir[] };
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL("./fixtures/boards.json", import.meta.url), "utf8"));

function assertChoice(t: any, f: Fixture, dir: Dir) {
  t.check(legalMoves(f.grid).includes(dir), equals(true));
  t.check(f.expectOneOf.includes(dir), equals(true));
  for (const bad of f.forbid ?? []) t.check(dir === bad, equals(false));
  t.metric("chosen", dir);
}

export default defineEval({
  cases: [
    ...fixtures.map((f) => ({
      id: `heuristic-${f.id}`,
      description: `[stand-in] ${f.description}`,
      tags: ["offline"],
      async test(t: any) {
        const d = heuristicDecide(f.grid);
        assertChoice(t, f, d.dir);
        t.metric("decisionMs", Math.round(d.decisionMs));
      },
    })),
    ...fixtures.map((f) => ({
      id: `jev-${f.id}`,
      description: `[jev] ${f.description}`,
      tags: ["jev"],
      async test(t: any) {
        if (!hasJevKey()) t.skip("TYPESAFE_API_KEY is not set");
        const d = await jevDecide(f.grid, 0, { fallback: false });
        assertChoice(t, f, d.dir);
        t.metric("decisionMs", Math.round(d.decisionMs));
        t.metric("confidence", Math.max(...Object.values(d.probabilities ?? { x: 0 })));
        t.metric("needsHuman", String(d.needsHuman));
      },
    })),
  ],
});
