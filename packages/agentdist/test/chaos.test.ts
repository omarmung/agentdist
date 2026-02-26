import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../src/runtime";
import { StaticFlags } from "../src/flags";
import { ConsoleEvents, ConsoleMetrics } from "../src/telemetry";
import type { ExecutableTool } from "../src/tools";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

describe("chaos: runtime does not deadlock and respects concurrency", () => {
  it("survives randomized latency/failure patterns", async () => {
    const rand = rng(12345);

    let inFlight = 0;
    let maxSeen = 0;

    const flakyTool: ExecutableTool<{ i: number }, { ok: true; i: number }> = {
      name: "flaky",
      idempotent: true,
      run: async ({ i }) => {
        inFlight++;
        maxSeen = Math.max(maxSeen, inFlight);

        // random latency 0..30ms
        await sleep(Math.floor(rand() * 30));

        // random transient failure ~20%
        if (rand() < 0.2) {
          inFlight--;
          throw new Error("ECONNRESET");
        }

        inFlight--;
        return { ok: true, i };
      },
    };

    const rt = new AgentRuntime({
      metrics: new ConsoleMetrics(),
      events: new ConsoleEvents(),
      flags: new StaticFlags({ "agent.parallel_tools": true }),
      config: { maxConcurrency: 3, resilience: { timeoutMs: 100, maxAttempts: 3, baseBackoffMs: 1, maxBackoffMs: 5, jitterFrac: 0 } },
    });

    // Run many steps to shake out hangs/races
    for (let stepNum = 0; stepNum < 200; stepNum++) {
      const step = await rt.runStep({
        stepName: "chaos",
        actor: "u",
        state: { stepNum },
        planner: async () => ({
          a: { tool: flakyTool, input: { i: stepNum * 3 + 1 } },
          b: { tool: flakyTool, input: { i: stepNum * 3 + 2 } },
          c: { tool: flakyTool, input: { i: stepNum * 3 + 3 } },
        }),
        reducer: (results) => ({
          okCount: Object.values(results).filter((r) => r.ok).length,
        }),
      });

      expect(step.traceId).toBeTruthy();
      expect(step.output).toBeTruthy();
    }

    expect(maxSeen).toBeLessThanOrEqual(3);
  });
});
