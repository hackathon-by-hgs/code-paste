import type { MemberRole, SessionStatus, ShareSession } from '../../share-sessions/share-session.entity';
import type { Executor } from '../database.service';
import type { Page } from './device.repository';

export const SHARE_SESSION_REPOSITORY = Symbol('SHARE_SESSION_REPOSITORY');

export interface CreateShareSessionInput {
  publicId: string;
  ownerUserId: string;
  joinCodeHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ListSessionsOptions {
  limit: number;
  cursor?: string;
  status?: SessionStatus;
}

export interface ShareSessionRepository {
  findById(id: string, ex?: Executor): Promise<ShareSession | null>;
  findByPublicId(publicId: string, ex?: Executor): Promise<ShareSession | null>;
  /** Sessions the user owns or belongs to. */
  listForUser(userId: string, options: ListSessionsOptions, ex?: Executor): Promise<Page<ShareSession>>;

  create(input: CreateShareSessionInput, ex?: Executor): Promise<ShareSession>;
  setStatus(id: string, status: SessionStatus, ex?: Executor): Promise<ShareSession>;

  addMember(sessionId: string, userId: string, role: MemberRole, now: Date, ex?: Executor): Promise<void>;
  revokeMember(sessionId: string, userId: string, now: Date, ex?: Executor): Promise<void>;
  removeMember(sessionId: string, userId: string, ex?: Executor): Promise<void>;

  /**
   * Every other user reachable from `userId` through a session that is active *right now*.
   *
   * Both the expiry and the status filter are applied in SQL. Loading expired sessions and
   * filtering them in the service would work until someone forgot — and the failure mode is a
   * peer staying authorized past the end of a sharing session.
   */
  findCoMemberUserIds(
    userId: string,
    now: Date,
    ex?: Executor,
  ): Promise<Array<{ userId: string; sessionPublicId: string }>>;

  /** Users affected by a change to this session — used to decide whose rosters to bump. */
  listMemberUserIds(sessionId: string, ex?: Executor): Promise<string[]>;
}
