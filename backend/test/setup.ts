/**
 * Jest setup.
 *
 * Every value here is synthetic. `TEST_STRATEGY.md`: never use real passwords, keys, tokens or
 * clipboard content in tests.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.AUTH_JWT_SECRET =
  process.env.AUTH_JWT_SECRET ?? 'test-only-synthetic-jwt-secret-value-0123456789abcdef';
process.env.ROSTER_SIGNING_SECRET_KEY =
  process.env.ROSTER_SIGNING_SECRET_KEY ?? Buffer.alloc(32, 7).toString('base64');

// PGlite compiles WebAssembly on first use; a real Postgres over a socket is slower still.
jest.setTimeout(60_000);
