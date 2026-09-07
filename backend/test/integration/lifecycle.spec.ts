import request from 'supertest';
import { createHarness, type Harness } from '../support/harness';
import { pairDevice, signup, TEST_PASSWORD, uniqueEmail } from '../support/factories';

/**
 * Account, device and pairing lifecycle against a real database.
 *
 * Nothing is mocked: real guards, real Argon2, real repositories, real PostgreSQL.
 */
describe('account and device lifecycle', () => {
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

  it('reports health and the protocol policy without authentication', async () => {
    const health = await request(h.app.getHttpServer()).get('/v1/health').expect(200);
    expect(health.body.status).toBe('ok');

    const protocol = await request(h.app.getHttpServer()).get('/v1/protocol').expect(200);
    expect(protocol.body.supportedProtocolVersions).toEqual([1]);
    expect(protocol.body.limits['text/plain']).toBe(1048576);
    expect(protocol.body.limits['image/png']).toBe(10485760);
  });

  it('signs a user up and issues a usable browser token', async () => {
    const account = await signup(h.app);
    expect(account.userId).toMatch(/^cp_usr_[0-9a-hjkmnp-tv-z]{26}$/);

    const me = await request(h.app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    expect(me.body.principal).toBe('browser');
    expect(me.body.device).toBeNull();
    expect(me.body.user.email).toBe(account.email);
  });

  it('rejects a duplicate signup with conflict', async () => {
    const email = uniqueEmail();
    await signup(h.app, email);
    const res = await request(h.app.getHttpServer())
      .post('/v1/auth/signup')
      .send({ email, password: TEST_PASSWORD })
      .expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('treats email as case-insensitive for the same account', async () => {
    const email = uniqueEmail();
    await signup(h.app, email);
    const res = await request(h.app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.user.email).toBe(email);
  });

  it('pairs a device and issues a device-bound token', async () => {
    const account = await signup(h.app);
    const device = await pairDevice(h.app, account);

    expect(device.deviceId).toMatch(/^cp_dev_[0-9a-hjkmnp-tv-z]{26}$/);

    const me = await request(h.app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${device.accessToken}`)
      .expect(200);

    expect(me.body.principal).toBe('device');
    expect(me.body.device.id).toBe(device.deviceId);
    expect(me.body.device.syncEnabled).toBe(true);
    expect(me.body.device.revoked).toBe(false);
  });

  it('lists, renames and pauses a device', async () => {
    const account = await signup(h.app);
    const device = await pairDevice(h.app, account);

    const list = await request(h.app.getHttpServer())
      .get('/v1/devices')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.nextCursor).toBeNull();

    const renamed = await request(h.app.getHttpServer())
      .patch(`/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ name: 'Renamed' })
      .expect(200);
    expect(renamed.body.name).toBe('Renamed');

    const paused = await request(h.app.getHttpServer())
      .patch(`/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ syncEnabled: false })
      .expect(200);
    expect(paused.body.syncEnabled).toBe(false);
  });

  it('rejects an empty PATCH rather than silently doing nothing', async () => {
    const account = await signup(h.app);
    const device = await pairDevice(h.app, account);

    const res = await request(h.app.getHttpServer())
      .patch(`/v1/devices/${device.deviceId}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('consumes a pairing code exactly once', async () => {
    const account = await signup(h.app);
    const codeRes = await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    const body = (publicKey: string) => ({
      pairingCode: codeRes.body.code,
      name: 'Device',
      platform: 'linux',
      appVersion: '1.0.0',
      protocolVersion: 1,
      publicKey,
      capabilities: { contentTypes: ['text/plain'] },
    });

    const { generateKeypair } = await import('../support/factories');
    await request(h.app.getHttpServer())
      .post('/v1/devices')
      .send(body(generateKeypair().publicKeyBase64))
      .expect(201);

    // Second use of the same code must fail, and must be indistinguishable from an unknown code.
    const second = await request(h.app.getHttpServer())
      .post('/v1/devices')
      .send(body(generateKeypair().publicKeyBase64))
      .expect(401);
    expect(second.body.error.code).toBe('unauthenticated');
  });

  it('expires a pairing code', async () => {
    const account = await signup(h.app);
    const codeRes = await request(h.app.getHttpServer())
      .post('/v1/devices/pairing-codes')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(201);

    // Time is injected, so expiry is tested by advancing it rather than by sleeping.
    h.clock.advanceSeconds(h.config.pairing.codeTtlSeconds + 1);

    const { generateKeypair } = await import('../support/factories');
    const res = await request(h.app.getHttpServer())
      .post('/v1/devices')
      .send({
        pairingCode: codeRes.body.code,
        name: 'Device',
        platform: 'linux',
        appVersion: '1.0.0',
        protocolVersion: 1,
        publicKey: generateKeypair().publicKeyBase64,
        capabilities: { contentTypes: ['text/plain'] },
      })
      .expect(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
});
