import request from 'supertest';
import { createHarness, type Harness } from '../support/harness';
import { pairDevice, signup } from '../support/factories';
import { connect, expectHandshakeRejected } from '../support/ws-client';

const ALLOWED = 'https://code-paste-1.onrender.com';
const LOCAL = 'http://localhost:5173';
const HOSTILE = 'https://code-paste-1.onrender.com.attacker.example';

/**
 * CORS and WebSocket origin policy.
 *
 * The failure mode worth guarding against is not "CORS is missing" — it is a CORS configuration
 * that looks present and permits everything. Reflecting an arbitrary `Origin`, or falling back to
 * `*`, is indistinguishable from having no policy at all.
 */
describe('cross-origin policy', () => {
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

  describe('allowlist', () => {
    it('allows the deployed web app', async () => {
      const res = await request(server()).get('/v1/health').set('Origin', ALLOWED).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    });

    it('allows local development origins', async () => {
      const res = await request(server()).get('/v1/health').set('Origin', LOCAL).expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(LOCAL);
    });

    it('refuses an unknown origin', async () => {
      const res = await request(server()).get('/v1/health').set('Origin', 'https://evil.example');
      // The request still executes — CORS is enforced by the browser — but without the header the
      // browser refuses to hand the response to the page.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('is not fooled by an origin that merely starts with an allowed one', async () => {
      // The classic prefix/suffix bug: `startsWith` or a sloppy regex would accept this.
      const res = await request(server()).get('/v1/health').set('Origin', HOSTILE);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('distinguishes scheme and port', async () => {
      for (const origin of ['http://code-paste-1.onrender.com', 'https://code-paste-1.onrender.com:8443']) {
        const res = await request(server()).get('/v1/health').set('Origin', origin);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    });

    it('never answers with a wildcard', async () => {
      for (const origin of [ALLOWED, LOCAL, 'https://evil.example']) {
        const res = await request(server()).get('/v1/health').set('Origin', origin);
        expect(res.headers['access-control-allow-origin']).not.toBe('*');
      }
    });

    it('never enables credentials', async () => {
      // Authentication is a Bearer token, not a cookie. With no ambient credentials there is
      // nothing for a cross-site request to ride on, which is what makes this API CSRF-immune.
      const res = await request(server()).get('/v1/health').set('Origin', ALLOWED).expect(200);
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('preflight', () => {
    it('answers a preflight for an allowed origin', async () => {
      const res = await request(server())
        .options('/v1/auth/login')
        .set('Origin', ALLOWED)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

      expect(res.status).toBeLessThan(300);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      // Without Authorization the web app cannot authenticate a single request.
      expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
      expect(res.headers['access-control-max-age']).toBe('600');
    });

    it('does not authorise a preflight from an unknown origin', async () => {
      const res = await request(server())
        .options('/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('exposed headers', () => {
    it('exposes the headers clients are told to read', async () => {
      const res = await request(server()).get('/v1/health').set('Origin', ALLOWED).expect(200);
      const exposed = (res.headers['access-control-expose-headers'] ?? '').toLowerCase();

      // A cross-origin page cannot read a header unless it is exposed. CLIENT_RESPONSES.md tells
      // clients to surface requestId and to honour Retry-After, so both must be readable.
      expect(exposed).toContain('x-request-id');
      expect(exposed).toContain('retry-after');
    });
  });

  describe('websocket origin', () => {
    it('accepts a handshake with no Origin — a native agent', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const client = await connect(port, { token: device.accessToken });
      await client.waitFor('connection.ready');
      client.close();
    });

    it('accepts a browser handshake from an allowed origin', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const client = await connect(port, { token: device.accessToken, origin: ALLOWED });
      await client.waitFor('connection.ready');
      client.close();
    });

    it('refuses a browser handshake from an unknown origin', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      // The WebSocket handshake is exempt from CORS in the browser, so this is the only thing
      // stopping any page from opening a socket.
      expect(
        await expectHandshakeRejected(port, { token: device.accessToken, origin: 'https://evil.example' }),
      ).toBe(403);
    });

    it('rejects the origin before it ever looks at the token', async () => {
      // Ordering matters: an unknown origin should not get a token-validity oracle.
      expect(
        await expectHandshakeRejected(port, { token: 'not-a-jwt', origin: 'https://evil.example' }),
      ).toBe(403);
    });
  });
});
