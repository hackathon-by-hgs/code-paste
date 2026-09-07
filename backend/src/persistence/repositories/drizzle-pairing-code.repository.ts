import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { PairingCode } from '../../devices/pairing-code.entity';
import { DatabaseService, type Executor } from '../database.service';
import { pairingCodes } from '../schema';
import type { CreatePairingCodeInput, PairingCodeRepository } from './pairing-code.repository';

function toDomain(row: typeof pairingCodes.$inferSelect): PairingCode {
  return {
    id: row.id,
    userId: row.userId,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    consumedAt: row.consumedAt,
  };
}

@Injectable()
export class DrizzlePairingCodeRepository implements PairingCodeRepository {
  constructor(private readonly database: DatabaseService) {}

  private ex(ex?: Executor): Executor {
    return ex ?? this.database.db;
  }

  async create(input: CreatePairingCodeInput, ex?: Executor): Promise<PairingCode> {
    const [row] = await this.ex(ex)
      .insert(pairingCodes)
      .values({
        userId: input.userId,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      })
      .returning();
    return toDomain(row);
  }

  async consume(codeHash: string, now: Date, ex?: Executor): Promise<PairingCode | null> {
    /**
     * One conditional UPDATE, never find-then-update.
     *
     * Two agents racing on the same code both reach this statement; Postgres serialises the row
     * update, so exactly one sees `consumed_at IS NULL` and gets a row back. A check-then-act
     * would let both through and bind two devices from a single authorisation.
     *
     * Expiry is enforced in the same predicate, so an expired code can never be consumed even if
     * a caller forgot to check.
     */
    const rows = await this.ex(ex)
      .update(pairingCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(pairingCodes.codeHash, codeHash),
          isNull(pairingCodes.consumedAt),
          gt(pairingCodes.expiresAt, now),
        ),
      )
      .returning();
    return rows.length > 0 ? toDomain(rows[0]) : null;
  }

  async deleteExpiredBefore(cutoff: Date, ex?: Executor): Promise<number> {
    const rows = await this.ex(ex)
      .delete(pairingCodes)
      .where(lt(pairingCodes.expiresAt, cutoff))
      .returning({ id: pairingCodes.id });
    return rows.length;
  }
}
