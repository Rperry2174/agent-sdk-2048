// One Jev move exactly as scripts/race.ts drives it (get_board -> choose_move -> move, direct
// tool calls, no model turn), wrapped in a driver span so the three server calls land in one trace.
// Usage: OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 tsx scripts/trace-jev-move.ts [--url http://127.0.0.1:3100/jev] [--session ses_...]
// --session records the three calls on that session's event stream (playground Trace view).
import { context, propagation, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

const argv = process.argv.slice(2);
const base = argv.includes("--url") ? argv[argv.indexOf("--url") + 1] : "http://127.0.0.1:3100/jev";
const sessionId = argv.includes("--session") ? argv[argv.indexOf("--session") + 1] : undefined;
const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318") + "/v1/traces";
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ "service.name": "race-driver" }),
  spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: endpoint }))],
});
provider.register({ propagator: new W3CTraceContextPropagator() });
const tracer = trace.getTracer("race-driver");

async function tool(name: string, input: unknown) {
  return tracer.startActiveSpan(`tool ${name}`, async (span) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    propagation.inject(context.active(), headers);
    const r: any = await (await fetch(`${base}/v1/tools/${name}`, { method: "POST", headers, body: JSON.stringify(sessionId ? { input, sessionId } : { input }) })).json();
    span.end();
    return r.result;
  });
}

await tracer.startActiveSpan("jev player: one move", async (root) => {
  const b = await tool("get_board", {});
  const d = await tool("choose_move", { grid: b.grid, score: b.score });
  const m = await tool("move", { dir: d.dir });
  root.setAttribute("move.dir", d.dir);
  root.setAttribute("move.score_after", m.score);
  root.end();
  console.log(JSON.stringify({ traceId: root.spanContext().traceId, board: b.grid, decision: d, after: m.grid, score: m.score }));
});
await provider.forceFlush();
await provider.shutdown();
