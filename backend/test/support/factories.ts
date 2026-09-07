import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { generateEd25519Seed, publicKeyFromPrivateRaw } from '../../src/common/crypto';

/**
 * Test fixtures.
 *
 * Everything is synthetic and generated per test — no real passwords, keys or personal data
 * (`TEST_STRATEGY.md`, Test data rule). Keys are genuine Ed25519 keypairs, because the point is to
 * exercise the real validation path rather than a placeholder string that happens to be 44 bytes.
 */

let counter = 0;
export const uniqueEmail = (): string => `synthetic-user-${++counter}-${Date.now()}@example.test`;

export const TEST_PASSWORD = 'synthetic-test-password-1';

export interface TestKeypair {
  privateKeyRaw: Buffer;
  publicKeyRaw: Buffer;
  publicKeyBase64: string;
}

export function generateKeypair(): TestKeypair {
  const privateKeyRaw = generateEd25519Seed();
  const publicKeyRaw = publicKeyFromPrivateRaw(privateKeyRaw);
  return { privateKeyRaw, publicKeyRaw, publicKeyBase64: publicKeyRaw.toString('base64') };
}

export interface TestAccount {
  email: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export async function signup(app: NestExpressApplication, email = uniqueEmail()): Promise<TestAccount> {
  const res = await request(app.getHttpServer())
    .post('/v1/auth/signup')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);
  return {
    email,
    userId: res.body.user.id,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

export interface TestDevice {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  keypair: TestKeypair;
}

/**
 * Runs the full pairing flow: mint a code from a browser session, then register with a real
 * keypair. Tests therefore exercise the same path a real agent takes (ADR-005).
 */
export async function pairDevice(
  app: NestExpressApplication,
  account: TestAccount,
  overrides: Partial<{ name: string; platform: string; protocolVersion: number; publicKey: string }> = {},
): Promise<TestDevice> {
  const codeRes = await request(app.getHttpServer())
    .post('/v1/devices/pairing-codes')
    .set('Authorization', `Bearer ${account.accessToken}`)
    .expect(201);

  const keypair = generateKeypair();
  const res = await request(app.getHttpServer())
    .post('/v1/devices')
    .send({
      pairingCode: codeRes.body.code,
      name: overrides.name ?? 'Synthetic Device',
      platform: overrides.platform ?? 'linux',
      appVersion: '1.0.0',
      protocolVersion: overrides.protocolVersion ?? 1,
      publicKey: overrides.publicKey ?? keypair.publicKeyBase64,
      capabilities: { contentTypes: ['text/plain', 'image/png'] },
    })
    .expect(201);

  return {
    deviceId: res.body.device.id,
    accessToken: res.body.credentials.accessToken,
    refreshToken: res.body.credentials.refreshToken,
    keypair,
  };
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
