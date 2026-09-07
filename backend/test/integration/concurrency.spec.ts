import request from 'supertest';
import { generateKeypair, pairDevice, signup } from '../support/factories';
import { createHarness, type Harness } from '../support/harness';

/**
 * Concurrency and transactional integrity.
 *
 * These are the cases where a check-then-act would pass a single-threaded test and fail under
 * real load — and where the failure mode is a security one: two devices from one authorisation,
 * two live token pairs from one refresh, or a revoked device that kept a working credential.
 */
describe('concurrency and transactions', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
  });

  const server = () => h.app.getHttpServer();

  it('consumes a pairing code exactly once under a race', async () => {
    const account = await signup(h.app);
    const codeRes = await request(server())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    const attempt = (name: string) =>
      request(server())
        .post('/v1/devices')
        .send({
          pairingCode: codeRes.body.code,
          name,
          platform: 'linux',
          appVersion: '1.0.0',
          protocolVersion: 1,
          publicKey: generateKeypair().publicKeyBase64,
          capabilities: { contentTypes: ['text/plain'] },
        });

    // Five agents racing on one code. The conditional UPDATE means exactly one wins; a
    // find-then-update would let several through and bind several devices from one authorisation.
    const results = await Promise.all([attempt('A'), attempt('B'), attempt('C'), attempt('D'), attempt('E')]);

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 401);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    const devices = await request(server())
      .get('/v1/devices')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(devices.body.data).toHaveLength(1);
  });

  it('issues exactly one token pair when a refresh token is used concurrently', async () => {
    const account = await signup(h.app);

    const results = await Promise.all([
      request(server()).post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }),
      request(server()).post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }),
      request(server()).post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }),
    ]);

    const succeeded = results.filter((r) => r.status === 200);
    // At most one winner. Two live pairs from one token would mean an undetectable duplicate
    // credential — the exact thing rotation exists to prevent.
    expect(succeeded.length).toBeLessThanOrEqual(1);
    for (const failure of results.filter((r) => r.status !== 200)) {
      expect([401]).toContain(failure.status);
    }
  });

  it('revokes a device and its tokens atomically', async () => {
    const account = await signup(h.app);
    const device = await pairDevice(h.app, account);

    await request(server())
      .post(`/v1/devices/${device.deviceId}/revoke`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    // Both halves must have landed. A device marked revoked whose refresh token survived could
    // mint fresh access tokens indefinitely.
    const rosterAttempt = await request(server())
      .get('/v1/authz/peer-set')
      .set('Authorization', `Bearer ${device.accessToken}`);
    expect(rosterAttempt.status).toBe(403);

    const refreshAttempt = await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: device.refreshToken });
    expect(refreshAttempt.status).toBe(403);
  });

  it('keeps revocation idempotent without moving the original timestamp', async () => {
    const account = await signup(h.app);
    const device = await pairDevice(h.app, account);

    const first = await request(server())
      .post(`/v1/devices/${device.deviceId}/revoke`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    h.clock.advanceSeconds(60);

    const second = await request(server())
      .post(`/v1/devices/${device.deviceId}/revoke`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    // A repeated revoke must not look like a fresh one.
    expect(second.body.revokedAt).toBe(first.body.revokedAt);
  });

  it('coalesces heartbeat writes', async () => {
    const account = await signup(h.app);
    const device = await pairDevice(h.app, account);

    const heartbeat = () =>
      request(server())
        .post(`/v1/devices/${device.deviceId}/heartbeat`)
        .set('Authorization', `Bearer ${device.accessToken}`)
        .expect(204);

    await heartbeat();
    const afterFirst = await request(server())
      .get(`/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(afterFirst.body.lastSeenAt).not.toBeNull();

    // Well within the coalescing window: further beats must not write.
    h.clock.advanceSeconds(10);
    await heartbeat();
    const afterSecond = await request(server())
      .get(`/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(afterSecond.body.lastSeenAt).toBe(afterFirst.body.lastSeenAt);

    // Past the window it writes again — this is the only mildly write-hot path, and it is bounded
    // here rather than by choosing a different datastore (ADR-007).
    h.clock.advanceSeconds(h.config.devices.heartbeatCoalesceSeconds + 1);
    await heartbeat();
    const afterWindow = await request(server())
      .get(`/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(afterWindow.body.lastSeenAt).not.toBe(afterFirst.body.lastSeenAt);
  });

  it('enforces one key fingerprint per account at the database level', async () => {
    const account = await signup(h.app);
    const keypair = generateKeypair();
    await pairDevice(h.app, account, { publicKey: keypair.publicKeyBase64 });

    // Two codes, two simultaneous registrations, same key. The unique index is what makes this
    // safe — an application-level "does it already exist?" check would race.
    const codes = await Promise.all([
      request(server())
        .post('/v1/devices/pairing-codes')
        .set('Authorization', `Bearer ${account.accessToken}`),
      request(server())
        .post('/v1/devices/pairing-codes')
        .set('Authorization', `Bearer ${account.accessToken}`),
    ]);

    const results = await Promise.all(
      codes.map((c) =>
        request(server())
          .post('/v1/devices')
          .send({
            pairingCode: c.body.code,
            name: 'Clone',
            platform: 'linux',
            appVersion: '1.0.0',
            protocolVersion: 1,
            publicKey: keypair.publicKeyBase64,
            capabilities: { contentTypes: ['text/plain'] },
          }),
      ),
    );

    expect(results.every((r) => r.status !== 201)).toBe(true);
  });

  it('lets a different user register the same public key', async () => {
    // The constraint is per-account. Two unrelated users generating the same key is not a
    // realistic scenario, but scoping the uniqueness globally would leak that they collided.
    const alice = await signup(h.app);
    const bob = await signup(h.app);
    const keypair = generateKeypair();

    await pairDevice(h.app, alice, { publicKey: keypair.publicKeyBase64 });
    const bobDevice = await pairDevice(h.app, bob, { publicKey: keypair.publicKeyBase64 });
    expect(bobDevice.deviceId).toBeDefined();
  });

  it('paginates devices without skipping or repeating rows', async () => {
    const account = await signup(h.app);
    for (let i = 0; i < 5; i++) await pairDevice(h.app, account, { name: `Device ${i}` });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url: string = `/v1/devices?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await request(server())
        .get(url)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      seen.push(...res.body.data.map((d: { id: string }) => d.id));
      cursor = res.body.nextCursor as string | null;
      pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});
