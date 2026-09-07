import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { CLOCK, FixedClock } from '../../src/common/clock';
import { APP_CONFIG, loadConfig, type AppConfig } from '../../src/config/configuration';
import { DatabaseService } from '../../src/persistence/database.service';
import { configureApp } from '../../src/http/configure-app';
import { RateLimitService } from '../../src/rate-limiting/rate-limit.service';

/**
 * One test harness for integration, security and e2e suites.
 *
 * It boots the *real* application: real guards, real pipes, real filters, real repositories, real
 * PostgreSQL. Nothing security-relevant is stubbed, because a suite that mocks the guard it is
 * meant to be testing proves nothing.
 *
 * The database is PGlite by default — real PostgreSQL in WebAssembly, no Docker — and real
 * PostgreSQL when DATABASE_URL is set, using the same schema and migrations either way (ADR-007).
 */
export interface Harness {
  app: NestExpressApplication;
  module: TestingModule;
  db: DatabaseService;
  clock: FixedClock;
  config: AppConfig;
  reset(): Promise<void>;
  close(): Promise<void>;
  /**
   * Starts listening and returns the port.
   *
   * Required for WebSocket tests: the `upgrade` event only fires on a listening server, so a
   * supertest-only harness cannot exercise the realtime layer at all.
   */
  listen(): Promise<number>;
}

export async function createHarness(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const config = loadConfig({ ...process.env, ...overrides });

  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    // Time is controlled so expiry can be tested by advancing it rather than by sleeping.
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app = module.createNestApplication<NestExpressApplication>({ bodyParser: true });
  configureApp(app, config);
  await app.init();

  const db = module.get(DatabaseService);
  await db.migrate(join(__dirname, '../../src/persistence/migrations'));

  return {
    app,
    module,
    db,
    clock,
    config,
    async reset() {
      await db.truncateAll();
      clock.set(new Date('2026-01-01T00:00:00.000Z'));
      // Rate-limit windows are keyed by IP, and every test shares 127.0.0.1 with a frozen clock,
      // so without this a suite exhausts the signup budget and later tests fail for the wrong
      // reason. The limiter itself is exercised deliberately in test/security/hardening.spec.ts.
      module.get(RateLimitService).reset();
    },
    async listen() {
      await app.listen(0, '127.0.0.1');
      const address = (app.getHttpServer() as { address(): { port: number } | string | null }).address();
      if (!address || typeof address === 'string') throw new Error('Server did not bind to a port.');
      return address.port;
    },
    async close() {
      await app.close();
    },
  };
}
