export type ErrorKind = "timeout" | "transient" | "permanent" | "overload" | "unknown";

export class ToolError extends Error {
  tool: string;
  kind: ErrorKind;
  retryable: boolean;
  cause?: unknown;

  constructor(opts: { tool: string; kind: ErrorKind; message: string; retryable?: boolean; cause?: unknown }) {
    super(opts.message);
    this.name = "ToolError";
    this.tool = opts.tool;
    this.kind = opts.kind;
    this.retryable = Boolean(opts.retryable);
    this.cause = opts.cause;
  }
}

export type ToolResult<T = unknown> =
  | { ok: true; value: T; latencyMs: number; attempts: number; traceId: string }
  | { ok: false; error: ToolError; latencyMs: number; attempts: number; traceId: string };

export type StepResult<TOutput = unknown> = {
  ok: boolean;
  output?: TOutput;
  toolResults: Record<string, ToolResult<any>>;
  warnings: string[];
  traceId: string;
};

export function nowMs(): number {
  return Date.now();
}

export function newTraceId(): string {
  // Swap for crypto.randomUUID() if you prefer.
  return `tr_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
}

export interface ToolContext {
  traceId: string;
  actor?: string;
  /** Optional end-to-end deadline (epoch ms). If set, tool calls should respect it. */
  deadlineMs?: number;
  /** Optional idempotency key; enables safe retries for non-idempotent tools if your tool honors it. */
  idempotencyKey?: string;
}
