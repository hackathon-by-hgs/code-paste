import { FixedClock } from '../common/clock';
import { loadConfig } from '../config/configuration';
import { RateLimitService } from './rate-limit.service';

function build(overrides: Record<string, string> = {}) {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const config = loadConfig({
    AUTH_JWT_SECRET: 'test-only-synthetic-jwt-secret-value-0123456789abcdef',
    RATE_LIMIT_LOGIN_PER_MINUTE: '3',
    RATE_LIMIT_DEFAULT_PER_MINUTE: '5',
    ...overrides,
  });
  return { service: new RateLimitService(config, clock), clock };
}

describe('RateLimitService', () => {
  it('allows requests up to the policy limit', () => {
    const { service } = build();
    for (let i = 0; i < 3; i++) expect(service.consume('login', 'ip:1.2.3.4').allowed).toBe(true);
    expect(service.consume('login', 'ip:1.2.3.4').allowed).toBe(false);
  });

  it('reports remaining budget', () => {
    const { service } = build();
    expect(service.consume('login', 'ip:1.2.3.4').remaining).toBe(2);
    expect(service.consume('login', 'ip:1.2.3.4').remaining).toBe(1);
    expect(service.consume('login', 'ip:1.2.3.4').remaining).toBe(0);
  });

  it('isolates identities', () => {
    const { service } = build();
    for (let i = 0; i < 3; i++) service.consume('login', 'ip:1.1.1.1');
    expect(service.consume('login', 'ip:1.1.1.1').allowed).toBe(false);
    // A different caller must be unaffected, or one abuser takes everyone else down with them.
    expect(service.consume('login', 'ip:2.2.2.2').allowed).toBe(true);
  });

  it('isolates policies', () => {
    const { service } = build();
    for (let i = 0; i < 3; i++) service.consume('login', 'ip:1.1.1.1');
    expect(service.consume('login', 'ip:1.1.1.1').allowed).toBe(false);
    // Exhausting the login budget must not lock the caller out of ordinary browsing.
    expect(service.consume('default', 'ip:1.1.1.1').allowed).toBe(true);
  });

  it('recovers after the window elapses', () => {
    const { service, clock } = build();
    for (let i = 0; i < 3; i++) service.consume('login', 'ip:1.1.1.1');
    expect(service.consume('login', 'ip:1.1.1.1').allowed).toBe(false);

    clock.advanceSeconds(61);
    expect(service.consume('login', 'ip:1.1.1.1').allowed).toBe(true);
  });

  it('lengthens the penalty for sustained abuse on credential surfaces', () => {
    const { service, clock } = build();
    for (let i = 0; i < 4; i++) service.consume('login', 'ip:9.9.9.9');
    const first = service.consume('login', 'ip:9.9.9.9');
    expect(first.allowed).toBe(false);

    // Each rejected window doubles the wait, so guessing becomes impractical while a single
    // fat-fingered password costs an honest user almost nothing.
    const second = service.consume('login', 'ip:9.9.9.9');
    expect(second.retryAfterSeconds).toBeGreaterThan(first.retryAfterSeconds);

    clock.advanceSeconds(61);
    expect(service.consume('login', 'ip:9.9.9.9').allowed).toBe(false); // still blocked
  });

  it('does not apply backoff to non-credential surfaces', () => {
    const { service, clock } = build();
    for (let i = 0; i < 6; i++) service.consume('default', 'ip:8.8.8.8');
    expect(service.consume('default', 'ip:8.8.8.8').allowed).toBe(false);

    clock.advanceSeconds(61);
    expect(service.consume('default', 'ip:8.8.8.8').allowed).toBe(true);
  });

  it('always reports a positive retry-after when blocking', () => {
    const { service } = build();
    for (let i = 0; i < 3; i++) service.consume('login', 'ip:1.1.1.1');
    expect(service.consume('login', 'ip:1.1.1.1').retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
