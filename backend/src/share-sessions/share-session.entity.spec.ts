import {
  activeMember,
  effectiveStatus,
  isOwner,
  isSessionActive,
  type ShareSession,
} from './share-session.entity';

const base: ShareSession = {
  id: 'session-internal',
  publicId: 'cp_ses_01h2xcejqtf2nbrexx3vqjhp42',
  ownerUserId: 'owner-internal',
  ownerPublicId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
  joinCodeHash: 'hash',
  status: 'active',
  expiresAt: new Date('2026-01-01T01:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  members: [
    {
      sessionId: 'session-internal',
      userId: 'owner-internal',
      userPublicId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
      email: 'owner@example.test',
      role: 'owner',
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      revokedAt: null,
    },
    {
      sessionId: 'session-internal',
      userId: 'member-internal',
      userPublicId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp43',
      email: 'member@example.test',
      role: 'member',
      joinedAt: new Date('2026-01-01T00:10:00.000Z'),
      revokedAt: null,
    },
  ],
};

const during = new Date('2026-01-01T00:30:00.000Z');
const after = new Date('2026-01-01T02:00:00.000Z');

describe('isSessionActive', () => {
  it('is active only while both the status and the expiry allow it', () => {
    expect(isSessionActive(base, during)).toBe(true);
  });

  it('is inactive once expired, even when the stored status still says active', () => {
    // The classic bug: a session whose status was never swept still reads as 'active'. Checking
    // only the status would keep peers authorized past the end of a sharing session.
    expect(base.status).toBe('active');
    expect(isSessionActive(base, after)).toBe(false);
  });

  it('is inactive when explicitly expired or revoked, even before expiresAt', () => {
    expect(isSessionActive({ ...base, status: 'expired' }, during)).toBe(false);
    expect(isSessionActive({ ...base, status: 'revoked' }, during)).toBe(false);
  });

  it('is inactive exactly at the expiry instant', () => {
    // Boundary: expiry is exclusive, so "expires at 01:00" means not usable at 01:00.
    expect(isSessionActive(base, new Date('2026-01-01T01:00:00.000Z'))).toBe(false);
    expect(isSessionActive(base, new Date('2026-01-01T00:59:59.999Z'))).toBe(true);
  });
});

describe('activeMember', () => {
  it('finds a non-revoked member', () => {
    expect(activeMember(base, 'member-internal')?.role).toBe('member');
  });

  it('does not find a revoked member', () => {
    const revoked: ShareSession = {
      ...base,
      members: base.members.map((m) =>
        m.userId === 'member-internal' ? { ...m, revokedAt: new Date('2026-01-01T00:20:00.000Z') } : m,
      ),
    };
    expect(activeMember(revoked, 'member-internal')).toBeUndefined();
  });

  it('does not find a stranger', () => {
    expect(activeMember(base, 'someone-else')).toBeUndefined();
  });
});

describe('isOwner', () => {
  it('identifies the owner and rejects a member', () => {
    expect(isOwner(base, 'owner-internal')).toBe(true);
    expect(isOwner(base, 'member-internal')).toBe(false);
  });
});

describe('effectiveStatus', () => {
  it('reports expired for an unswept session past its expiry', () => {
    expect(effectiveStatus(base, during)).toBe('active');
    expect(effectiveStatus(base, after)).toBe('expired');
  });

  it('preserves an explicit revocation regardless of time', () => {
    expect(effectiveStatus({ ...base, status: 'revoked' }, during)).toBe('revoked');
    expect(effectiveStatus({ ...base, status: 'revoked' }, after)).toBe('revoked');
  });
});
