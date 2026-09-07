import { loadConfig } from '../config/configuration';
import { DatabaseService } from './database.service';

const BASE = { AUTH_JWT_SECRET: 'test-only-synthetic-jwt-secret-value-0123456789abcdef' };

describe('DatabaseService driver selection', () => {
  it('uses in-process PGlite when no DATABASE_URL is configured', async () => {
    const service = new DatabaseService(loadConfig({ ...BASE }));
    expect(service.driver).toBe('pglite');
    await service.onModuleDestroy();
  });

  it('uses node-postgres when DATABASE_URL is configured', async () => {
    // `new Pool()` does not connect eagerly, so this exercises the production driver branch
    // without needing a server. End-to-end behaviour against real PostgreSQL is covered by the
    // `postgres` leg of the CI matrix, which runs the identical suites.
    const service = new DatabaseService(
      loadConfig({ ...BASE, DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/unused' }),
    );
    expect(service.driver).toBe('postgres');
    await service.onModuleDestroy();
  });
});
