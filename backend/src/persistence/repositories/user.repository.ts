import type { User } from '../../users/user.entity';
import type { Executor } from '../database.service';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface CreateUserInput {
  publicId: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

/**
 * Port. Services depend on this, never on Drizzle (ADR-007).
 *
 * Every method takes an optional `Executor` so a caller can run it inside an open transaction
 * without this interface knowing that transactions are a database concept.
 */
export interface UserRepository {
  findById(id: string, ex?: Executor): Promise<User | null>;
  findByPublicId(publicId: string, ex?: Executor): Promise<User | null>;
  /** Case-insensitive; the caller passes an already-normalised address. */
  findByEmail(email: string, ex?: Executor): Promise<User | null>;
  create(input: CreateUserInput, ex?: Executor): Promise<User>;
  /**
   * Batch internal-id -> public-id lookup.
   *
   * Used when building rosters, which must expose public ids only. Batched so a roster costs one
   * query rather than one per peer.
   */
  findPublicIdsByIds(ids: string[], ex?: Executor): Promise<Map<string, string>>;
}
