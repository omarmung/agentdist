import { describe, it, expect } from "vitest";
import { ConcurrencyLimiter } from "../src/backpressure";
import { sleep } from "./_helpers";

describe("ConcurrencyLimiter", () => {
  it("enforces maxInFlight", async () => {
    const limiter = new ConcurrencyLimiter(2);

    let inFlight = 0;
    let maxSeen = 0;

    const work = async () => limiter.run(async () => {
      inFlight++;
      maxSeen = Math.max(maxSeen, inFlight);
      await sleep(25);
      inFlight--;
      return true;
    });

    await Promise.all([work(), work(), work(), work(), work()]);
    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});
