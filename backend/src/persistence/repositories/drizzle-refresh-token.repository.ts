import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { RefreshToken } from '../../auth/refresh-token.entity';
import { DatabaseService, type Executor } from '../database.service';
import { refreshTokens } from '../schema';
import type { CreateRefreshTokenInput, RefreshTokenRepository } from './refresh-token.repository';

function toDomain(row: typeof refreshTokens.$inferSelect): RefreshToken {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    tokenHash: row.tokenHash,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
  };
}

@Injectable()
export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly database: DatabaseService) {}

  private ex(ex?: Executor): Executor {
    return ex ?? this.database.db;
  }

  async create(input: CreateRefreshTokenInput, ex?: Executor): Promise<RefreshToken> {
    const [row] = await this.ex(ex)
      .insert(refreshTokens)
      .values({
        userId: input.userId,
        deviceId: input.deviceId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      })
      .returning();
    return toDomain(row);
  }

  async findByHash(tokenHash: string, ex?: Executor): Promise<RefreshToken | null> {
    const [row] = await this.ex(ex)
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ? toDomain(row) : null;
  }

  async markUsedIfUnused(id: string, now: Date, ex?: Executor): Promise<boolean> {
    // The `used_at IS NULL` predicate is what makes rotation safe under concurrency. Two
    // simultaneous refreshes with the same token both reach here; exactly one updates a row, and
    // the loser is correctly treated as a reuse rather than quietly issuing a second token pair.
    const rows = await this.ex(ex)
      .update(refreshTokens)
      .set({ usedAt: now })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length > 0;
  }

  async revokeFamily(familyId: string, now: Date, ex?: Executor): Promise<number> {
    const rows = await this.ex(ex)
      .update(refreshTokens)
      .set({ revokedAt: sql`COALESCE(${refreshTokens.revokedAt}, ${now})` })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async revokeAllForDevice(deviceId: string, now: Date, ex?: Executor): Promise<number> {
    const rows = await this.ex(ex)
      .update(refreshTokens)
      .set({ revokedAt: sql`COALESCE(${refreshTokens.revokedAt}, ${now})` })
      .where(and(eq(refreshTokens.deviceId, deviceId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async deleteExpiredBefore(cutoff: Date, ex?: Executor): Promise<number> {
    const rows = await this.ex(ex)
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, cutoff))
      .returning({ id: refreshTokens.id });
    return rows.length;
  }
}
