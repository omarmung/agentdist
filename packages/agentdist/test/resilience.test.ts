import { describe, it, expect, vi } from "vitest";
import { callTool, DefaultResilience, newCircuitBreaker } from "../src/resilience";
import type { ExecutableTool } from "../src/tools";
import { metricsSpy, eventsSpy } from "./_helpers";

describe("callTool", () => {
  it("returns ok on success", async () => {
    const tool: ExecutableTool<{ x: number }, number> = {
      name: "oktool",
      idempotent: true,
      run: async (input) => input.x + 1,
    };

    const res = await callTool(tool, { x: 1 }, {
      ctx: { traceId: "t1" },
      policy: { ...DefaultResilience, timeoutMs: 1000, maxAttempts: 1 },
      metrics: metricsSpy(),
      events: eventsSpy(),
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe(2);
  });

  it("times out and marks error kind=timeout", async () => {
    vi.useFakeTimers();

    const tool: ExecutableTool<{}, string> = {
      name: "slow",
      idempotent: true,
      run: async () => new Promise((r) => setTimeout(() => r("done"), 10_000)),
    };

    const p = callTool(tool, {}, {
      ctx: { traceId: "t2" },
      policy: { ...DefaultResilience, timeoutMs: 50, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 },
      metrics: metricsSpy(),
      events: eventsSpy(),
    });

    await vi.advanceTimersByTimeAsync(60);
    const res = await p;

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");

    vi.useRealTimers();
  });

  it("retries idempotent tool on transient failure", async () => {
    let calls = 0;
    const tool: ExecutableTool<{}, string> = {
      name: "flaky",
      idempotent: true,
      run: async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNRESET");
        return "ok";
      },
    };

    const res = await callTool(tool, {}, {
      ctx: { traceId: "t3" },
      policy: { ...DefaultResilience, timeoutMs: 1000, maxAttempts: 3, baseBackoffMs: 1, maxBackoffMs: 2, jitterFrac: 0 },
      metrics: metricsSpy(),
      events: eventsSpy(),
    });

    expect(calls).toBe(3);
    expect(res.ok).toBe(true);
  });

  it("does not retry non-idempotent tool without idempotencyKey", async () => {
    let calls = 0;
    const tool: ExecutableTool<{}, string> = {
      name: "side_effect",
      idempotent: false,
      run: async () => {
        calls++;
        throw new Error("ECONNRESET");
      },
    };

    const res = await callTool(tool, {}, {
      ctx: { traceId: "t4" },
      policy: { ...DefaultResilience, maxAttempts: 3, baseBackoffMs: 1, maxBackoffMs: 2, jitterFrac: 0 },
      metrics: metricsSpy(),
      events: eventsSpy(),
    });

    expect(calls).toBe(1);
    expect(res.ok).toBe(false);
  });

  it("retries non-idempotent tool when idempotencyKey is present (assumes tool honors key)", async () => {
    let calls = 0;
    const tool: ExecutableTool<{}, string> = {
      name: "side_effect_keyed",
      idempotent: false,
      run: async () => {
        calls++;
        if (calls < 2) throw new Error("ECONNRESET");
        return "ok";
      },
    };

    const res = await callTool(tool, {}, {
      ctx: { traceId: "t4b", idempotencyKey: "k1" },
      policy: { ...DefaultResilience, maxAttempts: 3, baseBackoffMs: 1, maxBackoffMs: 2, jitterFrac: 0 },
      metrics: metricsSpy(),
      events: eventsSpy(),
    });

    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
  });

  it("opens circuit breaker after threshold and blocks calls", async () => {
    const breaker = newCircuitBreaker();
    breaker.failureThreshold = 2;
    breaker.resetTimeoutMs = 10_000;

    const tool: ExecutableTool<{}, string> = {
      name: "always_fail",
      idempotent: true,
      run: async () => {
        throw new Error("timeout");
      },
    };

    const metrics = metricsSpy();
    const events = eventsSpy();

    await callTool(tool, {}, { ctx: { traceId: "t5" }, policy: { ...DefaultResilience, timeoutMs: 10, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 }, breaker, metrics, events });
    await callTool(tool, {}, { ctx: { traceId: "t5" }, policy: { ...DefaultResilience, timeoutMs: 10, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 }, breaker, metrics, events });

    const res = await callTool(tool, {}, { ctx: { traceId: "t5" }, policy: { ...DefaultResilience, timeoutMs: 10, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 }, breaker, metrics, events });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("overload");
      expect(res.error.message).toBe("circuit_open");
      expect(res.attempts).toBe(0);
    }
  });

  it("deadlineMs shortens effective timeout budget", async () => {
    vi.useFakeTimers();

    const tool: ExecutableTool<{}, string> = {
      name: "deadline_slow",
      idempotent: true,
      run: async () => new Promise((r) => setTimeout(() => r("done"), 10_000)),
    };

    const start = Date.now();
    const p = callTool(tool, {}, {
      ctx: { traceId: "t6", deadlineMs: start + 30 },
      policy: { ...DefaultResilience, timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 },
      metrics: metricsSpy(),
      events: eventsSpy(),
    });

    await vi.advanceTimersByTimeAsync(40);
    const res = await p;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");

    vi.useRealTimers();
  });
});
