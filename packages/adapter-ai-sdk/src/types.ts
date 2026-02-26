/**
 * Minimal structural types for AI SDK tool definitions.
 *
 * We intentionally avoid importing AI SDK internals so this adapter remains robust
 * across AI SDK versions, as long as the tool objects have an `execute(...)` function.
 */

export type AiSdkToolExecute<TArgs, TResult> = (args: TArgs) => Promise<TResult>;

export type AiSdkToolLike<TArgs = any, TResult = any> = {
  description?: string;
  // "parameters" can be a Zod schema or JSON schema or whatever AI SDK supports.
  parameters?: any;
  execute: AiSdkToolExecute<TArgs, TResult>;
};
