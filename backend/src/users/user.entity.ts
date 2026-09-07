/**
 * User domain entity.
 *
 * `passwordHash` lives on the entity because the auth service needs it, and is stripped by
 * `UserMapper.toPublic`. That asymmetry is the entire reason mappers exist as a separate layer:
 * the domain may hold a secret, the wire may not.
 */
export interface User {
  /** Internal key. Never leaves the process. */
  id: string;
  publicId: string;
  email: string;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
  disabledAt: Date | null;
}

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export const isDisabled = (user: User): boolean => user.disabledAt !== null;

/**
 * Email is normalised once, here, and this function is the only definition of "the same account".
 * The database enforces the matching invariant with a `lower(email)` unique index, so the two
 * cannot drift apart.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
