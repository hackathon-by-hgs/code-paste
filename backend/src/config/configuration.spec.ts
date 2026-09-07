import { loadConfig } from './configuration';

const VALID_SECRET = 'test-only-synthetic-jwt-secret-value-0123456789abcdef';
const base = { AUTH_JWT_SECRET: VALID_SECRET } as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig(base);
    expect(config.auth.accessTokenTtlSeconds).toBe(600);
    expect(config.roster.ttlSeconds).toBe(300);
    expect(config.pairing.codeTtlSeconds).toBe(300);
    expect(config.realtime.maxMessageBytes).toBe(8192);
    expect(config.http.maxBodyBytes).toBe(65536);
  });

  it('refuses to start without a JWT secret', () => {
    expect(() => loadConfig({})).toThrow(/AUTH_JWT_SECRET/);
  });

  it('refuses a JWT secret that is too short', () => {
    expect(() => loadConfig({ AUTH_JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('never includes the offending value in the error message', () => {
    // The failure names fields only. Printing values would put a secret into startup logs.
    try {
      loadConfig({ AUTH_JWT_SECRET: 'a-recognisable-short-secret' });
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('a-recognisable-short-secret');
      expect((error as Error).message).toContain('AUTH_JWT_SECRET');
    }
  });

  it('rejects a session TTL default larger than its maximum', () => {
    expect(() =>
      loadConfig({
        ...base,
        SHARE_SESSION_DEFAULT_TTL_SECONDS: '7200',
        SHARE_SESSION_MAX_TTL_SECONDS: '3600',
      }),
    ).toThrow(/exceeds the maximum/);
  });

  describe('production hardening', () => {
    const production = { ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv;

    it('requires a configured roster signing key', () => {
      // A key generated at boot would invalidate every cached roster in the field on restart.
      expect(() => loadConfig({ ...production, DATABASE_URL: 'postgres://u:p@h:5432/d' })).toThrow(
        /ROSTER_SIGNING_SECRET_KEY/,
      );
    });

    it('requires a real database', () => {
      expect(() => loadConfig({ ...production, ROSTER_SIGNING_SECRET_KEY: 'x'.repeat(44) })).toThrow(
        /DATABASE_URL/,
      );
    });

    it('rejects a development placeholder secret', () => {
      expect(() =>
        loadConfig({
          ...production,
          AUTH_JWT_SECRET: 'dev-only-insecure-secret-change-me-at-least-32-bytes-long',
          DATABASE_URL: 'postgres://u:p@h:5432/d',
          ROSTER_SIGNING_SECRET_KEY: 'x'.repeat(44),
        }),
      ).toThrow(/placeholder/);
    });

    it('accepts a fully configured production environment', () => {
      const config = loadConfig({
        ...production,
        DATABASE_URL: 'postgres://u:p@h:5432/d',
        ROSTER_SIGNING_SECRET_KEY: 'x'.repeat(44),
      });
      expect(config.isProduction).toBe(true);
    });

    it('allows development to run with neither', () => {
      // Local development must work with no secrets and no database container.
      const config = loadConfig(base);
      expect(config.isProduction).toBe(false);
      expect(config.database.url).toBeUndefined();
    });
  });
});
