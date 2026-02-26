import { ToolError, type ErrorKind, type ToolResult, nowMs, type ToolContext } from "./types.js";
import type { MetricsSink, EventSink } from "./telemetry.js";
import type { ConcurrencyLimiter } from "./backpressure.js";
import type { ExecutableTool } from "./tools.js";

export type ResiliencePolicy = {
  timeoutMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  jitterFrac: number; // 0..1
  /** Optional RNG for deterministic testing (defaults to Math.random) */
  rng?: () => number;
};

export const DefaultResilience: ResiliencePolicy = {
  timeoutMs: 10_000,
  maxAttempts: 3,
  baseBackoffMs: 200,
  maxBackoffMs: 2_000,
  jitterFrac: 0.2,
  rng: Math.random,
};

export type CircuitBreakerState = {
  failureThreshold: number;
  resetTimeoutMs: number;
  failures: number;
  openedAt?: number;
};

export function newCircuitBreaker(): CircuitBreakerState {
  return { failureThreshold: 5, resetTimeoutMs: 30_000, failures: 0 };
}

export function breakerAllow(b: CircuitBreakerState): boolean {
  if (!b.openedAt) return true;
  return nowMs() - b.openedAt >= b.resetTimeoutMs;
}

export function breakerSuccess(b: CircuitBreakerState): void {
  b.failures = 0;
  b.openedAt = undefined;
}

export function breakerFailure(b: CircuitBreakerState): void {
  b.failures += 1;
  if (b.failures >= b.failureThreshold) b.openedAt = nowMs();
}

export function isTransient(e: unknown): boolean {
  if (e instanceof ToolError) return e.kind === "transient" || e.kind === "timeout" || e.kind === "overload";
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("econnreset") || msg.includes("tempor") || msg.includes("rate") || msg.includes("429");
  }
  return false;
}

export async function withTimeout<T>(p: Promise<T>, timeoutMs: number, onTimeoutMsg: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(() => reject(new Error(onTimeoutMsg)), timeoutMs);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function backoffMs(policy: ResiliencePolicy, attempt: number): number {
  const raw = Math.min(policy.baseBackoffMs * Math.pow(2, attempt - 1), policy.maxBackoffMs);
  const jitter = raw * policy.jitterFrac;
  const rand = policy.rng ?? Math.random;
  return Math.max(0, Math.floor(raw + (rand() * 2 - 1) * jitter));
}

function effectiveTimeoutMs(ctx: ToolContext, policy: ResiliencePolicy): number {
  if (!ctx.deadlineMs) return policy.timeoutMs;
  const remaining = ctx.deadlineMs - nowMs();
  return Math.max(1, Math.min(policy.timeoutMs, remaining));
}

export async function callTool<TIn, TOut>(
  tool: ExecutableTool<TIn, TOut>,
  input: TIn,
  opts: {
    ctx: ToolContext;
    policy: ResiliencePolicy;
    limiter?: ConcurrencyLimiter;
    breaker?: CircuitBreakerState;
    metrics: MetricsSink;
    events: EventSink;
  }
): Promise<ToolResult<TOut>> {
  const { ctx, policy, limiter, breaker, metrics, events } = opts;
  const t0 = nowMs();

  if (breaker && !breakerAllow(breaker)) {
    metrics.incr("tool.blocked.circuit_open", 1, { tool: tool.name });
    return {
      ok: false,
      error: new ToolError({ tool: tool.name, kind: "overload", message: "circuit_open", retryable: true }),
      latencyMs: nowMs() - t0,
      attempts: 0,
      traceId: ctx.traceId,
    };
  }

  let attempts = 0;
  let lastErr: unknown;

  const invokeOnce = async (): Promise<TOut> => {
    const timeoutMs = effectiveTimeoutMs(ctx, policy);
    const run = () => withTimeout(tool.run(input, ctx), timeoutMs, "tool_timeout");
    return limiter ? limiter.run(run) : run();
  };

  while (attempts < policy.maxAttempts) {
    attempts += 1;
    events.emit({ type: "tool.call", tool: tool.name, attempt: attempts, traceId: ctx.traceId });

    try {
      const value = await invokeOnce();
      const latencyMs = nowMs() - t0;
      metrics.incr("tool.ok", 1, { tool: tool.name });
      metrics.timingMs("tool.latency", latencyMs, { tool: tool.name });
      if (breaker) breakerSuccess(breaker);
      return { ok: true, value, latencyMs, attempts, traceId: ctx.traceId };
    } catch (e) {
      lastErr = e;

      const kind: ErrorKind =
        e instanceof Error && e.message === "tool_timeout" ? "timeout" : isTransient(e) ? "transient" : "permanent";

      const hasIdempotencyKey = Boolean(ctx.idempotencyKey);
      const retryableBySemantics = tool.idempotent || hasIdempotencyKey;
      const retryable = retryableBySemantics && (kind === "timeout" || kind === "transient");

      events.emit({ type: "tool.fail", tool: tool.name, attempt: attempts, traceId: ctx.traceId, kind, retryable });
      metrics.incr("tool.fail", 1, { tool: tool.name, kind });

      if (breaker) breakerFailure(breaker);

      if (!retryable || attempts >= policy.maxAttempts) {
        const latencyMs = nowMs() - t0;
        const err =
          e instanceof ToolError
            ? e
            : new ToolError({
                tool: tool.name,
                kind,
                message: e instanceof Error ? e.message : String(e),
                retryable,
                cause: e,
              });
        return { ok: false, error: err, latencyMs, attempts, traceId: ctx.traceId };
      }

      await new Promise((r) => setTimeout(r, backoffMs(policy, attempts)));
    }
  }

  const latencyMs = nowMs() - t0;
  return {
    ok: false,
    error: new ToolError({
      tool: tool.name,
      kind: "unknown",
      message: "exhausted_retries",
      retryable: false,
      cause: lastErr,
    }),
    latencyMs,
    attempts,
    traceId: ctx.traceId,
  };
}
