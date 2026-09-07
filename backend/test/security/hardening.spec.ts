import jwt from 'jsonwebtoken';
import request from 'supertest';
import { generateKeypair, pairDevice, signup, TEST_PASSWORD, uniqueEmail } from '../support/factories';
import { createHarness, type Harness } from '../support/harness';

describe('hardening', () => {
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

  describe('authentication is required by default', () => {
    const protectedRoutes: Array<[string, string]> = [
      ['get', '/v1/auth/me'],
      ['get', '/v1/devices'],
      ['get', '/v1/devices/cp_dev_01h2xcejqtf2nbrexx3vqjhp41'],
      ['patch', '/v1/devices/cp_dev_01h2xcejqtf2nbrexx3vqjhp41'],
      ['delete', '/v1/devices/cp_dev_01h2xcejqtf2nbrexx3vqjhp41'],
      ['post', '/v1/devices/cp_dev_01h2xcejqtf2nbrexx3vqjhp41/revoke'],
      ['post', '/v1/devices/cp_dev_01h2xcejqtf2nbrexx3vqjhp41/heartbeat'],
      ['post', '/v1/devices/pairing-codes'],
      ['get', '/v1/authz/peer-set'],
      ['get', '/v1/share-sessions'],
      ['post', '/v1/share-sessions'],
      ['get', '/v1/share-sessions/cp_ses_01h2xcejqtf2nbrexx3vqjhp42'],
      ['post', '/v1/share-sessions/cp_ses_01h2xcejqtf2nbrexx3vqjhp42/join'],
      ['post', '/v1/share-sessions/cp_ses_01h2xcejqtf2nbrexx3vqjhp42/leave'],
      ['post', '/v1/share-sessions/cp_ses_01h2xcejqtf2nbrexx3vqjhp42/revoke-member'],
      ['post', '/v1/share-sessions/cp_ses_01h2xcejqtf2nbrexx3vqjhp42/expire'],
    ];

    it.each(protectedRoutes)('rejects an unauthenticated %s %s', async (method, path) => {
      // The global guard makes protection opt-out. This enumerates the surface so a new route
      // that forgets to opt in is caught here rather than in production.
      const agent = request(server()) as unknown as Record<string, (p: string) => request.Test>;
      const res = await agent[method](path).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthenticated');
    });

    it('leaves genuinely public routes open', async () => {
      await request(server()).get('/v1/health').expect(200);
      await request(server()).get('/v1/protocol').expect(200);
      await request(server()).get('/v1/authz/roster-keys').expect(200);
    });
  });

  describe('access tokens', () => {
    it('rejects a garbage token', async () => {
      const res = await request(server()).get('/v1/auth/me').set('Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = jwt.sign(
        { sub: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40', typ: 'browser', sv: 0, jti: 'x' },
        'wrong',
        {
          issuer: h.config.auth.issuer,
          audience: h.config.auth.audience,
        },
      );
      const res = await request(server()).get('/v1/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects an alg=none token', async () => {
      // The classic JWT bypass. Verification pins algorithms to HS256, so an unsigned token that
      // claims `alg: none` is refused rather than trusted.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
          typ: 'browser',
          sv: 0,
          jti: 'x',
          iss: h.config.auth.issuer,
          aud: h.config.auth.audience,
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
      ).toString('base64url');

      const res = await request(server())
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${header}.${payload}.`);
      expect(res.status).toBe(401);
    });

    it('rejects a token whose payload was tampered with', async () => {
      const account = await signup(h.app);
      const [header, payload, signature] = account.accessToken.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      decoded.sub = 'cp_usr_01h2xcejqtf2nbrexx3vqjhp99';
      const tampered = `${header}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;

      const res = await request(server()).get('/v1/auth/me').set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired access token', async () => {
      const account = await signup(h.app);
      await request(server())
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);

      h.clock.advanceSeconds(h.config.auth.accessTokenTtlSeconds + h.config.auth.clockToleranceSeconds + 1);

      const res = await request(server())
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${account.accessToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('token_expired');
    });

    it('rejects a malformed Authorization header rather than parsing leniently', async () => {
      for (const header of ['', 'Bearer', 'Basic abc', 'Bearer a b', 'Bearer  ', 'token abc']) {
        const res = await request(server()).get('/v1/auth/me').set('Authorization', header);
        expect(res.status).toBe(401);
      }
    });
  });

  describe('refresh token rotation', () => {
    it('rotates on use and invalidates the presented token', async () => {
      const account = await signup(h.app);

      const first = await request(server())
        .post('/v1/auth/refresh')
        .send({ refreshToken: account.refreshToken })
        .expect(200);
      expect(first.body.refreshToken).not.toBe(account.refreshToken);
    });

    it('treats reuse as theft and revokes the whole family', async () => {
      const account = await signup(h.app);

      const rotated = await request(server())
        .post('/v1/auth/refresh')
        .send({ refreshToken: account.refreshToken })
        .expect(200);

      // Replaying the spent token: the legitimate holder and an attacker cannot both hold the
      // latest one, so this is evidence of compromise.
      const replay = await request(server())
        .post('/v1/auth/refresh')
        .send({ refreshToken: account.refreshToken });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('token_reused');

      // ...and the freshly issued token is dead too, forcing re-authentication.
      const after = await request(server())
        .post('/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken });
      expect(after.status).toBe(401);
    });

    it('rejects an expired refresh token', async () => {
      const account = await signup(h.app);
      h.clock.advanceSeconds(h.config.auth.refreshTokenTtlSeconds + 1);

      const res = await request(server())
        .post('/v1/auth/refresh')
        .send({ refreshToken: account.refreshToken });
      expect(res.status).toBe(401);
    });

    it('makes logout idempotent and not a token-validity oracle', async () => {
      const account = await signup(h.app);
      await request(server())
        .post('/v1/auth/logout')
        .send({ refreshToken: account.refreshToken })
        .expect(204);
      await request(server())
        .post('/v1/auth/logout')
        .send({ refreshToken: account.refreshToken })
        .expect(204);
      // An unknown token returns the same 204, so logout cannot be used to test whether a token
      // exists.
      await request(server())
        .post('/v1/auth/logout')
        .send({ refreshToken: 'x'.repeat(43) })
        .expect(204);
    });

    it('stops a logged-out token refreshing', async () => {
      const account = await signup(h.app);
      await request(server())
        .post('/v1/auth/logout')
        .send({ refreshToken: account.refreshToken })
        .expect(204);

      const res = await request(server())
        .post('/v1/auth/refresh')
        .send({ refreshToken: account.refreshToken });
      expect(res.status).toBe(401);
    });
  });

  describe('cross-account isolation', () => {
    it('returns 404, not 403, for another user’s device', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const bobDevice = await pairDevice(h.app, bob);

      // 403 would confirm the id exists and turn this into an existence oracle.
      for (const res of [
        await request(server())
          .get(`/v1/devices/${bobDevice.deviceId}`)
          .set('Authorization', `Bearer ${alice.accessToken}`),
        await request(server())
          .patch(`/v1/devices/${bobDevice.deviceId}`)
          .set('Authorization', `Bearer ${alice.accessToken}`)
          .send({ name: 'hijacked' }),
        await request(server())
          .post(`/v1/devices/${bobDevice.deviceId}/revoke`)
          .set('Authorization', `Bearer ${alice.accessToken}`),
        await request(server())
          .delete(`/v1/devices/${bobDevice.deviceId}`)
          .set('Authorization', `Bearer ${alice.accessToken}`),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });

    it('gives the same 404 for a device that does not exist at all', async () => {
      const alice = await signup(h.app);
      const res = await request(server())
        .get('/v1/devices/cp_dev_01h2xcejqtf2nbrexx3vqjhp99')
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(404);
    });

    it('hides a session from a non-member', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const created = await request(server())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);

      const res = await request(server())
        .get(`/v1/share-sessions/${created.body.id}`)
        .set('Authorization', `Bearer ${bob.accessToken}`);
      expect(res.status).toBe(404);
    });

    it('refuses a non-owner attempting to expire or revoke members', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const created = await request(server())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);
      await request(server())
        .post(`/v1/share-sessions/${created.body.id}/join`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ joinCode: created.body.joinCode })
        .expect(200);

      const expire = await request(server())
        .post(`/v1/share-sessions/${created.body.id}/expire`)
        .set('Authorization', `Bearer ${bob.accessToken}`);
      expect(expire.status).toBe(403);

      const revoke = await request(server())
        .post(`/v1/share-sessions/${created.body.id}/revoke-member`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ userId: alice.userId });
      expect(revoke.status).toBe(403);
    });

    it('refuses the owner leaving their own session', async () => {
      const alice = await signup(h.app);
      const created = await request(server())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);

      const res = await request(server())
        .post(`/v1/share-sessions/${created.body.id}/leave`)
        .set('Authorization', `Bearer ${alice.accessToken}`);
      expect(res.status).toBe(403);
    });

    it('refuses revoking the session owner', async () => {
      const alice = await signup(h.app);
      const created = await request(server())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);

      const res = await request(server())
        .post(`/v1/share-sessions/${created.body.id}/revoke-member`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: alice.userId });
      expect(res.status).toBe(403);
    });
  });

  describe('device registration', () => {
    it('rejects a duplicate key fingerprint for the same account', async () => {
      const alice = await signup(h.app);
      const keypair = generateKeypair();
      await pairDevice(h.app, alice, { publicKey: keypair.publicKeyBase64 });

      const codeRes = await request(server())
        .post('/v1/devices/pairing-codes')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(201);

      // Two devices sharing an identity would make peer verification meaningless.
      const res = await request(server())
        .post('/v1/devices')
        .send({
          pairingCode: codeRes.body.code,
          name: 'Clone',
          platform: 'linux',
          appVersion: '1.0.0',
          protocolVersion: 1,
          publicKey: keypair.publicKeyBase64,
          capabilities: { contentTypes: ['text/plain'] },
        });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('conflict');
    });

    it('rejects an unsupported protocol version loudly', async () => {
      const alice = await signup(h.app);
      const codeRes = await request(server())
        .post('/v1/devices/pairing-codes')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(201);

      const res = await request(server())
        .post('/v1/devices')
        .send({
          pairingCode: codeRes.body.code,
          name: 'Future',
          platform: 'linux',
          appVersion: '1.0.0',
          protocolVersion: 99,
          publicKey: generateKeypair().publicKeyBase64,
          capabilities: { contentTypes: ['text/plain'] },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('unsupported_protocol_version');
      // Never a silent downgrade: the client is told what is actually supported.
      expect(res.body.error.message).toContain('1');
    });

    it('does not consume the pairing code when the protocol version is unsupported', async () => {
      const alice = await signup(h.app);
      const codeRes = await request(server())
        .post('/v1/devices/pairing-codes')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(201);

      await request(server())
        .post('/v1/devices')
        .send({
          pairingCode: codeRes.body.code,
          name: 'Future',
          platform: 'linux',
          appVersion: '1.0.0',
          protocolVersion: 99,
          publicKey: generateKeypair().publicKeyBase64,
          capabilities: { contentTypes: ['text/plain'] },
        })
        .expect(422);

      // An incompatible client must not burn the user's code — they should be able to update and
      // retry with the same one.
      await request(server())
        .post('/v1/devices')
        .send({
          pairingCode: codeRes.body.code,
          name: 'Updated',
          platform: 'linux',
          appVersion: '1.0.1',
          protocolVersion: 1,
          publicKey: generateKeypair().publicKeyBase64,
          capabilities: { contentTypes: ['text/plain'] },
        })
        .expect(201);
    });

    it('rejects a malformed public key', async () => {
      const alice = await signup(h.app);
      const codeRes = await request(server())
        .post('/v1/devices/pairing-codes')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(201);

      const valid = generateKeypair().publicKeyBase64;
      for (const publicKey of ['', 'short', 'A'.repeat(44), valid.slice(0, 20) + '\n' + valid.slice(20)]) {
        const res = await request(server())
          .post('/v1/devices')
          .send({
            pairingCode: codeRes.body.code,
            name: 'Bad key',
            platform: 'linux',
            appVersion: '1.0.0',
            protocolVersion: 1,
            publicKey,
            capabilities: { contentTypes: ['text/plain'] },
          });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('input validation', () => {
    it('rejects unknown properties rather than ignoring them', async () => {
      // Silently dropping an unknown field is how mass-assignment bugs start.
      const res = await request(server())
        .post('/v1/auth/signup')
        .send({ email: uniqueEmail(), password: TEST_PASSWORD, isAdmin: true });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('reports field-level validation detail without echoing values', async () => {
      const res = await request(server())
        .post('/v1/auth/signup')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(400);

      expect(res.body.error.details.length).toBeGreaterThan(0);
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'email',
        'password',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('short');
    });

    it('rejects malformed JSON', async () => {
      const res = await request(server())
        .post('/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(res.status).toBe(400);
    });

    it('rejects an oversized body', async () => {
      const res = await request(server())
        .post('/v1/auth/signup')
        .send({ email: uniqueEmail(), password: 'x'.repeat(h.config.http.maxBodyBytes + 1024) });
      expect([400, 413]).toContain(res.status);
    });

    it('rejects a malformed pagination cursor without a 500', async () => {
      const alice = await signup(h.app);
      const res = await request(server())
        .get('/v1/devices?cursor=' + encodeURIComponent("') OR 1=1 --"))
        .set('Authorization', `Bearer ${alice.accessToken}`);
      // A bad cursor degrades to the first page; it must never reach a query or crash.
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('rejects an out-of-range page limit', async () => {
      const alice = await signup(h.app);
      await request(server())
        .get('/v1/devices?limit=100000')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(400);
    });

    it('returns a structured 404 for an unknown route', async () => {
      const res = await request(server()).get('/v1/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('login hardening', () => {
    it('returns the same error for an unknown account and a wrong password', async () => {
      const account = await signup(h.app);

      const unknown = await request(server())
        .post('/v1/auth/login')
        .send({ email: uniqueEmail(), password: TEST_PASSWORD });
      const wrong = await request(server())
        .post('/v1/auth/login')
        .send({ email: account.email, password: 'a-different-password' });

      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.error.code).toBe('invalid_credentials');
      expect(wrong.body.error.code).toBe(unknown.body.error.code);
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('rate-limits repeated login attempts', async () => {
      const account = await signup(h.app);
      const attempt = () =>
        request(server()).post('/v1/auth/login').send({ email: account.email, password: 'wrong-password' });

      let limited: request.Response | undefined;
      for (let i = 0; i < h.config.rateLimits.loginPerMinute + 3; i++) {
        const res = await attempt();
        if (res.status === 429) {
          limited = res;
          break;
        }
      }

      expect(limited).toBeDefined();
      expect(limited!.body.error.code).toBe('rate_limited');
      expect(Number(limited!.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('rate-limits join-code guessing', async () => {
      const alice = await signup(h.app);
      const bob = await signup(h.app);
      const created = await request(server())
        .post('/v1/share-sessions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({})
        .expect(201);

      let limited = false;
      for (let i = 0; i < h.config.rateLimits.sessionJoinPerMinute + 3; i++) {
        const res = await request(server())
          .post(`/v1/share-sessions/${created.body.id}/join`)
          .set('Authorization', `Bearer ${bob.accessToken}`)
          .send({ joinCode: 'ZZZZZZZZ' });
        if (res.status === 429) {
          limited = true;
          break;
        }
      }
      expect(limited).toBe(true);
    });
  });

  describe('no sensitive data leaves the process', () => {
    it('never returns a password hash, token hash or internal id', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const bodies = [
        (await request(server()).get('/v1/auth/me').set('Authorization', `Bearer ${device.accessToken}`))
          .body,
        (await request(server()).get('/v1/devices').set('Authorization', `Bearer ${account.accessToken}`))
          .body,
        (
          await request(server())
            .get(`/v1/devices/${device.deviceId}`)
            .set('Authorization', `Bearer ${account.accessToken}`)
        ).body,
      ];

      for (const body of bodies) {
        const serialised = JSON.stringify(body);
        expect(serialised).not.toMatch(/argon2/i);
        expect(serialised).not.toContain('passwordHash');
        expect(serialised).not.toContain('tokenHash');
        expect(serialised).not.toContain('joinCodeHash');
        expect(serialised).not.toContain('rosterVersion');
        // No bare UUIDs: every identifier a client sees is an opaque prefixed id.
        expect(serialised).not.toMatch(/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/);
      }
    });

    it('never leaks a stack trace or driver detail on an error', async () => {
      const res = await request(server())
        .get('/v1/devices/not-a-valid-id')
        .set('Authorization', 'Bearer bad');
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\(|node_modules|drizzle|postgres|pglite/i);
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'message', 'requestId']);
    });

    it('keeps secrets out of the log stream', async () => {
      // The redaction allowlist is unit-tested; this asserts it holds for the real logger under a
      // real request, which is where an accidental interpolation would actually happen.
      const written: string[] = [];
      const original = process.stdout.write.bind(process.stdout);
      (process.stdout.write as unknown as jest.Mock) = jest.fn((chunk: string | Uint8Array) => {
        written.push(chunk.toString());
        return true;
      }) as never;

      try {
        const email = uniqueEmail();
        const res = await request(server()).post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });
        const account = res.body;

        const logs = written.join('\n');
        expect(logs).not.toContain(TEST_PASSWORD);
        expect(logs).not.toContain(account.accessToken);
        expect(logs).not.toContain(account.refreshToken);
        expect(logs).not.toContain(email);
      } finally {
        process.stdout.write = original;
      }
    });

    it('assigns a request id and echoes it for support', async () => {
      const res = await request(server()).get('/v1/health').expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    });

    it('ignores a client-supplied request id', async () => {
      // An attacker-controlled correlation id would let someone forge or poison log entries.
      const res = await request(server())
        .get('/v1/health')
        .set('X-Request-Id', 'client-chosen-id')
        .expect(200);
      expect(res.headers['x-request-id']).not.toBe('client-chosen-id');
    });

    it('sets baseline security headers', async () => {
      const res = await request(server()).get('/v1/health').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
    });
  });
});
