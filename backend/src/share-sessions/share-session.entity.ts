/**
 * Share session domain entity.
 *
 * A session is the authorization boundary for sharing between different users. Network locality
 * is not, ever (`SPEC_CONTRACT.md` §7).
 */

export const SESSION_STATUSES = ['active', 'expired', 'revoked'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const MEMBER_ROLES = ['owner', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface ShareMember {
  sessionId: string;
  userId: string;
  /** Denormalised for display: the UI must show who can receive clipboard data (`RULES.md` §10). */
  userPublicId: string;
  email: string;
  role: MemberRole;
  joinedAt: Date;
  revokedAt: Date | null;
}

export interface ShareSession {
  id: string;
  publicId: string;
  ownerUserId: string;
  ownerPublicId: string;
  joinCodeHash: string;
  status: SessionStatus;
  expiresAt: Date;
  createdAt: Date;
  members: ShareMember[];
}

export interface PublicShareMember {
  userId: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
  revoked: boolean;
  revokedAt: string | null;
}

export interface PublicShareSession {
  id: string;
  ownerUserId: string;
  status: SessionStatus;
  expiresAt: string;
  createdAt: string;
  members: PublicShareMember[];
}

/**
 * The single definition of "this session may currently authorize anything".
 *
 * Both conditions matter and they are different: `status` is an explicit administrative action
 * (the owner ended it, or a member was revoked), while `expiresAt` is the passive guarantee that
 * temporary sharing is actually temporary even if nobody ever presses stop. Checking only one is
 * the classic bug — an expired session whose status was never swept still reads as 'active'.
 */
export function isSessionActive(session: ShareSession, now: Date): boolean {
  return session.status === 'active' && session.expiresAt.getTime() > now.getTime();
}

export function activeMember(session: ShareSession, userId: string): ShareMember | undefined {
  return session.members.find((m) => m.userId === userId && m.revokedAt === null);
}

export const isOwner = (session: ShareSession, userId: string): boolean => session.ownerUserId === userId;

/** Effective status for display: an unswept expiry still reads as expired to a client. */
export function effectiveStatus(session: ShareSession, now: Date): SessionStatus {
  if (session.status !== 'active') return session.status;
  return session.expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
}
