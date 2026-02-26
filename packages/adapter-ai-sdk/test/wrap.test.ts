import { describe, it, expect, vi } from "vitest";
import { wrapAiTool } from "../src/wrap";
import { ToolError } from "agentdist";

describe("wrapAiTool", () => {
  it("returns value on success", async () => {
    const raw = {
      execute: async (args: { q: string }) => ({ results: [args.q] }),
    };

    const metrics = { incr: vi.fn(), timingMs: vi.fn() };
    const events = { emit: vi.fn() };

    const wrapped = wrapAiTool("search", raw as any, {
      idempotent: true,
      metrics: metrics as any,
      events: events as any,
      resilience: { timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 },
      context: () => ({ traceId: "x" }),
    });

    const out = await wrapped.execute({ q: "hi" });
    expect(out.results[0]).toBe("hi");
  });

  it("throws ToolError on failure (throw mode)", async () => {
    const raw = {
      execute: async (_: { q: string }) => {
        throw new Error("ECONNRESET");
      },
    };

    const metrics = { incr: vi.fn(), timingMs: vi.fn() };
    const events = { emit: vi.fn() };

    const wrapped = wrapAiTool("search", raw as any, {
      idempotent: true,
      metrics: metrics as any,
      events: events as any,
      resilience: { timeoutMs: 1000, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 },
      context: () => ({ traceId: "x" }),
    });

    await expect(wrapped.execute({ q: "hi" })).rejects.toBeInstanceOf(ToolError);
  });

  it("emits telemetry on failure", async () => {
    const raw = {
      execute: async (_: { q: string }) => {
        throw new Error("timeout");
      },
    };

    const metrics = { incr: vi.fn(), timingMs: vi.fn() };
    const events = { emit: vi.fn() };

    const wrapped = wrapAiTool("search", raw as any, {
      idempotent: true,
      metrics: metrics as any,
      events: events as any,
      resilience: { timeoutMs: 10, maxAttempts: 1, baseBackoffMs: 1, maxBackoffMs: 1, jitterFrac: 0 },
      context: () => ({ traceId: "x" }),
    });

    await expect(wrapped.execute({ q: "hi" })).rejects.toBeInstanceOf(ToolError);

    expect(metrics.incr).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalled();
  });
});
