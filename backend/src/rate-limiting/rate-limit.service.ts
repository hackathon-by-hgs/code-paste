import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

export type RateLimitPolicy =
  'login' | 'signup' | 'refresh' | 'pairing' | 'register-device' | 'session-join' | 'default';

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAtMs: number;
  /** Consecutive rejected windows, used to lengthen the penalty for a persistent attacker. */
  strikes: number;
}

interface PolicyConfig {
  limit: number;
  windowSeconds: number;
  /** Whether repeated violations extend the block. Used for credential-guessing surfaces. */
  backoff: boolean;
}

/**
 * Layered abuse controls (`SPEC_CONTRACT.md` §10.8).
 *
 * Deliberately per-surface rather than one global limiter: login needs to be far tighter than
 * device listing, and a single shared budget would either leave credential stuffing viable or
 * break ordinary browsing.
 *
 * **Rate limiting is never a substitute for authorization.** Every limited route is also
 * authenticated and authorized; this only bounds volume.
 *
 * In-process state, which is correct for the single-instance MVP (`SYSTEM_DESIGN.md` §22 forbids
 * adding Redis for a hypothetical). Multi-instance deployment needs a shared store, and that is
 * recorded as a known limitation in HANDOFF.md rather than pre-built.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly windows = new Map<string, Window>();
  private readonly policies: Record<RateLimitPolicy, PolicyConfig>;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    const limits = config.rateLimits;
    this.policies = {
      login: { limit: limits.loginPerMinute, windowSeconds: 60, backoff: true },
      signup: { limit: limits.signupPerHour, windowSeconds: 3600, backoff: true },
      refresh: { limit: limits.refreshPerMinute, windowSeconds: 60, backoff: false },
      pairing: { limit: limits.pairingPerHour, windowSeconds: 3600, backoff: false },
      'register-device': { limit: limits.registerDevicePerHour, windowSeconds: 3600, backoff: true },
      'session-join': { limit: limits.sessionJoinPerMinute, windowSeconds: 60, backoff: true },
      default: { limit: limits.defaultPerMinute, windowSeconds: 60, backoff: false },
    };

    // Bounded memory: expired windows are swept rather than accumulating one entry per attacker IP.
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  consume(policy: RateLimitPolicy, identity: string): RateLimitDecision {
    const conf = this.policies[policy];
    const key = `${policy}:${identity}`;
    const now = this.clock.nowMs();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAtMs <= now) {
      const strikes = existing && existing.count > conf.limit ? existing.strikes : 0;
      this.windows.set(key, { count: 1, resetAtMs: now + conf.windowSeconds * 1000, strikes });
      return { allowed: true, remaining: conf.limit - 1, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    if (existing.count <= conf.limit) {
      return {
        allowed: true,
        remaining: conf.limit - existing.count,
        retryAfterSeconds: 0,
      };
    }

    if (conf.backoff) {
      // Each rejected window doubles the wait, capped, so sustained guessing becomes impractical
      // while an honest user's single fat-fingered password costs them almost nothing.
      existing.strikes = Math.min(existing.strikes + 1, 6);
      existing.resetAtMs = now + conf.windowSeconds * 1000 * Math.pow(2, existing.strikes - 1);
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
    };
  }

  /** Test and administrative use. */
  reset(): void {
    this.windows.clear();
  }

  private sweep(): void {
    const now = this.clock.nowMs();
    for (const [key, window] of this.windows) {
      if (window.resetAtMs <= now) this.windows.delete(key);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }
}
