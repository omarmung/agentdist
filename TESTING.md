# Testing agentdist

This repo uses **Vitest** for unit, integration, and chaos tests.

## Install

From repo root:

```bash
npm i
```

## Run all tests

```bash
npm test
```

## Watch mode

```bash
npm run test:watch
```

## Build + test

```bash
npm run build
npm test
```

## What we test

### Core library (`packages/agentdist`)
- `callTool` behavior:
  - timeouts (`kind=timeout`)
  - transient retry for idempotent tools
  - no retry for non-idempotent tools unless `idempotencyKey` is present
  - circuit breaker opens and blocks calls
  - deadlines shorten timeout budget
- backpressure:
  - `ConcurrencyLimiter` enforces `maxConcurrency`
- runtime semantics:
  - partial success is returned as `StepResult` with warnings
  - reducer errors are captured as `reducer_error`
- chaos tests (seeded-ish):
  - randomized latency/failure patterns don’t deadlock
  - concurrency cap is never exceeded

### AI SDK adapter (`packages/adapter-ai-sdk`)
- wrapped tool `execute()`:
  - returns value on success
  - throws `ToolError` on failure (default “throw mode”)
  - emits telemetry events/metrics on failures

## CI tip
If you add GitHub Actions later, the typical pipeline is:

- `npm ci`
- `npm run build`
- `npm test`
