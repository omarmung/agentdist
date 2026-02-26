import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../src/runtime";
import { StaticFlags } from "../src/flags";
import { ConsoleEvents, ConsoleMetrics } from "../src/telemetry";
import type { ExecutableTool } from "../src/tools";
import { sleep } from "./_helpers";

describe("AgentRuntime.runStep", () => {
  it("returns partial output when one tool fails", async () => {
    const okTool: ExecutableTool<{}, string> = { name: "ok", idempotent: true, run: async () => "ok" };
    const badTool: ExecutableTool<{}, string> = { name: "bad", idempotent: true, run: async () => { throw new Error("ECONNRESET"); } };

    const rt = new AgentRuntime({
      metrics: new ConsoleMetrics(),
      events: new ConsoleEvents(),
      flags: new StaticFlags({ "agent.parallel_tools": true }),
      config: { maxConcurrency: 10, resilience: { timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 } },
    });

    const step = await rt.runStep({
      stepName: "t",
      actor: "u",
      state: {},
      planner: async () => ({
        a: { tool: okTool, input: {} },
        b: { tool: badTool, input: {} },
      }),
      reducer: (results) => ({
        a: results.a.ok ? results.a.value : null,
        b: results.b.ok ? results.b.value : null,
      }),
    });

    expect(step.ok).toBe(false);
    expect(step.output?.a).toBe("ok");
    expect(step.output?.b).toBe(null);
    expect(step.warnings.some((w) => w.startsWith("b:"))).toBe(true);
  });

  it("captures reducer_error if reducer throws", async () => {
    const okTool: ExecutableTool<{}, string> = { name: "ok", idempotent: true, run: async () => "ok" };

    const rt = new AgentRuntime({
      metrics: new ConsoleMetrics(),
      events: new ConsoleEvents(),
      flags: new StaticFlags({ "agent.parallel_tools": false }),
      config: { maxConcurrency: 10, resilience: { timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 } },
    });

    const step = await rt.runStep({
      stepName: "t2",
      actor: "u",
      state: {},
      planner: async () => ({ a: { tool: okTool, input: {} } }),
      reducer: () => {
        throw new Error("boom");
      },
    });

    expect(step.ok).toBe(false);
    expect(step.warnings.includes("reducer_error")).toBe(true);
  });

  it("respects maxConcurrency across parallel tool calls (smoke)", async () => {
    let inFlight = 0;
    let maxSeen = 0;

    const slowTool: ExecutableTool<number, number> = {
      name: "slow",
      idempotent: true,
      run: async (x) => {
        inFlight++;
        maxSeen = Math.max(maxSeen, inFlight);
        await sleep(25);
        inFlight--;
        return x + 1;
      },
    };

    const rt = new AgentRuntime({
      metrics: new ConsoleMetrics(),
      events: new ConsoleEvents(),
      flags: new StaticFlags({ "agent.parallel_tools": true }),
      config: { maxConcurrency: 2, resilience: { timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 } },
    });

    await rt.runStep({
      stepName: "c",
      actor: "u",
      state: {},
      planner: async () => ({
        t1: { tool: slowTool, input: 1 },
        t2: { tool: slowTool, input: 2 },
        t3: { tool: slowTool, input: 3 },
        t4: { tool: slowTool, input: 4 },
      }),
      reducer: (results) => Object.values(results).map((r) => (r.ok ? r.value : null)),
    });

    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});
