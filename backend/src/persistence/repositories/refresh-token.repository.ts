import type { RefreshToken } from '../../auth/refresh-token.entity';
import type { Executor } from '../database.service';

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

export interface CreateRefreshTokenInput {
  userId: string;
  deviceId: string | null;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RefreshTokenRepository {
  create(input: CreateRefreshTokenInput, ex?: Executor): Promise<RefreshToken>;
  findByHash(tokenHash: string, ex?: Executor): Promise<RefreshToken | null>;

  /**
   * Marks a token used, but only if it was not already used.
   *
   * Returns false when another request got there first. Reuse detection depends on this being a
   * conditional UPDATE rather than a read-then-write: two simultaneous refreshes with the same
   * token must produce exactly one winner, and the loser must be treated as a reuse.
   */
  markUsedIfUnused(id: string, now: Date, ex?: Executor): Promise<boolean>;

  /** Revokes an entire rotation lineage. Called on logout and on reuse detection. */
  revokeFamily(familyId: string, now: Date, ex?: Executor): Promise<number>;

  /** Revokes every family bound to a device. Part of the device-revocation transaction. */
  revokeAllForDevice(deviceId: string, now: Date, ex?: Executor): Promise<number>;

  /** Housekeeping: drops expired and long-revoked rows. Retention, not authorization. */
  deleteExpiredBefore(cutoff: Date, ex?: Executor): Promise<number>;
}
