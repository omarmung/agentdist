export interface FlagStore {
  isEnabled(flag: string, actor?: string): boolean;
}

export class StaticFlags implements FlagStore {
  constructor(private flags: Record<string, boolean>) {}
  isEnabled(flag: string): boolean {
    return Boolean(this.flags[flag]);
  }
}

export class PercentRolloutFlags implements FlagStore {
  constructor(private percents: Record<string, number>) {}
  isEnabled(flag: string, actor: string = "anon"): boolean {
    const pct = clampInt(Math.floor(this.percents[flag] ?? 0), 0, 100);
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    return hashToBucket(actor) < pct;
  }
}

function hashToBucket(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % 100;
  return h;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
