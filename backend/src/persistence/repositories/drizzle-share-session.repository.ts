import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { MemberRole, SessionStatus, ShareSession } from '../../share-sessions/share-session.entity';
import { DatabaseService, type Executor } from '../database.service';
import { ShareSessionMapper } from '../mappers/share-session.mapper';
import { buildPage, decodeCursor, encodeCursor } from '../pagination';
import { shareMembers, shareSessions, users } from '../schema';
import type { Page } from './device.repository';
import type {
  CreateShareSessionInput,
  ListSessionsOptions,
  ShareSessionRepository,
} from './share-session.repository';

@Injectable()
export class DrizzleShareSessionRepository implements ShareSessionRepository {
  constructor(private readonly database: DatabaseService) {}

  private ex(ex?: Executor): Executor {
    return ex ?? this.database.db;
  }

  /** Members joined to users so the caller can be shown who exactly can receive their clipboard. */
  private async loadMembers(sessionIds: string[], ex?: Executor) {
    if (sessionIds.length === 0) return [];
    return this.ex(ex)
      .select({
        sessionId: shareMembers.sessionId,
        userId: shareMembers.userId,
        userPublicId: users.publicId,
        email: users.email,
        role: shareMembers.role,
        joinedAt: shareMembers.joinedAt,
        revokedAt: shareMembers.revokedAt,
      })
      .from(shareMembers)
      .innerJoin(users, eq(users.id, shareMembers.userId))
      .where(inArray(shareMembers.sessionId, sessionIds))
      .orderBy(shareMembers.joinedAt);
  }

  private async hydrate(
    rows: Array<typeof shareSessions.$inferSelect>,
    ex?: Executor,
  ): Promise<ShareSession[]> {
    if (rows.length === 0) return [];
    const members = await this.loadMembers(
      rows.map((r) => r.id),
      ex,
    );
    const owners = await this.ex(ex)
      .select({ id: users.id, publicId: users.publicId })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.ownerUserId))]));
    const ownerById = new Map(owners.map((o) => [o.id, o.publicId]));

    return rows.map((row) =>
      ShareSessionMapper.toDomain(
        row,
        members.filter((m) => m.sessionId === row.id),
        ownerById.get(row.ownerUserId) ?? '',
      ),
    );
  }

  async findById(id: string, ex?: Executor): Promise<ShareSession | null> {
    const rows = await this.ex(ex).select().from(shareSessions).where(eq(shareSessions.id, id)).limit(1);
    return (await this.hydrate(rows, ex))[0] ?? null;
  }

  async findByPublicId(publicId: string, ex?: Executor): Promise<ShareSession | null> {
    const rows = await this.ex(ex)
      .select()
      .from(shareSessions)
      .where(eq(shareSessions.publicId, publicId))
      .limit(1);
    return (await this.hydrate(rows, ex))[0] ?? null;
  }

  async listForUser(
    userId: string,
    options: ListSessionsOptions,
    ex?: Executor,
  ): Promise<Page<ShareSession>> {
    const position = decodeCursor(options.cursor);
    const conditions = [
      // Owned, or a member of. Membership is checked against a non-revoked row, so a revoked
      // member stops seeing the session immediately.
      sql`(${shareSessions.ownerUserId} = ${userId} OR EXISTS (
            SELECT 1 FROM ${shareMembers}
            WHERE ${shareMembers.sessionId} = ${shareSessions.id}
              AND ${shareMembers.userId} = ${userId}
              AND ${shareMembers.revokedAt} IS NULL))`,
    ];
    if (options.status) conditions.push(eq(shareSessions.status, options.status));
    if (position) {
      conditions.push(
        sql`(${shareSessions.createdAt}, ${shareSessions.id}) < (${position.createdAt}, ${position.id})`,
      );
    }

    const rows = await this.ex(ex)
      .select()
      .from(shareSessions)
      .where(and(...conditions))
      .orderBy(desc(shareSessions.createdAt), desc(shareSessions.id))
      .limit(options.limit + 1);

    const page = buildPage(rows, options.limit, (row) =>
      encodeCursor({ createdAt: row.createdAt, id: row.id }),
    );
    return { data: await this.hydrate(page.data, ex), nextCursor: page.nextCursor };
  }

  async create(input: CreateShareSessionInput, ex?: Executor): Promise<ShareSession> {
    const [row] = await this.ex(ex)
      .insert(shareSessions)
      .values({
        publicId: input.publicId,
        ownerUserId: input.ownerUserId,
        joinCodeHash: input.joinCodeHash,
        status: 'active',
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      })
      .returning();
    return (await this.hydrate([row], ex))[0];
  }

  async setStatus(id: string, status: SessionStatus, ex?: Executor): Promise<ShareSession> {
    const [row] = await this.ex(ex)
      .update(shareSessions)
      .set({ status })
      .where(eq(shareSessions.id, id))
      .returning();
    return (await this.hydrate([row], ex))[0];
  }

  async addMember(
    sessionId: string,
    userId: string,
    role: MemberRole,
    now: Date,
    ex?: Executor,
  ): Promise<void> {
    // Idempotent join. The composite primary key makes a double-join impossible, and the DO UPDATE
    // deliberately does NOT clear `revoked_at`: a revoked member must not be able to rejoin by
    // replaying the join code (see share-sessions.service.ts, which rejects them earlier too).
    await this.ex(ex)
      .insert(shareMembers)
      .values({ sessionId, userId, role, joinedAt: now })
      .onConflictDoUpdate({
        target: [shareMembers.sessionId, shareMembers.userId],
        set: { role },
      });
  }

  async revokeMember(sessionId: string, userId: string, now: Date, ex?: Executor): Promise<void> {
    await this.ex(ex)
      .update(shareMembers)
      .set({ revokedAt: sql`COALESCE(${shareMembers.revokedAt}, ${now})` })
      .where(and(eq(shareMembers.sessionId, sessionId), eq(shareMembers.userId, userId)));
  }

  async removeMember(sessionId: string, userId: string, ex?: Executor): Promise<void> {
    await this.ex(ex)
      .delete(shareMembers)
      .where(and(eq(shareMembers.sessionId, sessionId), eq(shareMembers.userId, userId)));
  }

  async findCoMemberUserIds(
    userId: string,
    now: Date,
    ex?: Executor,
  ): Promise<Array<{ userId: string; sessionPublicId: string }>> {
    // Both liveness conditions are applied here, in SQL: status must be 'active' AND the session
    // must not have expired. Relying on the swept status alone would keep peers authorized past
    // the end of a sharing session whenever the sweep had not run.
    const rows = await this.ex(ex)
      .select({ userId: shareMembers.userId, sessionPublicId: shareSessions.publicId })
      .from(shareSessions)
      .innerJoin(shareMembers, eq(shareMembers.sessionId, shareSessions.id))
      .where(
        and(
          eq(shareSessions.status, 'active'),
          gt(shareSessions.expiresAt, now),
          isNull(shareMembers.revokedAt),
          ne(shareMembers.userId, userId),
          sql`EXISTS (
                SELECT 1 FROM ${shareMembers} me
                WHERE me.session_id = ${shareSessions.id}
                  AND me.user_id = ${userId}
                  AND me.revoked_at IS NULL)`,
        ),
      );
    return rows;
  }

  async listMemberUserIds(sessionId: string, ex?: Executor): Promise<string[]> {
    const rows = await this.ex(ex)
      .select({ userId: shareMembers.userId })
      .from(shareMembers)
      .where(eq(shareMembers.sessionId, sessionId));
    return rows.map((r) => r.userId);
  }
}
