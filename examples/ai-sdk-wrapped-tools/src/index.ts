/**
 * AI SDK integration demo:
 * - Shows how to wrap AI SDK tools so execute() goes through agentdist.
 *
 * This example does NOT actually call a model (no keys needed).
 * If you install `ai`, you can swap the `fakeAiTool(...)` helper for `tool(...)` from AI SDK.
 */

import { wrapAiTool } from "@agentdist/adapter-ai-sdk";
import { ConsoleEvents, ConsoleMetrics, ToolError } from "agentdist";

// Minimal stand-in for AI SDK's `tool({...})` factory.
// If you install `ai`, replace this with: import { tool } from "ai";
function fakeAiTool<TArgs, TResult>(def: { description?: string; parameters?: any; execute: (args: TArgs) => Promise<TResult> }) {
  return def;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const metrics = new ConsoleMetrics();
  const events = new ConsoleEvents();

  const rawSearch = fakeAiTool<{ q: string }, { results: string[] }>({
    description: "Search tool",
    execute: async ({ q }) => {
      await sleep(50 + Math.random() * 250);
      if (Math.random() < 0.2) throw new Error("ECONNRESET upstream search");
      return { results: ["a", "b", "c"].map((x) => `${x}:${q}`) };
    },
  });

  // Wrap with agentdist protections.
  const search = wrapAiTool("search", rawSearch, {
    idempotent: true,
    metrics,
    events,
    resilience: { timeoutMs: 250, maxAttempts: 3, baseBackoffMs: 80, maxBackoffMs: 600, jitterFrac: 0.2 },
    context: () => ({ traceId: `demo_${Date.now()}` }),
  });

  // Simulate how AI SDK would call execute() after selecting the tool.
  try {
    const out = await search.execute({ q: "best ramen in oakland" });
    // eslint-disable-next-line no-console
    console.log("search output:", out);
  } catch (e) {
    if (e instanceof ToolError) {
      // eslint-disable-next-line no-console
      console.log("tool failed (thrown to orchestrator):", { tool: e.tool, kind: e.kind, retryable: e.retryable, msg: e.message });
    } else {
      // eslint-disable-next-line no-console
      console.log("tool failed (unknown error):", e);
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
