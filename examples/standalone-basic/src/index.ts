import {
  AgentRuntime,
  ConsoleEvents,
  ConsoleMetrics,
  PercentRolloutFlags,
  type ExecutableTool,
  type ToolContext,
  type ToolResult,
} from "agentdist";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Example tool: search (idempotent) */
const searchTool: ExecutableTool<{ q: string }, { results: string[] }> = {
  name: "search",
  idempotent: true,
  run: async (input, ctx) => {
    await sleep(50 + Math.random() * 250);
    if (Math.random() < 0.1) throw new Error("ECONNRESET upstream search");
    return { results: ["a", "b", "c"].map((x) => `${x}:${input.q}`) };
  },
};

/** Example tool: memory read (idempotent) */
const memoryTool: ExecutableTool<{ user: string }, { memory: string }> = {
  name: "memory_db",
  idempotent: true,
  run: async (input, ctx) => {
    await sleep(20 + Math.random() * 150);
    if (Math.random() < 0.05) throw new Error("timeout");
    return { memory: `mem_for_${input.user}` };
  },
};

async function fakePlanner(state: { question: string; user: string }, ctx: ToolContext) {
  // In real life, the planner would call an LLM to decide tool calls.
  return {
    search: { tool: searchTool, input: { q: state.question } },
    memory: { tool: memoryTool, input: { user: state.user } },
  };
}

function reducer(results: Record<string, ToolResult<any>>, ctx: ToolContext) {
  // Partial success semantics: degrade gracefully if a tool failed.
  const sources = results.search?.ok ? results.search.value.results : [];
  const mem = results.memory?.ok ? results.memory.value.memory : null;

  const answer =
    sources.length > 0
      ? `Draft answer using sources=${sources.length} mem=${mem}`
      : `Draft answer (degraded): search unavailable; mem=${mem}`;

  return { answer, sources, mem };
}

async function main() {
  const rt = new AgentRuntime({
    metrics: new ConsoleMetrics(),
    events: new ConsoleEvents(),
    flags: new PercentRolloutFlags({ "agent.parallel_tools": 50 }),
    config: {
      maxConcurrency: 5,
      resilience: { timeoutMs: 250, maxAttempts: 3, baseBackoffMs: 80, maxBackoffMs: 600, jitterFrac: 0.2 },
    },
  });

  const step = await rt.runStep({
    stepName: "answer_question",
    actor: "user_123",
    state: { question: "best ramen in oakland", user: "user_123" },
    planner: fakePlanner,
    reducer,
  });

  // eslint-disable-next-line no-console
  console.log("\nSTEP RESULT:", step.ok, step.warnings, step.output);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
