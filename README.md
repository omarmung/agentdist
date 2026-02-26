# agentdist (monorepo)

**agentdist** is a reliability/control-plane substrate for agentic systems treated as distributed systems.

- Works **standalone**: you can use `AgentRuntime` + `callTool` without any LLM framework.
- Works **with Vercel AI SDK**: wrap AI SDK tool `execute()` functions so every tool call gets timeouts, retries, backpressure, circuit breakers, and structured telemetry.
- Default integration mode: **throw on tool failure**, with **typed failures in telemetry** (you asked for this).

## Packages

- `packages/agentdist` — core runtime, resilience, telemetry, feature flags
- `packages/adapter-ai-sdk` — optional adapter for `ai` (Vercel AI SDK)

## Examples

- `examples/standalone-basic` — standalone orchestration with fake “LLM planner”
- `examples/ai-sdk-wrapped-tools` — AI SDK tools wrapped by agentdist (no real model call required)

## Quick start

```bash
npm i
npm run build
npm run example:standalone
npm run example:ai-sdk
```

> Notes:
> - The AI SDK example is written to compile if you install `ai` (Vercel AI SDK). It does not require API keys because it only demonstrates tool wrapping.
> - Node 18+ recommended.
