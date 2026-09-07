import request from 'supertest';
import { verifyEd25519 } from '../../src/common/crypto';
import { createHarness, type Harness } from '../support/harness';
import type { RosterPayload } from '../support/roster';
import { pairDevice, signup, type TestAccount, type TestDevice } from '../support/factories';

/**
 * The authorization security suite.
 *
 * Every test here maps to a line in `SECURITY.md`'s objectives or its pre-release checklist.
 * Nothing is mocked: real guards, real crypto, real database.
 */
describe('authorization security', () => {
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

  const roster = async (device: TestDevice) => {
    const res = await request(h.app.getHttpServer())
      .get('/v1/authz/peer-set')
      .set('Authorization', `Bearer ${device.accessToken}`);
    return res;
  };

  const decode = (body: { payload: string }): RosterPayload =>
    JSON.parse(Buffer.from(body.payload, 'base64').toString('utf8')) as RosterPayload;

  describe('objective 1: unauthorized devices cannot receive clipboard contents', () => {
    it('does not place another user’s device in a roster', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);
      await pairDevice(h.app, bob);

      const res = await roster(aliceDevice);
      expect(res.status).toBe(200);
      // Two users on the same network, no sharing session: they are strangers.
      expect(decode(res.body).peers).toEqual([]);
    });

    it('places a user’s own second device in the roster', async () => {
      const alice = await signup(h.app);
      const first = await pairDevice(h.app, alice, { name: 'Laptop' });
      const second = await pairDevice(h.app, alice, { name: 'Phone' });

      const peers = decode((await roster(second)).body).peers;
      expect(peers).toHaveLength(1);
      expect(peers[0].deviceId).toBe(first.deviceId);
      expect(peers[0].scope).toBe('personal');
      expect(peers[0].sessionId).toBeNull();
      // The peer's public key is present: it is what makes LAN identity verifiable.
      expect(peers[0].publicKey).toBe(first.keypair.publicKeyBase64);
    });

    it('never places a device in its own roster', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);
      const body = decode((await roster(device)).body);

      expect(body.peers).toEqual([]);
      expect(body.self.deviceId).toBe(device.deviceId);
    });
  });

  describe('objective 4: revoked devices stop receiving data', () => {
    it('removes a revoked device from its peers’ rosters', async () => {
      const alice = await signup(h.app);
      const keeper = await pairDevice(h.app, alice, { name: 'Keeper' });
      const doomed = await pairDevice(h.app, alice, { name: 'Doomed' });

      expect(decode((await roster(keeper)).body).peers).toHaveLength(1);

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${doomed.deviceId}/revoke`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      expect(decode((await roster(keeper)).body).peers).toEqual([]);
    });

    it('rejects a revoked device’s own access token immediately', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${device.deviceId}/revoke`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      // The access token has not expired — revocation must not wait for it to.
      const res = await roster(device);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('device_revoked');
    });

    it('stops a revoked device refreshing its way back to a live token', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${device.deviceId}/revoke`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      const res = await request(h.app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: device.refreshToken });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('device_revoked');
    });

    it('bumps the roster version so a peer can detect staleness', async () => {
      const alice = await signup(h.app);
      const keeper = await pairDevice(h.app, alice, { name: 'Keeper' });
      const doomed = await pairDevice(h.app, alice, { name: 'Doomed' });

      const before = decode((await roster(keeper)).body).rosterVersion;

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${doomed.deviceId}/revoke`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      const after = decode((await roster(keeper)).body).rosterVersion;
      // Monotonic: a verifier that has seen `after` must reject any later roster claiming `before`.
      expect(after).toBeGreaterThan(before);
    });

    it('removes a deleted device from peers as thoroughly as a revoked one', async () => {
      const alice = await signup(h.app);
      const keeper = await pairDevice(h.app, alice, { name: 'Keeper' });
      const doomed = await pairDevice(h.app, alice, { name: 'Doomed' });

      await request(h.app.getHttpServer())
        .delete(`/v1/devices/${doomed.deviceId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(204);

      expect(decode((await roster(keeper)).body).peers).toEqual([]);
      expect((await roster(doomed)).status).toBe(401);
    });
  });

  describe('sync pause', () => {
    it('removes a paused device from its peers’ rosters', async () => {
      const alice = await signup(h.app);
      const keeper = await pairDevice(h.app, alice, { name: 'Keeper' });
      const paused = await pairDevice(h.app, alice, { name: 'Paused' });

      await request(h.app.getHttpServer())
        .patch(`/v1/devices/${paused.deviceId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ syncEnabled: false })
        .expect(200);

      expect(decode((await roster(keeper)).body).peers).toEqual([]);
    });

    it('gives a paused device an empty roster rather than an error', async () => {
      const alice = await signup(h.app);
      await pairDevice(h.app, alice, { name: 'Other' });
      const paused = await pairDevice(h.app, alice, { name: 'Paused' });

      await request(h.app.getHttpServer())
        .patch(`/v1/devices/${paused.deviceId}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ syncEnabled: false })
        .expect(200);

      const res = await roster(paused);
      // Pausing is a user preference, not a failure: the client simply has nobody to talk to.
      expect(res.status).toBe(200);
      expect(decode(res.body).peers).toEqual([]);
    });
  });

  describe('objective 7: temporary sharing is actually temporary', () => {
    async function shareBetween(alice: TestAccount, bob: TestAccount) {
      const created = await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ expiresInSeconds: 3600 })
        .expect(201);

      await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${created.body.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: created.body.joinCode })
        .expect(200);

      return created.body as { id: string; joinCode: string };
    }

    it('authorizes cross-user peers only through an active session', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);
      const bobDevice = await pairDevice(h.app, bob);

      expect(decode((await roster(aliceDevice)).body).peers).toEqual([]);

      const session = await shareBetween(alice, bob);

      const peers = decode((await roster(aliceDevice)).body).peers;
      expect(peers).toHaveLength(1);
      expect(peers[0].deviceId).toBe(bobDevice.deviceId);
      expect(peers[0].scope).toBe('session');
      expect(peers[0].sessionId).toBe(session.id);
    });

    it('drops session peers the moment the owner expires the session', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);
      await pairDevice(h.app, bob);

      const session = await shareBetween(alice, bob);
      expect(decode((await roster(aliceDevice)).body).peers).toHaveLength(1);

      await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${session.id}/expire`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      expect(decode((await roster(aliceDevice)).body).peers).toEqual([]);
    });

    it('drops session peers when the session simply ages out, with no sweep', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);
      await pairDevice(h.app, bob);

      // A 120s session, deliberately shorter than the 600s access-token life, so advancing past
      // the session expiry does not also expire the caller's token. Otherwise this test would
      // pass for the wrong reason — a 401, not an emptied roster.
      const created = await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ expiresInSeconds: 120 })
        .expect(201);
      await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${created.body.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: created.body.joinCode })
        .expect(200);

      expect(decode((await roster(aliceDevice)).body).peers).toHaveLength(1);

      // Nothing runs a sweep: the stored status is still 'active'. Authorization must expire on
      // its own, or "temporary" would depend on a background job having run.
      h.clock.advanceSeconds(121);

      const res = await roster(aliceDevice);
      expect(res.status).toBe(200);
      expect(decode(res.body).peers).toEqual([]);
    });

    it('drops a revoked member from the roster and refuses their rejoin', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);
      await pairDevice(h.app, bob);

      const session = await shareBetween(alice, bob);
      expect(decode((await roster(aliceDevice)).body).peers).toHaveLength(1);

      await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${session.id}/revoke-member`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: bob.userId })
        .expect(200);

      expect(decode((await roster(aliceDevice)).body).peers).toEqual([]);

      // The join code must not be a way around the owner's decision.
      const rejoin = await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${session.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: session.joinCode });
      expect(rejoin.status).toBe(403);
    });

    it('refuses joins to an expired session', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);

      const created = await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ expiresInSeconds: 60 })
        .expect(201);

      h.clock.advanceSeconds(61);

      const res = await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${created.body.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: created.body.joinCode });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('session_expired');
    });

    it('rejects a wrong join code', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);

      const created = await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);

      const res = await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${created.body.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: 'ZZZZZZZZ' });

      expect(res.status).toBe(403);
    });

    it('caps a session TTL server-side', async () => {
      const alice = await signup(h.app);
      const res = await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ expiresInSeconds: 86400 })
        .expect(201);

      const ttlSeconds = (new Date(res.body.expiresAt).getTime() - h.clock.nowMs()) / 1000;
      expect(ttlSeconds).toBeLessThanOrEqual(h.config.shareSessions.maxTtlSeconds);
    });

    it('refuses a TTL beyond the contract maximum outright', async () => {
      const alice = await signup(h.app);
      await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ expiresInSeconds: 999999 })
        .expect(400);
    });
  });

  describe('roster integrity', () => {
    it('is signed by a key served at roster-keys, over the exact transmitted bytes', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);

      const res = await roster(device);
      const keys = await request(h.app.getHttpServer()).get('/v1/authz/roster-keys').expect(200);

      const key = keys.body.keys.find((k: { keyId: string }) => k.keyId === res.body.signature.keyId);
      expect(key).toBeDefined();

      const verified = verifyEd25519(
        Buffer.from(key.publicKey, 'base64'),
        Buffer.from(res.body.payload, 'base64'),
        Buffer.from(res.body.signature.value, 'base64'),
      );
      expect(verified).toBe(true);
    });

    it('fails verification when the payload is tampered with', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);

      const res = await roster(device);
      const keys = await request(h.app.getHttpServer()).get('/v1/authz/roster-keys').expect(200);
      const key = keys.body.keys[0];

      // Forge a peer into the roster, exactly as an attacker on the LAN would want to.
      const forged = JSON.parse(Buffer.from(res.body.payload, 'base64').toString('utf8'));
      forged.peers.push({
        deviceId: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp99',
        userId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp99',
        publicKey: 'A'.repeat(43) + '=',
        keyFingerprint: 'sha256:' + '9'.repeat(64),
        platform: 'linux',
        protocolVersion: 1,
        capabilities: { contentTypes: ['text/plain'] },
        scope: 'personal',
        sessionId: null,
      });

      const verified = verifyEd25519(
        Buffer.from(key.publicKey, 'base64'),
        Buffer.from(JSON.stringify(forged), 'utf8'),
        Buffer.from(res.body.signature.value, 'base64'),
      );
      expect(verified).toBe(false);
    });

    it('binds the roster to the requesting device so it cannot be replayed sideways', async () => {
      const alice = await signup(h.app);
      const a = await pairDevice(h.app, alice, { name: 'A' });
      const b = await pairDevice(h.app, alice, { name: 'B' });

      const rosterA = decode((await roster(a)).body);
      const rosterB = decode((await roster(b)).body);

      expect(rosterA.self.deviceId).toBe(a.deviceId);
      expect(rosterB.self.deviceId).toBe(b.deviceId);
      expect(rosterA.self.deviceId).not.toBe(rosterB.self.deviceId);
    });

    it('expires within the configured TTL', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);
      const body = decode((await roster(device)).body);

      const ttl = (new Date(body.expiresAt).getTime() - new Date(body.issuedAt).getTime()) / 1000;
      expect(ttl).toBe(h.config.roster.ttlSeconds);
      // Short by design: this is how revocation propagates without push infrastructure.
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it('is never cached by an intermediary', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);

      const res = await roster(device);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('principal separation', () => {
    it('refuses a roster to a browser token', async () => {
      const alice = await signup(h.app);
      await pairDevice(h.app, alice);

      // A stolen web session must not yield clipboard peer keys (ADR-004).
      const res = await request(h.app.getHttpServer())
        .get('/v1/authz/peer-set')
        .set('Authorization', `Bearer ${alice.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('refuses a heartbeat for a device other than the caller', async () => {
      const alice = await signup(h.app);
      const a = await pairDevice(h.app, alice, { name: 'A' });
      const b = await pairDevice(h.app, alice, { name: 'B' });

      // One compromised agent must not be able to make another device look alive.
      const res = await request(h.app.getHttpServer())
        .post(`/v1/devices/${b.deviceId}/heartbeat`)
        .set('Authorization', `Bearer ${a.accessToken}`);

      expect(res.status).toBe(403);
    });

    it('accepts a heartbeat for the calling device', async () => {
      const alice = await signup(h.app);
      const device = await pairDevice(h.app, alice);

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${device.deviceId}/heartbeat`)
        .set('Authorization', `Bearer ${device.accessToken}`)
        .expect(204);
    });
  });
});
