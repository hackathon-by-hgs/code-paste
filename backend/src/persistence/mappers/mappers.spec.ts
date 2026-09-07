import type { Device } from '../../devices/device.entity';
import type { ShareSession } from '../../share-sessions/share-session.entity';
import type { User } from '../../users/user.entity';
import { DeviceMapper } from './device.mapper';
import { ShareSessionMapper } from './share-session.mapper';
import { UserMapper } from './user.mapper';

/**
 * The redaction boundary, tested in isolation.
 *
 * Mappers are pure, so this needs no database — which is the point of having them as a layer.
 * These tests are what stops a field added to a domain entity silently appearing in an API
 * response.
 */

const user: User = {
  id: '11111111-1111-4111-8111-111111111111',
  publicId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
  email: 'synthetic@example.test',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic',
  sessionVersion: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  disabledAt: null,
};

const device: Device = {
  id: '22222222-2222-4222-8222-222222222222',
  publicId: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41',
  userId: user.id,
  name: 'Synthetic Laptop',
  platform: 'macos',
  appVersion: '1.0.0',
  protocolVersion: 1,
  publicKey: 'A'.repeat(43) + '=',
  keyFingerprint: 'sha256:' + '0'.repeat(64),
  capabilities: { contentTypes: ['text/plain'] },
  syncEnabled: true,
  rosterVersion: 7,
  lastSeenAt: new Date('2026-01-01T00:05:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt: null,
};

describe('UserMapper.toPublic', () => {
  it('exposes exactly the public fields', () => {
    expect(UserMapper.toPublic(user)).toEqual({
      id: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
      email: 'synthetic@example.test',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('never exposes the password hash, internal id or session version', () => {
    const keys = Object.keys(UserMapper.toPublic(user));
    expect(keys).not.toContain('passwordHash');
    expect(keys).not.toContain('sessionVersion');
    expect(keys).not.toContain('disabledAt');
    // `id` is present but must be the PUBLIC id, never the internal key.
    expect(UserMapper.toPublic(user).id).not.toBe(user.id);
  });

  it('does not leak a field added to the entity later', () => {
    const withExtra = { ...user, secretNewField: 'must not appear' } as User & { secretNewField: string };
    expect(JSON.stringify(UserMapper.toPublic(withExtra))).not.toContain('must not appear');
  });
});

describe('DeviceMapper.toPublic', () => {
  it('exposes exactly the documented device fields', () => {
    expect(Object.keys(DeviceMapper.toPublic(device)).sort()).toEqual(
      [
        'appVersion',
        'capabilities',
        'createdAt',
        'id',
        'keyFingerprint',
        'lastSeenAt',
        'name',
        'platform',
        'protocolVersion',
        'publicKey',
        'revoked',
        'revokedAt',
        'syncEnabled',
      ].sort(),
    );
  });

  it('never exposes internal keys or roster bookkeeping', () => {
    const publicDevice = DeviceMapper.toPublic(device);
    expect(publicDevice.id).toBe(device.publicId);
    expect(JSON.stringify(publicDevice)).not.toContain(device.id);
    expect(JSON.stringify(publicDevice)).not.toContain(device.userId);
    expect(Object.keys(publicDevice)).not.toContain('rosterVersion');
  });

  it('exposes the public key, which is correct — peers need it to authenticate each other', () => {
    expect(DeviceMapper.toPublic(device).publicKey).toBe(device.publicKey);
  });

  it('renders revocation as a boolean plus a timestamp', () => {
    const revoked = { ...device, revokedAt: new Date('2026-02-01T00:00:00.000Z') };
    const out = DeviceMapper.toPublic(revoked);
    expect(out.revoked).toBe(true);
    expect(out.revokedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(DeviceMapper.toPublic(device).revoked).toBe(false);
  });

  it('round-trips capabilities through jsonb-shaped unknown input', () => {
    const domain = DeviceMapper.toDomain({
      ...device,
      capabilities: { contentTypes: ['text/plain'], maxPayloadBytes: 1024 },
    });
    expect(domain.capabilities).toEqual({ contentTypes: ['text/plain'], maxPayloadBytes: 1024 });
  });

  it('tolerates missing capabilities without throwing', () => {
    expect(DeviceMapper.toDomain({ ...device, capabilities: null }).capabilities).toEqual({
      contentTypes: [],
    });
  });
});

describe('ShareSessionMapper.toPublic', () => {
  const now = new Date('2026-01-01T00:30:00.000Z');
  const session: ShareSession = {
    id: '33333333-3333-4333-8333-333333333333',
    publicId: 'cp_ses_01h2xcejqtf2nbrexx3vqjhp42',
    ownerUserId: user.id,
    ownerPublicId: user.publicId,
    joinCodeHash: 'sha256-of-the-join-code',
    status: 'active',
    expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    members: [
      {
        sessionId: '33333333-3333-4333-8333-333333333333',
        userId: user.id,
        userPublicId: user.publicId,
        email: 'synthetic@example.test',
        role: 'owner',
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        revokedAt: null,
      },
    ],
  };

  it('never exposes the join code hash', () => {
    // Returning it would let any member reissue access to a session they do not own.
    const out = JSON.stringify(ShareSessionMapper.toPublic(session, now));
    expect(out).not.toContain('sha256-of-the-join-code');
    expect(out).not.toContain('joinCodeHash');
  });

  it('replaces internal ids with public ids', () => {
    const out = ShareSessionMapper.toPublic(session, now);
    expect(out.id).toBe(session.publicId);
    expect(out.ownerUserId).toBe(user.publicId);
    expect(out.members[0].userId).toBe(user.publicId);
    expect(JSON.stringify(out)).not.toContain(session.id);
    expect(JSON.stringify(out)).not.toContain(user.id);
  });

  it('exposes member emails so the UI can show who receives clipboard data', () => {
    // Required by RULES.md §10 — an opaque id cannot answer "who can receive my clipboard?".
    expect(ShareSessionMapper.toPublic(session, now).members[0].email).toBe('synthetic@example.test');
  });

  it('reports an unswept expired session as expired, not active', () => {
    const afterExpiry = new Date('2026-01-01T02:00:00.000Z');
    expect(session.status).toBe('active'); // stored status has not been swept
    expect(ShareSessionMapper.toPublic(session, afterExpiry).status).toBe('expired');
  });
});
