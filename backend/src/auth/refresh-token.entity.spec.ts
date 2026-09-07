import { classifyRefreshToken, type RefreshToken } from './refresh-token.entity';

const now = new Date('2026-01-01T00:00:00.000Z');

const token: RefreshToken = {
  id: 'token-id',
  userId: 'user-id',
  deviceId: null,
  tokenHash: 'hash',
  familyId: 'family-id',
  expiresAt: new Date('2026-02-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  usedAt: null,
  revokedAt: null,
};

describe('classifyRefreshToken', () => {
  it('accepts a fresh, unused token', () => {
    expect(classifyRefreshToken(token, now)).toBe('valid');
  });

  it('reports reuse for an already-consumed token', () => {
    expect(classifyRefreshToken({ ...token, usedAt: now }, now)).toBe('reused');
  });

  it('prioritises reuse over expiry', () => {
    // A replayed token that has also aged out is still evidence of theft, and the family should
    // die either way. Reporting 'expired' here would quietly downgrade a compromise signal.
    const replayedAndExpired = {
      ...token,
      usedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2025-12-01T00:00:00.000Z'),
    };
    expect(classifyRefreshToken(replayedAndExpired, now)).toBe('reused');
  });

  it('prioritises reuse over explicit revocation', () => {
    const replayedAndRevoked = { ...token, usedAt: now, revokedAt: now };
    expect(classifyRefreshToken(replayedAndRevoked, now)).toBe('reused');
  });

  it('reports revoked and expired states', () => {
    expect(classifyRefreshToken({ ...token, revokedAt: now }, now)).toBe('revoked');
    expect(classifyRefreshToken({ ...token, expiresAt: new Date('2025-12-01T00:00:00.000Z') }, now)).toBe(
      'expired',
    );
  });

  it('treats the exact expiry instant as expired', () => {
    expect(classifyRefreshToken({ ...token, expiresAt: now }, now)).toBe('expired');
  });
});
