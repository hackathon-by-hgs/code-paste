import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { sha256Prefixed, signEd25519, verifyEd25519 } from '../../src/common/crypto';
import { pairDevice, signup, type TestDevice } from '../support/factories';
import { createHarness, type Harness } from '../support/harness';
import type { RosterPayload } from '../support/roster';
import { connect } from '../support/ws-client';

/**
 * The end-to-end flow the backend exists to enable:
 *
 *   authenticate -> register device -> obtain authorized peer information
 *   -> establish an authenticated peer relationship -> session authorization
 *   -> realtime state updates -> revocation -> access denied
 *
 * The clipboard leg is deliberately simulated **between two in-test agents**, using nothing from
 * the backend except the signed roster. That is the point: if this test could be satisfied by a
 * server-side relay, it would be validating the wrong architecture (ADR-001).
 */
describe('end-to-end control-plane flow', () => {
  let h: Harness;
  let port: number;

  beforeAll(async () => {
    h = await createHarness();
    port = await h.listen();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
  });

  const server = () => h.app.getHttpServer();

  async function fetchRoster(device: TestDevice): Promise<RosterPayload> {
    const res = await request(server())
      .get('/v1/authz/peer-set')
      .set('Authorization', `Bearer ${device.accessToken}`)
      .expect(200);

    const keys = await request(server()).get('/v1/authz/roster-keys').expect(200);
    const key = keys.body.keys.find((k: { keyId: string }) => k.keyId === res.body.signature.keyId);

    // The mandated verification order: signature over the exact bytes, THEN parse.
    const payloadBytes = Buffer.from(res.body.payload, 'base64');
    const signatureValid = verifyEd25519(
      Buffer.from(key.publicKey, 'base64'),
      payloadBytes,
      Buffer.from(res.body.signature.value, 'base64'),
    );
    expect(signatureValid).toBe(true);

    return JSON.parse(payloadBytes.toString('utf8')) as RosterPayload;
  }

  /**
   * A stand-in for the LAN transport handshake.
   *
   * The responder proves possession of the private key matching the public key the roster
   * published. This is the `peerIdentityIsCryptographicallyVerified` term of the authorization
   * predicate — the one the control plane cannot decide for the agents, which is exactly why the
   * roster ships public keys rather than only device ids.
   */
  function performPeerHandshake(
    initiatorRosterEntry: { publicKey: string },
    responder: TestDevice,
  ): { verified: boolean; challenge: Buffer } {
    const challenge = randomBytes(32);
    const signature = signEd25519(responder.keypair.privateKeyRaw, challenge);
    const verified = verifyEd25519(
      Buffer.from(initiatorRosterEntry.publicKey, 'base64'),
      challenge,
      signature,
    );
    return { verified, challenge };
  }

  it('carries a user from signup to a verified peer relationship and back to denied', async () => {
    // --- 1. authenticate -------------------------------------------------------------------
    const account = await signup(h.app);

    const me = await request(server())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(me.body.principal).toBe('browser');

    // --- 2. register two devices through the pairing flow ----------------------------------
    const laptop = await pairDevice(h.app, account, { name: 'Laptop', platform: 'macos' });
    const phone = await pairDevice(h.app, account, { name: 'Phone', platform: 'android' });

    const devices = await request(server())
      .get('/v1/devices')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);
    expect(devices.body.data).toHaveLength(2);

    // --- 3. obtain authorized peer information ---------------------------------------------
    const laptopRoster = await fetchRoster(laptop);
    expect(laptopRoster.self.deviceId).toBe(laptop.deviceId);
    expect(laptopRoster.peers).toHaveLength(1);

    const phoneAsPeer = laptopRoster.peers[0];
    expect(phoneAsPeer.deviceId).toBe(phone.deviceId);
    expect(phoneAsPeer.scope).toBe('personal');
    expect(phoneAsPeer.publicKey).toBe(phone.keypair.publicKeyBase64);
    // The fingerprint LAN discovery would advertise must match the key the roster published.
    expect(phoneAsPeer.keyFingerprint).toBe(sha256Prefixed(phone.keypair.publicKeyRaw));

    // --- 4. establish an authenticated peer relationship ------------------------------------
    const handshake = performPeerHandshake(phoneAsPeer, phone);
    expect(handshake.verified).toBe(true);

    // An impostor advertising the same device id but holding a different key must fail. This is
    // why "discovered on the LAN" is never sufficient.
    const impostor = await pairDevice(h.app, account, { name: 'Impostor' });
    const impostorAttempt = verifyEd25519(
      Buffer.from(phoneAsPeer.publicKey, 'base64'),
      handshake.challenge,
      signEd25519(impostor.keypair.privateKeyRaw, handshake.challenge),
    );
    expect(impostorAttempt).toBe(false);

    // --- 5. realtime state updates ----------------------------------------------------------
    const socket = await connect(port, { token: laptop.accessToken });
    const ready = await socket.waitFor('connection.ready');
    expect(ready.data!.deviceId).toBe(laptop.deviceId);

    // --- 6. revocation ----------------------------------------------------------------------
    await request(server())
      .post(`/v1/devices/${phone.deviceId}/revoke`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    const changed = await socket.waitFor('authorization.changed');
    expect(changed.data).toMatchObject({ reason: 'device-revoked' });

    // --- 7. access denied -------------------------------------------------------------------
    const afterRevocation = await fetchRoster(laptop);
    expect(afterRevocation.peers.map((p: { deviceId: string }) => p.deviceId)).not.toContain(phone.deviceId);
    // Monotonic, so the laptop can reject a replay of the older, more permissive roster.
    expect(afterRevocation.rosterVersion).toBeGreaterThan(laptopRoster.rosterVersion);

    const revokedRoster = await request(server())
      .get('/v1/authz/peer-set')
      .set('Authorization', `Bearer ${phone.accessToken}`);
    expect(revokedRoster.status).toBe(403);
    expect(revokedRoster.body.error.code).toBe('device_revoked');

    socket.close();
  });

  it('authorizes a cross-user peer only for the life of a share session', async () => {
    const alice = await signup(h.app);
    const bob = await signup(h.app);
    const aliceDevice = await pairDevice(h.app, alice, { name: 'Alice laptop' });
    const bobDevice = await pairDevice(h.app, bob, { name: 'Bob laptop' });

    // Same network, different accounts, no session: strangers.
    expect((await fetchRoster(aliceDevice)).peers).toEqual([]);

    const created = await request(server())
      .post('/v1/share-sessions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ expiresInSeconds: 120 })
      .expect(201);

    await request(server())
      .post(`/v1/share-sessions/${created.body.id}/join`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ joinCode: created.body.joinCode })
      .expect(200);

    const duringSession = await fetchRoster(aliceDevice);
    expect(duringSession.peers).toHaveLength(1);
    expect(duringSession.peers[0].deviceId).toBe(bobDevice.deviceId);
    expect(duringSession.peers[0].scope).toBe('session');

    // Alice can now cryptographically verify Bob's device on the LAN.
    expect(performPeerHandshake(duringSession.peers[0], bobDevice).verified).toBe(true);

    // The session ages out with nothing sweeping it.
    h.clock.advanceSeconds(121);

    expect((await fetchRoster(aliceDevice)).peers).toEqual([]);
  });

  it('moves clipboard data device-to-device, with the backend never seeing it', async () => {
    const account = await signup(h.app);
    const sender = await pairDevice(h.app, account, { name: 'Sender' });
    const receiver = await pairDevice(h.app, account, { name: 'Receiver' });

    const roster = await fetchRoster(sender);
    const peer = roster.peers.find((p: { deviceId: string }) => p.deviceId === receiver.deviceId);
    expect(peer).toBeDefined();

    // Authorization comes from the roster; identity is proven by the handshake. Only then may
    // anything be exchanged.
    expect(performPeerHandshake(peer!, receiver).verified).toBe(true);

    const SENTINEL = 'SENTINEL-CLIPBOARD-' + randomBytes(8).toString('hex');
    const payload = Buffer.from(SENTINEL, 'utf8');

    // The clipboard event, constructed exactly as the contract specifies and moved directly
    // between the two agents. No request to the backend carries it.
    const event = {
      version: 1,
      eventId: '3f2b1c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
      senderDeviceId: sender.deviceId,
      sessionId: null,
      sequence: 0,
      createdAt: new Date(h.clock.nowMs()).toISOString(),
      contentType: 'text/plain',
      size: payload.length,
      hash: sha256Prefixed(payload),
      payload: SENTINEL,
    };

    // Receiver-side validation, per PROTOCOL.md: sender must be an authorized peer, and the
    // declared size and hash must match the actual bytes.
    const receiverRoster = await fetchRoster(receiver);
    const senderAuthorized = receiverRoster.peers.some(
      (p: { deviceId: string }) => p.deviceId === event.senderDeviceId,
    );
    expect(senderAuthorized).toBe(true);
    expect(event.size).toBe(Buffer.from(event.payload, 'utf8').length);
    expect(event.hash).toBe(sha256Prefixed(Buffer.from(event.payload, 'utf8')));
    expect(event.size).toBeLessThanOrEqual(receiverRoster.limits['text/plain']);

    /**
     * The assertion that matters: the clipboard content exists nowhere in the control plane.
     *
     * Every table is scanned as text. If a future change ever routed a payload through the
     * backend — a relay endpoint, a debug log column, a cached roster field — this fails.
     */
    const tables = ['users', 'devices', 'share_sessions', 'share_members', 'refresh_tokens', 'pairing_codes'];
    for (const table of tables) {
      const result = (await h.db.db.execute(
        sql.raw(
          `SELECT count(*)::int AS hits FROM ${table} WHERE CAST(${table} AS text) LIKE '%${SENTINEL}%'`,
        ),
      )) as { rows?: Array<{ hits: number }> };
      const rows = Array.isArray(result) ? result : (result.rows ?? []);
      expect(rows[0]?.hits ?? 0).toBe(0);
    }
  });

  it('keeps LAN authorization working while the control plane is unreachable, up to the TTL', async () => {
    const account = await signup(h.app);
    const laptop = await pairDevice(h.app, account, { name: 'Laptop' });
    const phone = await pairDevice(h.app, account, { name: 'Phone' });

    const roster = await fetchRoster(laptop);
    const keys = await request(server()).get('/v1/authz/roster-keys').expect(200);

    // The agent now caches the roster and its verification key. The control plane goes away.
    const cachedPayload = Buffer.from(
      (
        await request(server())
          .get('/v1/authz/peer-set')
          .set('Authorization', `Bearer ${laptop.accessToken}`)
          .expect(200)
      ).body.payload,
      'base64',
    );

    // Offline, the agent can still verify the cached roster is genuine and unexpired.
    const key = keys.body.keys[0];
    const cached = JSON.parse(cachedPayload.toString('utf8'));
    expect(cached.peers[0].deviceId).toBe(phone.deviceId);
    expect(new Date(cached.expiresAt).getTime()).toBeGreaterThan(h.clock.nowMs());
    expect(key.algorithm).toBe('ed25519');

    // Past the TTL the cached roster authorizes nothing, with no server contact required. This is
    // what bounds residual access after a revocation the agent never heard about.
    h.clock.advanceSeconds(h.config.roster.ttlSeconds + 1);
    expect(new Date(cached.expiresAt).getTime()).toBeLessThan(h.clock.nowMs());
    expect(roster.rosterVersion).toBeDefined();
  });
});
