import type { MetricsSink, EventSink } from "./telemetry.js";
import type { FlagStore } from "./flags.js";
import { ConcurrencyLimiter } from "./backpressure.js";
import { callTool, DefaultResilience, newCircuitBreaker, type ResiliencePolicy, type CircuitBreakerState } from "./resilience.js";
import { newTraceId, type ToolContext, type StepResult, type ToolResult } from "./types.js";
import type { ExecutableTool } from "./tools.js";

export type RuntimeConfig = {
  resilience?: ResiliencePolicy;
  maxConcurrency?: number;
};

export class AgentRuntime {
  private limiter: ConcurrencyLimiter;
  private breakers: Map<string, CircuitBreakerState> = new Map();
  private policy: ResiliencePolicy;

  constructor(
    private deps: {
      metrics: MetricsSink;
      events: EventSink;
      flags: FlagStore;
      config?: RuntimeConfig;
    }
  ) {
    this.policy = deps.config?.resilience ?? DefaultResilience;
    this.limiter = new ConcurrencyLimiter(deps.config?.maxConcurrency ?? 10);
  }

  private breakerFor(toolName: string): CircuitBreakerState {
    let b = this.breakers.get(toolName);
    if (!b) {
      b = newCircuitBreaker();
      this.breakers.set(toolName, b);
    }
    return b;
  }

  /**
   * Runs a single agent “step”:
   * - planner decides which tools to call (and inputs)
   * - runtime executes tool calls with DS protections
   * - reducer produces best-effort output (partial success allowed)
   */
  async runStep<TState, TOutput>(opts: {
    stepName: string;
    actor: string;
    state: TState;
    deadlineMs?: number;
    idempotencyKey?: string;
    planner: (state: TState, ctx: ToolContext) => Promise<Record<string, { tool: ExecutableTool<any, any>; input: any }>>;
    reducer: (results: Record<string, ToolResult<any>>, ctx: ToolContext) => TOutput;
  }): Promise<StepResult<TOutput>> {
    const traceId = newTraceId();
    const ctx: ToolContext = { traceId, actor: opts.actor, deadlineMs: opts.deadlineMs, idempotencyKey: opts.idempotencyKey };
    const { metrics, events, flags } = this.deps;

    events.emit({ type: "step.start", step: opts.stepName, traceId, actor: opts.actor });

    const calls = await opts.planner(opts.state, ctx);
    const entries = Object.entries(calls);

    const parallel = flags.isEnabled("agent.parallel_tools", opts.actor);
    const toolResults: Record<string, ToolResult<any>> = {};

    if (!parallel) {
      // Reduce coordination: sequential execution is easier to debug and safer under incident conditions.
      for (const [key, { tool, input }] of entries) {
        toolResults[key] = await callTool(tool, input, {
          ctx,
          policy: this.policy,
          limiter: this.limiter,
          breaker: this.breakerFor(tool.name),
          metrics,
          events,
        });
      }
    } else {
      const promises = entries.map(async ([key, { tool, input }]) => {
        const r = await callTool(tool, input, {
          ctx,
          policy: this.policy,
          limiter: this.limiter,
          breaker: this.breakerFor(tool.name),
          metrics,
          events,
        });
        return [key, r] as const;
      });
      const pairs = await Promise.all(promises);
      for (const [k, r] of pairs) toolResults[k] = r;
    }

    const warnings: string[] = [];
    let ok = true;
    for (const [k, r] of Object.entries(toolResults)) {
      if (!r.ok) {
        ok = false;
        warnings.push(`${k}:${r.error.kind}`);
      }
    }

    let output: TOutput | undefined = undefined;
    try {
      output = opts.reducer(toolResults, ctx);
    } catch (e) {
      ok = false;
      warnings.push("reducer_error");
      metrics.incr("step.reducer_error", 1, { step: opts.stepName });
      events.emit({ type: "step.reducer_error", step: opts.stepName, traceId, err: e instanceof Error ? e.message : String(e) });
    }

    events.emit({ type: "step.end", step: opts.stepName, traceId, ok, warnings });
    return { ok, output, toolResults, warnings, traceId };
  }
}
