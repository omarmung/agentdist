import type { AiSdkToolLike } from "./types.js";
import { callTool, type ResiliencePolicy, DefaultResilience } from "agentdist";
import type { ExecutableTool, ToolContext } from "agentdist";
import type { MetricsSink, EventSink } from "agentdist";
import { ConsoleMetrics, ConsoleEvents } from "agentdist";

/**
 * Adapter policy: you requested "throw" by default.
 * - On failure, we throw the underlying ToolError (or Error) so the orchestrator/agent loop decides what to do.
 * - Telemetry still captures typed failures via agentdist.
 */
export type WrapAiToolOptions = {
  idempotent?: boolean;
  resilience?: ResiliencePolicy;
  metrics?: MetricsSink;
  events?: EventSink;
  /** Optional function to supply a ToolContext for this execution. */
  context?: (args: any) => ToolContext;
};

/**
 * Wrap a single AI SDK tool definition so its execute() runs through agentdist.
 *
 * Usage with AI SDK:
 *   const tools = {
 *     search: wrapAiTool("search", tool({...}), { idempotent: true, context: () => ({ traceId }) })
 *   }
 */
export function wrapAiTool<TArgs, TResult>(
  name: string,
  aiTool: AiSdkToolLike<TArgs, TResult>,
  opts: WrapAiToolOptions = {}
): AiSdkToolLike<TArgs, TResult> {
  const metrics = opts.metrics ?? new ConsoleMetrics();
  const events = opts.events ?? new ConsoleEvents();
  const policy = opts.resilience ?? DefaultResilience;
  const idempotent = Boolean(opts.idempotent ?? true);

  // Create an ExecutableTool adapter over the AI SDK tool's execute.
  const execTool: ExecutableTool<TArgs, TResult> = {
    name,
    idempotent,
    run: async (input, ctx) => {
      // If you want to pass idempotency keys into your tool impl, do it here.
      // AI SDK's execute signature is just (args), so this is the boundary where you may inject keys.
      return await aiTool.execute(input);
    },
  };

  return {
    ...aiTool,
    execute: async (args: TArgs) => {
      const ctx = opts.context ? opts.context(args) : { traceId: `tr_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}` };
      const res = await callTool(execTool, args, { ctx, policy, metrics, events });
      if (res.ok) return res.value;

      // THROW mode (default): let the agent loop / AI SDK decide next step.
      throw res.error;
    },
  };
}

/** Wrap a map of AI SDK tools. */
export function wrapAiTools<T extends Record<string, AiSdkToolLike<any, any>>>(
  tools: T,
  optsByTool: Partial<Record<keyof T, WrapAiToolOptions>> & { default?: WrapAiToolOptions } = {}
): T {
  const out: any = {};
  for (const [name, tool] of Object.entries(tools)) {
    const per = (optsByTool as any)[name] ?? {};
    const merged: WrapAiToolOptions = { ...(optsByTool.default ?? {}), ...(per ?? {}) };
    out[name] = wrapAiTool(name, tool as any, merged);
  }
  return out as T;
}
