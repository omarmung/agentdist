# @agentdist/adapter-ai-sdk

Wrap Vercel AI SDK tools so their `execute()` runs through `agentdist`'s distributed-systems protections.

Design defaults (per your specs):
- **Throw on failure** from `execute()`
- Typed failures are captured in telemetry inside `agentdist` (`ToolError` kinds)

## Example

```ts
import { tool } from "ai";
import { wrapAiTool } from "@agentdist/adapter-ai-sdk";

const search = wrapAiTool(
  "search",
  tool({
    description: "Search the web",
    parameters: /* zod schema */ undefined,
    execute: async ({ q }) => ({ results: [] }),
  }),
  { idempotent: true }
);
```
