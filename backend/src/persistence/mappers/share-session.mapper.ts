import {
  effectiveStatus,
  type MemberRole,
  type PublicShareMember,
  type PublicShareSession,
  type SessionStatus,
  type ShareMember,
  type ShareSession,
} from '../../share-sessions/share-session.entity';

interface SessionRowLike {
  id: string;
  publicId: string;
  ownerUserId: string;
  joinCodeHash: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

interface MemberRowLike {
  sessionId: string;
  userId: string;
  userPublicId: string;
  email: string;
  role: string;
  joinedAt: Date;
  revokedAt: Date | null;
}

export const ShareSessionMapper = {
  toDomain(row: SessionRowLike, memberRows: MemberRowLike[], ownerPublicId: string): ShareSession {
    return {
      id: row.id,
      publicId: row.publicId,
      ownerUserId: row.ownerUserId,
      ownerPublicId,
      joinCodeHash: row.joinCodeHash,
      status: row.status as SessionStatus,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      members: memberRows.map((m): ShareMember => ({
        sessionId: m.sessionId,
        userId: m.userId,
        userPublicId: m.userPublicId,
        email: m.email,
        role: m.role as MemberRole,
        joinedAt: m.joinedAt,
        revokedAt: m.revokedAt,
      })),
    };
  },

  /**
   * The redaction boundary.
   *
   * `joinCodeHash` stops here — returning it would let any member reissue access to a session they
   * do not own. Internal user keys are replaced by public ids. `status` is the *effective* status,
   * so a session that expired without being swept never reads as `active` to a client.
   *
   * `email` is intentionally exposed for members: `RULES.md` §10 requires the UI to show exactly
   * who can receive the user's clipboard data, and an opaque id cannot answer that question. It is
   * scoped to fellow members of a session the caller already belongs to.
   */
  toPublic(session: ShareSession, now: Date): PublicShareSession {
    return {
      id: session.publicId,
      ownerUserId: session.ownerPublicId,
      status: effectiveStatus(session, now),
      expiresAt: session.expiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      members: session.members.map((m): PublicShareMember => ({
        userId: m.userPublicId,
        email: m.email,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
        revoked: m.revokedAt !== null,
        revokedAt: m.revokedAt ? m.revokedAt.toISOString() : null,
      })),
    };
  },
};
