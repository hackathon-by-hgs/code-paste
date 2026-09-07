/**
 * Time is injected, never read from the ambient environment.
 *
 * Session expiry, token lifetimes, roster TTLs, pairing-code windows and heartbeat coalescing are
 * all security-relevant time comparisons. Testing them against a real clock means either sleeping
 * or asserting nothing — which is how expiry bugs survive to production.
 */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowMs(): number {
    return Date.now();
  }
}

/** Test double. Time only moves when a test moves it. */
export class FixedClock implements Clock {
  constructor(private current: Date = new Date('2026-01-01T00:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  nowMs(): number {
    return this.current.getTime();
  }
  set(date: Date): void {
    this.current = date;
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
