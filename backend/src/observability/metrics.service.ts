import { Injectable } from '@nestjs/common';

/**
 * Safe counters only.
 *
 * `SPEC_CONTRACT.md` §11.3 enumerates what may be measured: connection duration, peer count,
 * protocol version, error category, bytes transferred, sync latency, rate-limit events. Clipboard
 * text, screenshots and raw payloads are unsafe — and, structurally, unavailable here.
 *
 * Deliberately an in-process counter map rather than a metrics backend. Adding Prometheus or
 * StatsD before anything reads them would be infrastructure for a hypothetical
 * (`SYSTEM_DESIGN.md` §22); the interface is the seam for when something does.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly observations = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  increment(name: string, labels: Record<string, string | number> = {}, by = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observeDuration(name: string, durationMs: number, labels: Record<string, string | number> = {}): void {
    const key = this.key(name, labels);
    const current = this.observations.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    this.observations.set(key, current);
  }

  snapshot(): {
    counters: Record<string, number>;
    durations: Record<string, { count: number; avgMs: number; maxMs: number }>;
  } {
    const durations: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
    for (const [key, value] of this.observations) {
      durations[key] = {
        count: value.count,
        avgMs: value.count === 0 ? 0 : Math.round(value.totalMs / value.count),
        maxMs: value.maxMs,
      };
    }
    return { counters: Object.fromEntries(this.counters), durations };
  }

  reset(): void {
    this.counters.clear();
    this.observations.clear();
  }

  private key(name: string, labels: Record<string, string | number>): string {
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`);
    return parts.length === 0 ? name : `${name}{${parts.join(',')}}`;
  }
}
