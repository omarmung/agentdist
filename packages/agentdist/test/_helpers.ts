import { vi } from "vitest";
import type { MetricsSink, EventSink } from "../src/telemetry";

export function metricsSpy(): MetricsSink & { incr: any; timingMs: any } {
  return {
    incr: vi.fn(),
    timingMs: vi.fn(),
  } as any;
}

export function eventsSpy(): EventSink & { emit: any } {
  return {
    emit: vi.fn(),
  } as any;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
