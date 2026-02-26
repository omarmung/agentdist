export type Tags = Record<string, string>;

export interface MetricsSink {
  incr(name: string, value?: number, tags?: Tags): void;
  timingMs(name: string, valueMs: number, tags?: Tags): void;
}

export class ConsoleMetrics implements MetricsSink {
  incr(name: string, value: number = 1, tags: Tags = {}): void {
    // eslint-disable-next-line no-console
    console.log("[metric]", name, "+=", value, "tags=", tags);
  }
  timingMs(name: string, valueMs: number, tags: Tags = {}): void {
    // eslint-disable-next-line no-console
    console.log("[metric]", name, valueMs + "ms", "tags=", tags);
  }
}

export interface EventSink {
  emit(event: Record<string, any>): void;
}

export class ConsoleEvents implements EventSink {
  emit(event: Record<string, any>): void {
    // eslint-disable-next-line no-console
    console.log("[event]", JSON.stringify(event));
  }
}
