import type { Device, DeviceCapabilities, Platform, PublicDevice } from '../../devices/device.entity';
import type { CreateDeviceInput } from '../repositories/device.repository';

/**
 * Device mapping across two distinct boundaries. Conflating them is precisely the mistake this
 * separation exists to prevent:
 *
 *   row -> domain        widen storage into the entity
 *   domain -> row        narrow for insert/update
 *   domain -> public     THE REDACTION BOUNDARY: what a client is allowed to see
 *
 * `toPublic` builds its result field by field and never spreads. A spread would mean that any
 * field added to `Device` later — a hash, an internal id, a token — silently starts appearing in
 * API responses. Explicit construction makes leaking a new field an act of commission.
 *
 * All three are pure, so the whole mapping layer is unit-testable with no database.
 */

interface DeviceRowLike {
  id: string;
  publicId: string;
  userId: string;
  name: string;
  platform: string;
  appVersion: string;
  protocolVersion: number;
  publicKey: string;
  keyFingerprint: string;
  capabilities: unknown;
  syncEnabled: boolean;
  rosterVersion: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

function parseCapabilities(value: unknown): DeviceCapabilities {
  // jsonb round-trips as unknown. Validation happened at the HTTP boundary before this was
  // stored, so this narrows a trusted value rather than re-validating an untrusted one.
  const raw = (value ?? {}) as { contentTypes?: unknown; maxPayloadBytes?: unknown };
  const contentTypes = Array.isArray(raw.contentTypes)
    ? (raw.contentTypes as DeviceCapabilities['contentTypes'])
    : [];
  const capabilities: DeviceCapabilities = { contentTypes };
  if (typeof raw.maxPayloadBytes === 'number') capabilities.maxPayloadBytes = raw.maxPayloadBytes;
  return capabilities;
}

export const DeviceMapper = {
  toDomain(row: DeviceRowLike): Device {
    return {
      id: row.id,
      publicId: row.publicId,
      userId: row.userId,
      name: row.name,
      platform: row.platform as Platform,
      appVersion: row.appVersion,
      protocolVersion: row.protocolVersion,
      publicKey: row.publicKey,
      keyFingerprint: row.keyFingerprint,
      capabilities: parseCapabilities(row.capabilities),
      syncEnabled: row.syncEnabled,
      rosterVersion: row.rosterVersion,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      revokedAt: row.revokedAt,
    };
  },

  toPersistence(input: CreateDeviceInput): Record<string, unknown> {
    return {
      publicId: input.publicId,
      userId: input.userId,
      name: input.name,
      platform: input.platform,
      appVersion: input.appVersion,
      protocolVersion: input.protocolVersion,
      publicKey: input.publicKey,
      keyFingerprint: input.keyFingerprint,
      capabilities: input.capabilities,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
  },

  /**
   * The public projection.
   *
   * Deliberately absent: `id` (internal key), `userId` (internal key), `rosterVersion` (internal
   * bookkeeping). `publicKey` IS present and that is correct — it is the public half, and peers
   * need it to authenticate each other.
   */
  toPublic(device: Device): PublicDevice {
    return {
      id: device.publicId,
      name: device.name,
      platform: device.platform,
      appVersion: device.appVersion,
      protocolVersion: device.protocolVersion,
      publicKey: device.publicKey,
      keyFingerprint: device.keyFingerprint,
      capabilities: device.capabilities,
      syncEnabled: device.syncEnabled,
      revoked: device.revokedAt !== null,
      revokedAt: device.revokedAt ? device.revokedAt.toISOString() : null,
      lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      createdAt: device.createdAt.toISOString(),
    };
  },
};
