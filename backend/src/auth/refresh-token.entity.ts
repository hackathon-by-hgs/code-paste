/**
 * Refresh token domain entity.
 *
 * Only the hash is ever persisted (ADR-004). `familyId` links a rotation lineage: presenting a
 * token that has already been used means two parties hold it, so the whole family dies.
 */
export interface RefreshToken {
  id: string;
  userId: string;
  /** Null for browser sessions; set for device-bound tokens so device revocation can find them. */
  deviceId: string | null;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

export type RefreshTokenState = 'valid' | 'expired' | 'revoked' | 'reused';

/**
 * Classifies a presented token. Order matters: `reused` is checked before `expired` because a
 * replayed token that has also aged out is still evidence of theft, and the family should die
 * either way.
 */
export function classifyRefreshToken(token: RefreshToken, now: Date): RefreshTokenState {
  if (token.usedAt !== null) return 'reused';
  if (token.revokedAt !== null) return 'revoked';
  if (token.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}
