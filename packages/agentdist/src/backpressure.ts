/** Simple concurrency limiter. (Backpressure primitive) */
export class ConcurrencyLimiter {
  private inFlight = 0;
  private queue: Array<() => void> = [];

  constructor(private maxInFlight: number) {
    if (maxInFlight < 1) throw new Error("maxInFlight must be >= 1");
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}
