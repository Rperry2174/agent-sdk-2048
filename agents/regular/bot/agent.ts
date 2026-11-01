import { defineAgent } from "@grok/agent-sdk";
import { loadEnv } from "../../../lib/env.js";

loadEnv();

// The "regular" player: a normal Agent SDK model turn (default model) picks every
// move by calling get_board and move. No Jev, no heuristic.
export default defineAgent({
  name: "regular",
  description: "Plays 2048 on mGBA port 8889; the default chat model picks each move from get_board and move.",
  tools: [], // only this agent's own server tools (get_board, move, new_game) over MCP
});
