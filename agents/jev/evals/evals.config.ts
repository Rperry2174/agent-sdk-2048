import { defineEvalConfig } from "@grok/agent-sdk/evals";

export default defineEvalConfig({ maxConcurrency: 5, timeoutMs: 60_000 });
