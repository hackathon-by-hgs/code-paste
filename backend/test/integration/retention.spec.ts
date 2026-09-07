import request from 'supertest';
import { RetentionService } from '../../src/persistence/retention.service';
import { signup } from '../support/factories';
import { createHarness, type Harness } from '../support/harness';

/**
 * Retention.
 *
 * Every login, rotation and pairing attempt leaves a row that is useless once expired. Without a
 * sweep those tables grow without bound — an unbounded resource, and a data-minimisation problem
 * under `SECURITY.md`: temporary material should actually be removed, not merely made ineffective.
 */
describe('retention sweep', () => {
  let h: Harness;
  let retention: RetentionService;

  beforeAll(async () => {
    h = await createHarness();
    retention = h.module.get(RetentionService);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
  });

  it('removes nothing while material is still live', async () => {
    await signup(h.app);
    const account = await signup(h.app);
    await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    expect(await retention.sweep()).toEqual({ refreshTokens: 0, pairingCodes: 0 });
  });

  it('removes expired refresh tokens and pairing codes once past the grace period', async () => {
    const account = await signup(h.app);
    await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    // Past both the pairing-code TTL and the refresh-token TTL, plus the 24h grace.
    h.clock.advanceSeconds(h.config.auth.refreshTokenTtlSeconds + 25 * 60 * 60);

    const removed = await retention.sweep();
    expect(removed.refreshTokens).toBeGreaterThan(0);
    expect(removed.pairingCodes).toBeGreaterThan(0);
  });

  it('is idempotent', async () => {
    const account = await signup(h.app);
    await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    h.clock.advanceSeconds(h.config.auth.refreshTokenTtlSeconds + 25 * 60 * 60);

    await retention.sweep();
    expect(await retention.sweep()).toEqual({ refreshTokens: 0, pairingCodes: 0 });
  });

  it('does not remove material that is merely expired but still inside the grace period', async () => {
    const account = await signup(h.app);
    await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    // The code has expired, but recently. Keeping it briefly aids diagnosis, and deleting it
    // could never have granted access anyway — expiry is enforced at read time regardless.
    h.clock.advanceSeconds(h.config.pairing.codeTtlSeconds + 60);
    expect((await retention.sweep()).pairingCodes).toBe(0);
  });

  it('never grants access by deleting a row', async () => {
    const account = await signup(h.app);
    const codeRes = await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    h.clock.advanceSeconds(h.config.auth.refreshTokenTtlSeconds + 25 * 60 * 60);
    await retention.sweep();

    // The swept code must be as unusable afterwards as it was before — a deleted row must read as
    // "unknown", never as "unconsumed".
    const { generateKeypair } = await import('../support/factories');
    const res = await request(h.app.getHttpServer())
      .post('/v1/devices')
      .send({
        pairingCode: codeRes.body.code,
        name: 'After sweep',
        platform: 'linux',
        appVersion: '1.0.0',
        protocolVersion: 1,
        publicKey: generateKeypair().publicKeyBase64,
        capabilities: { contentTypes: ['text/plain'] },
      });
    expect(res.status).toBe(401);
  });
});
