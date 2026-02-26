import type { ToolContext } from "./types.js";

/**
 * Framework-agnostic tool contract.
 * Treat every tool call like a distributed RPC.
 */
export interface ExecutableTool<TIn, TOut> {
  name: string;
  /** If false, automatic retries are disabled unless you provide idempotency keys and your tool honors them. */
  idempotent: boolean;
  run(input: TIn, ctx: ToolContext): Promise<TOut>;
}
