import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { generateHumanCode, sha256Hex, timingSafeEqualString } from '../common/crypto';
import { forbidden, notFound, sessionExpired } from '../common/errors';
import {
  AUTHORIZATION_EVENT_PUBLISHER,
  type AuthorizationChangeReason,
  type AuthorizationEventPublisher,
} from '../common/events';
import { newSessionId } from '../common/ids';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { isRevoked, type Device } from '../devices/device.entity';
import { LoggerService } from '../observability/logger.service';
import { DatabaseService, type Executor } from '../persistence/database.service';
import {
  DEVICE_REPOSITORY,
  type DeviceRepository,
  type Page,
} from '../persistence/repositories/device.repository';
import {
  SHARE_SESSION_REPOSITORY,
  type ListSessionsOptions,
  type ShareSessionRepository,
} from '../persistence/repositories/share-session.repository';
import { USER_REPOSITORY, type UserRepository } from '../persistence/repositories/user.repository';
import type { User } from '../users/user.entity';
import { activeMember, isOwner, isSessionActive, type ShareSession } from './share-session.entity';

export interface CreatedShareSession {
  session: ShareSession;
  joinCode: string;
}

@Injectable()
export class ShareSessionsService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SHARE_SESSION_REPOSITORY) private readonly sessions: ShareSessionRepository,
    @Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUTHORIZATION_EVENT_PUBLISHER) private readonly events: AuthorizationEventPublisher,
    private readonly database: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  async create(user: User, expiresInSeconds?: number): Promise<CreatedShareSession> {
    const now = this.clock.now();
    // Clamped server-side. A client asking for a year gets the maximum, not a year.
    const ttl = Math.min(
      expiresInSeconds ?? this.config.shareSessions.defaultTtlSeconds,
      this.config.shareSessions.maxTtlSeconds,
    );
    const joinCode = generateHumanCode();

    const session = await this.database.runInTransaction(async (tx) => {
      const created = await this.sessions.create(
        {
          publicId: newSessionId(now.getTime()),
          ownerUserId: user.id,
          // Only the hash is stored; the plaintext is returned once and is never retrievable.
          joinCodeHash: sha256Hex(joinCode),
          expiresAt: new Date(now.getTime() + ttl * 1000),
          createdAt: now,
        },
        tx,
      );
      await this.sessions.addMember(created.id, user.id, 'owner', now, tx);
      return (await this.sessions.findById(created.id, tx))!;
    });

    this.logger.info('share session created', { userId: user.publicId, sessionId: session.publicId });
    return { session, joinCode };
  }

  list(user: User, options: ListSessionsOptions): Promise<Page<ShareSession>> {
    return this.sessions.listForUser(user.id, options);
  }

  /**
   * Loads a session the caller belongs to.
   *
   * A non-member — including a revoked one — gets `not_found` rather than `forbidden`, so session
   * ids cannot be probed for existence.
   */
  async getForMember(user: User, publicId: string, ex?: Executor): Promise<ShareSession> {
    const session = await this.sessions.findByPublicId(publicId, ex);
    if (!session) throw notFound('Session not found.');
    if (!activeMember(session, user.id)) throw notFound('Session not found.');
    return session;
  }

  async join(user: User, publicId: string, joinCode: string): Promise<ShareSession> {
    const now = this.clock.now();

    const session = await this.database.runInTransaction(async (tx) => {
      const found = await this.sessions.findByPublicId(publicId, tx);
      if (!found) throw notFound('Session not found.');
      // Expiry and status are both checked. An expired session must not admit anyone even if a
      // sweep has not yet moved its status.
      if (!isSessionActive(found, now)) throw sessionExpired();

      // Constant-time comparison: a byte-by-byte early exit would leak the code one character at
      // a time to an attacker who can measure response timing.
      if (!timingSafeEqualString(sha256Hex(joinCode), found.joinCodeHash)) {
        this.logger.warn('share session join rejected', {
          sessionId: found.publicId,
          reason: 'bad-join-code',
        });
        throw forbidden('Invalid join code.');
      }

      const existing = found.members.find((m) => m.userId === user.id);
      // A revoked member cannot rejoin by replaying the code. Revocation is a decision by the
      // owner, and the join code must not be a way around it.
      if (existing?.revokedAt) throw forbidden('Your membership in this session was revoked.');

      if (!existing) await this.sessions.addMember(found.id, user.id, 'member', now, tx);

      await this.bumpSessionRosters(found.id, tx, 'session-joined', found.publicId);
      return (await this.sessions.findById(found.id, tx))!;
    });

    this.logger.info('share session joined', { userId: user.publicId, sessionId: session.publicId });
    return session;
  }

  async leave(user: User, publicId: string): Promise<void> {
    const session = await this.getForMember(user, publicId);
    // The owner cannot leave: a session without an owner has nobody who can end it.
    if (isOwner(session, user.id)) throw forbidden('The owner cannot leave; expire the session instead.');

    await this.database.runInTransaction(async (tx) => {
      await this.sessions.removeMember(session.id, user.id, tx);
      await this.bumpSessionRosters(session.id, tx, 'session-left', session.publicId, [user.id]);
    });
    this.logger.info('share session left', { userId: user.publicId, sessionId: session.publicId });
  }

  async revokeMember(user: User, publicId: string, memberPublicUserId: string): Promise<ShareSession> {
    const now = this.clock.now();

    const session = await this.database.runInTransaction(async (tx) => {
      const found = await this.sessions.findByPublicId(publicId, tx);
      if (!found) throw notFound('Session not found.');
      if (!isOwner(found, user.id)) throw forbidden('Only the session owner can revoke members.');

      const member = await this.users.findByPublicId(memberPublicUserId, tx);
      if (!member) throw notFound('Member not found.');
      // Revoking the owner would leave the session unmanageable.
      if (member.id === found.ownerUserId) throw forbidden('The session owner cannot be revoked.');
      if (!found.members.some((m) => m.userId === member.id)) throw notFound('Member not found.');

      await this.sessions.revokeMember(found.id, member.id, now, tx);
      await this.bumpSessionRosters(found.id, tx, 'session-member-revoked', found.publicId);
      return (await this.sessions.findById(found.id, tx))!;
    });

    this.logger.info('share session member revoked', { sessionId: session.publicId });
    return session;
  }

  /** Ends a session immediately. Idempotent — the stop button must never fail because it was
   * pressed twice. */
  async expire(user: User, publicId: string): Promise<ShareSession> {
    const session = await this.database.runInTransaction(async (tx) => {
      const found = await this.sessions.findByPublicId(publicId, tx);
      if (!found) throw notFound('Session not found.');
      if (!isOwner(found, user.id)) throw forbidden('Only the session owner can expire the session.');
      if (found.status !== 'active') return found;

      const updated = await this.sessions.setStatus(found.id, 'expired', tx);
      await this.bumpSessionRosters(found.id, tx, 'session-expired', found.publicId);
      return updated;
    });

    this.logger.info('share session expired', { userId: user.publicId, sessionId: session.publicId });
    return session;
  }

  /**
   * Bumps the roster version of every device belonging to every member, and notifies them.
   *
   * Includes members whose membership just ended: a departing member's own devices must also learn
   * that they can no longer reach the others. `extraUserIds` covers a user removed from the
   * membership table in the same transaction, who would otherwise no longer be listed.
   */
  private async bumpSessionRosters(
    sessionId: string,
    tx: Executor,
    reason: AuthorizationChangeReason,
    sessionPublicId: string,
    extraUserIds: string[] = [],
  ): Promise<void> {
    const memberIds = await this.sessions.listMemberUserIds(sessionId, tx);
    const userIds = [...new Set([...memberIds, ...extraUserIds])];
    if (userIds.length === 0) return;

    const devices: Device[] = (await this.devices.listAllByUserIds(userIds, tx)).filter((d) => !isRevoked(d));
    if (devices.length === 0) return;

    await this.devices.bumpRosterVersions(
      devices.map((d) => d.id),
      tx,
    );
    this.events.authorizationChanged(
      devices.map((d) => d.publicId),
      reason,
      sessionPublicId,
    );
  }
}
