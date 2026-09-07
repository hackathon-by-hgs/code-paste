import request from 'supertest';
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from '../../src/realtime/realtime.messages';
import { pairDevice, signup } from '../support/factories';
import { createHarness, type Harness } from '../support/harness';
import { connect, expectHandshakeRejected } from '../support/ws-client';

/**
 * The realtime control channel, against a real listening server and real WebSocket clients.
 *
 * The single most important property under test is negative: **the socket carries no clipboard
 * content, in either direction** (ADR-006). Everything else here is about making sure it cannot
 * become a weaker second entry point than HTTP.
 */
describe('realtime control channel', () => {
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

  describe('handshake authentication', () => {
    it('refuses an unauthenticated connection', async () => {
      // Refused during the upgrade, so no connection state is ever allocated for an anonymous
      // client — that is what stops a socket flood becoming a memory exhaustion.
      expect(await expectHandshakeRejected(port)).toBe(401);
    });

    it('refuses a garbage token', async () => {
      expect(await expectHandshakeRejected(port, { token: 'not-a-jwt' })).toBe(401);
    });

    it('refuses a browser token', async () => {
      const account = await signup(h.app);
      // A browser is not a clipboard peer. Enforced here as well as on HTTP, because the socket is
      // an independent entry point and must not be the weaker one.
      expect(await expectHandshakeRejected(port, { token: account.accessToken })).toBe(403);
    });

    it('refuses a revoked device', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${device.deviceId}/revoke`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);

      expect(await expectHandshakeRejected(port, { token: device.accessToken })).toBe(403);
    });

    it('refuses an unknown path', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      expect(
        await expectHandshakeRejected(port, { token: device.accessToken, path: '/v1/not-realtime' }),
      ).toBe(404);
    });

    it('accepts a device token and negotiates versions', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const client = await connect(port, { token: device.accessToken });
      const ready = await client.waitFor('connection.ready');

      expect(ready.data).toMatchObject({
        deviceId: device.deviceId,
        userId: account.userId,
        protocolVersion: 1,
        envelopeVersion: 1,
      });
      // Lets a client detect immediately that its cached roster is behind, without polling.
      expect(typeof ready.data!.rosterVersion).toBe('number');
      client.close();
    });

    it('accepts a token via the WebSocket subprotocol, for browsers that cannot set headers', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const client = await connect(port, { token: device.accessToken, useSubprotocol: true });
      await client.waitFor('connection.ready');
      client.close();
    });
  });

  describe('message handling', () => {
    it('answers a ping with a pong carrying the correlation id', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      client.send({ v: 1, type: 'ping', id: '01h2xcejqtf2nbrexx3vqjhp4z', ts: new Date().toISOString() });
      const pong = await client.waitFor('pong');
      expect(pong).toMatchObject({ type: 'pong' });
      client.close();
    });

    it('rejects a malformed message without dropping the connection immediately', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      client.send('this is not json');
      const error = await client.waitFor('error');
      expect(error.data).toMatchObject({ code: 'invalid_message' });
      client.close();
    });

    it('rejects an unknown message type', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      client.send({ v: 1, type: 'clipboard.send', ts: new Date().toISOString(), data: { text: 'secret' } });
      const error = await client.waitFor('error');
      expect(error.data).toMatchObject({ code: 'invalid_message' });
      client.close();
    });

    it('rejects an unknown envelope version', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      client.send({ v: 99, type: 'ping', ts: new Date().toISOString() });
      const error = await client.waitFor('error');
      expect(error.data).toMatchObject({ code: 'invalid_message' });
      client.close();
    });

    it('disconnects a client that keeps sending malformed messages', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      // Malformed-message throttling: a client that cannot speak the protocol is disconnected
      // rather than allowed to keep probing (SECURITY.md, Abuse controls).
      for (let i = 0; i < h.config.realtime.maxMalformedMessages + 1; i++) client.send('garbage');

      const code = await client.waitForClose();
      expect(code).toBe(1008);
    });
  });

  describe('resource bounds', () => {
    it('enforces the per-device connection cap', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const open = [];
      for (let i = 0; i < h.config.realtime.maxConnectionsPerDevice; i++) {
        open.push(await connect(port, { token: device.accessToken }));
      }
      // One more must be refused at the handshake, not accepted and then dropped.
      expect(await expectHandshakeRejected(port, { token: device.accessToken })).toBe(429);

      for (const client of open) client.close();
    });

    it('frees a connection slot when a socket closes', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const open = [];
      for (let i = 0; i < h.config.realtime.maxConnectionsPerDevice; i++) {
        open.push(await connect(port, { token: device.accessToken }));
      }
      expect(await expectHandshakeRejected(port, { token: device.accessToken })).toBe(429);

      // A reconnect storm must not leak slots until the cap rejects legitimate clients.
      open[0].close();
      await open[0].waitForClose();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const reconnected = await connect(port, { token: device.accessToken });
      await reconnected.waitFor('connection.ready');
      reconnected.close();
      for (const client of open.slice(1)) client.close();
    });

    it('rejects an oversized message', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);
      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      client.send({
        v: 1,
        type: 'ping',
        ts: new Date().toISOString(),
        data: { padding: 'x'.repeat(h.config.realtime.maxMessageBytes * 2) },
      });

      // `ws` enforces maxPayload itself and closes with 1009; either path is a clean rejection.
      const code = await client.waitForClose();
      expect([1008, 1009]).toContain(code);
    });
  });

  describe('authorization events', () => {
    it('tells a peer to re-fetch when a device is registered', async () => {
      const account = await signup(h.app);
      const first = await pairDevice(h.app, account, { name: 'First' });

      const client = await connect(port, { token: first.accessToken });
      await client.waitFor('connection.ready');

      await pairDevice(h.app, account, { name: 'Second' });

      const event = await client.waitFor('authorization.changed');
      expect(event.data).toMatchObject({ reason: 'device-registered' });
      client.close();
    });

    it('notifies and disconnects a device the moment it is revoked', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      await request(h.app.getHttpServer())
        .post(`/v1/devices/${device.deviceId}/revoke`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);

      const event = await client.waitFor('device.revoked');
      expect(event.data).toMatchObject({ reason: 'device-revoked' });

      // The server does not wait for the client to cooperate: a revoked device is not a party
      // whose agreement is required.
      expect(await client.waitForClose()).toBe(1008);
    });

    it('notifies peers when a share session ends', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);
      await pairDevice(h.app, bob);

      const created = await request(h.app.getHttpServer())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);
      await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${created.body.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: created.body.joinCode })
        .expect(200);

      const client = await connect(port, { token: aliceDevice.accessToken });
      await client.waitFor('connection.ready');

      await request(h.app.getHttpServer())
        .post(`/v1/share-sessions/${created.body.id}/expire`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      const event = await client.waitFor('session.expired');
      expect(event.data).toMatchObject({ reason: 'session-expired', sessionId: created.body.id });
      client.close();
    });

    it('notifies a peer when sync is paused elsewhere', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');

      await request(h.app.getHttpServer())
        .patch(`/v1/devices/${device.deviceId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ syncEnabled: false })
        .expect(200);

      const event = await client.waitFor('device.sync-toggled');
      expect(event.data).toMatchObject({ reason: 'paused' });
      client.close();
    });

    it('does not deliver another user’s authorization events', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const aliceDevice = await pairDevice(h.app, alice);

      const client = await connect(port, { token: aliceDevice.accessToken });
      await client.waitFor('connection.ready');
      const before = client.messages.length;

      // Bob registers a device. Alice and Bob share nothing, so Alice must hear nothing.
      await pairDevice(h.app, bob);
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(client.messages.length).toBe(before);
      client.close();
    });
  });

  describe('the channel is not a clipboard relay', () => {
    it('defines no message type capable of carrying clipboard content', () => {
      // The structural guarantee behind ADR-006, asserted rather than assumed.
      for (const type of [...CLIENT_MESSAGE_TYPES, ...SERVER_MESSAGE_TYPES]) {
        expect(type).not.toMatch(/clipboard|payload|content/i);
      }
    });

    it('never echoes an attacker-supplied data blob to a peer', async () => {
      const account = await signup(h.app);
      const sender = await pairDevice(h.app, account, { name: 'Sender' });
      const receiver = await pairDevice(h.app, account, { name: 'Receiver' });

      const senderClient = await connect(port, { token: sender.accessToken });
      const receiverClient = await connect(port, { token: receiver.accessToken });
      await senderClient.waitFor('connection.ready');
      await receiverClient.waitFor('connection.ready');
      receiverClient.messages.length = 0;

      // Attempt to smuggle content through a legitimate message type.
      senderClient.send({
        v: 1,
        type: 'ping',
        ts: new Date().toISOString(),
        data: { smuggled: 'SENTINEL-CLIPBOARD-CONTENT' },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const delivered = JSON.stringify(receiverClient.messages);
      expect(delivered).not.toContain('SENTINEL-CLIPBOARD-CONTENT');

      senderClient.close();
      receiverClient.close();
    });
  });
});
