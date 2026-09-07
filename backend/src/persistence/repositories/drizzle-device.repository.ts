import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Device } from '../../devices/device.entity';
import { DatabaseService, type Executor } from '../database.service';
import { DeviceMapper } from '../mappers/device.mapper';
import { buildPage, decodeCursor, encodeCursor } from '../pagination';
import { devices } from '../schema';
import type {
  CreateDeviceInput,
  DeviceRepository,
  ListDevicesOptions,
  Page,
  UpdateDeviceInput,
} from './device.repository';

@Injectable()
export class DrizzleDeviceRepository implements DeviceRepository {
  constructor(private readonly database: DatabaseService) {}

  private ex(ex?: Executor): Executor {
    return ex ?? this.database.db;
  }

  async findById(id: string, ex?: Executor): Promise<Device | null> {
    const [row] = await this.ex(ex).select().from(devices).where(eq(devices.id, id)).limit(1);
    return row ? DeviceMapper.toDomain(row) : null;
  }

  async findByPublicId(publicId: string, ex?: Executor): Promise<Device | null> {
    const [row] = await this.ex(ex).select().from(devices).where(eq(devices.publicId, publicId)).limit(1);
    return row ? DeviceMapper.toDomain(row) : null;
  }

  async findByUserAndFingerprint(
    userId: string,
    keyFingerprint: string,
    ex?: Executor,
  ): Promise<Device | null> {
    const [row] = await this.ex(ex)
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.keyFingerprint, keyFingerprint)))
      .limit(1);
    return row ? DeviceMapper.toDomain(row) : null;
  }

  async listByUser(userId: string, options: ListDevicesOptions, ex?: Executor): Promise<Page<Device>> {
    const position = decodeCursor(options.cursor);
    const conditions = [eq(devices.userId, userId)];
    if (!options.includeRevoked) conditions.push(isNull(devices.revokedAt));
    if (position) {
      // Keyset comparison. Tuple ordering matches the ORDER BY exactly, so rows are never skipped
      // or repeated when devices are added or revoked mid-pagination.
      conditions.push(sql`(${devices.createdAt}, ${devices.id}) < (${position.createdAt}, ${position.id})`);
    }

    const rows = await this.ex(ex)
      .select()
      .from(devices)
      .where(and(...conditions))
      .orderBy(desc(devices.createdAt), desc(devices.id))
      .limit(options.limit + 1);

    const page = buildPage(rows, options.limit, (row) =>
      encodeCursor({ createdAt: row.createdAt, id: row.id }),
    );
    return { data: page.data.map((row) => DeviceMapper.toDomain(row)), nextCursor: page.nextCursor };
  }

  async create(input: CreateDeviceInput, ex?: Executor): Promise<Device> {
    const [row] = await this.ex(ex)
      .insert(devices)
      .values(DeviceMapper.toPersistence(input) as typeof devices.$inferInsert)
      .returning();
    return DeviceMapper.toDomain(row);
  }

  async update(id: string, patch: UpdateDeviceInput, now: Date, ex?: Executor): Promise<Device> {
    const values: Record<string, unknown> = { updatedAt: now };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.syncEnabled !== undefined) values.syncEnabled = patch.syncEnabled;

    const [row] = await this.ex(ex).update(devices).set(values).where(eq(devices.id, id)).returning();
    return DeviceMapper.toDomain(row);
  }

  async revoke(id: string, now: Date, ex?: Executor): Promise<Device> {
    // Idempotent: `revoked_at IS NULL` keeps the original revocation time if this runs twice, so a
    // repeated revoke never looks like a fresh one.
    const [row] = await this.ex(ex)
      .update(devices)
      .set({ revokedAt: sql`COALESCE(${devices.revokedAt}, ${now})`, syncEnabled: false, updatedAt: now })
      .where(eq(devices.id, id))
      .returning();
    return DeviceMapper.toDomain(row);
  }

  async delete(id: string, ex?: Executor): Promise<void> {
    await this.ex(ex).delete(devices).where(eq(devices.id, id));
  }

  async listSyncEligibleByUserIds(
    userIds: string[],
    protocolVersions: number[],
    ex?: Executor,
  ): Promise<Device[]> {
    if (userIds.length === 0 || protocolVersions.length === 0) return [];
    // Revoked, paused and protocol-incompatible devices are excluded in SQL. A revoked device is
    // therefore never even loaded as a roster candidate, rather than being filtered out later by
    // a check somebody could forget.
    const rows = await this.ex(ex)
      .select()
      .from(devices)
      .where(
        and(
          inArray(devices.userId, userIds),
          isNull(devices.revokedAt),
          eq(devices.syncEnabled, true),
          inArray(devices.protocolVersion, protocolVersions),
        ),
      )
      .orderBy(desc(devices.createdAt));
    return rows.map((row) => DeviceMapper.toDomain(row));
  }

  async listAllByUserIds(userIds: string[], ex?: Executor): Promise<Device[]> {
    if (userIds.length === 0) return [];
    const rows = await this.ex(ex).select().from(devices).where(inArray(devices.userId, userIds));
    return rows.map((row) => DeviceMapper.toDomain(row));
  }

  async touchLastSeen(id: string, now: Date, coalesceSeconds: number, ex?: Executor): Promise<boolean> {
    const threshold = new Date(now.getTime() - coalesceSeconds * 1000);
    // The coalescing predicate is the WHERE clause: one indexed write attempt, no read, no lock.
    const rows = await this.ex(ex)
      .update(devices)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(devices.id, id),
          isNull(devices.revokedAt),
          or(isNull(devices.lastSeenAt), sql`${devices.lastSeenAt} < ${threshold}`),
        ),
      )
      .returning({ id: devices.id });
    return rows.length > 0;
  }

  async bumpRosterVersions(deviceIds: string[], ex?: Executor): Promise<void> {
    if (deviceIds.length === 0) return;
    await this.ex(ex)
      .update(devices)
      .set({ rosterVersion: sql`${devices.rosterVersion} + 1` })
      .where(inArray(devices.id, deviceIds));
  }
}
