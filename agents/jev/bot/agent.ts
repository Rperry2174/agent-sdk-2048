import { defineAgent } from "@grok/agent-sdk";
import { loadEnv } from "../../../lib/env.js";

loadEnv(); // TYPESAFE_API_KEY from the git-ignored repo .env

// The "jev" player: Jev decide() picks each move inside choose_move. The race
// driver calls the tools directly (no chat-model turn per move); the model is
// only used if you chat with this agent in the playground.
export default defineAgent({
  name: "jev",
  description: "Plays 2048 on mGBA port 8890; Jev decide() picks each move (choose_move), no chat-model turn per move.",
  tools: ["read"],
});
