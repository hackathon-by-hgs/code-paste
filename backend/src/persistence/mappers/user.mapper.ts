import type { PublicUser, User } from '../../users/user.entity';

interface UserRowLike {
  id: string;
  publicId: string;
  email: string;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
  disabledAt: Date | null;
}

export const UserMapper = {
  toDomain(row: UserRowLike): User {
    return {
      id: row.id,
      publicId: row.publicId,
      email: row.email,
      passwordHash: row.passwordHash,
      sessionVersion: row.sessionVersion,
      createdAt: row.createdAt,
      disabledAt: row.disabledAt,
    };
  },

  /**
   * The redaction boundary. `passwordHash`, the internal `id`, `sessionVersion` and `disabledAt`
   * all stop here — built field by field so a future addition to `User` cannot leak by default.
   */
  toPublic(user: User): PublicUser {
    return {
      id: user.publicId,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  },
};
