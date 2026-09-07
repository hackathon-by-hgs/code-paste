import type { Device, DeviceCapabilities, Platform } from '../../devices/device.entity';
import type { Executor } from '../database.service';

export const DEVICE_REPOSITORY = Symbol('DEVICE_REPOSITORY');

export interface CreateDeviceInput {
  publicId: string;
  userId: string;
  name: string;
  platform: Platform;
  appVersion: string;
  protocolVersion: number;
  publicKey: string;
  keyFingerprint: string;
  capabilities: DeviceCapabilities;
  createdAt: Date;
}

export interface UpdateDeviceInput {
  name?: string;
  syncEnabled?: boolean;
}

export interface ListDevicesOptions {
  limit: number;
  cursor?: string;
  includeRevoked?: boolean;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface DeviceRepository {
  findById(id: string, ex?: Executor): Promise<Device | null>;
  findByPublicId(publicId: string, ex?: Executor): Promise<Device | null>;
  findByUserAndFingerprint(userId: string, keyFingerprint: string, ex?: Executor): Promise<Device | null>;
  listByUser(userId: string, options: ListDevicesOptions, ex?: Executor): Promise<Page<Device>>;

  create(input: CreateDeviceInput, ex?: Executor): Promise<Device>;
  update(id: string, patch: UpdateDeviceInput, now: Date, ex?: Executor): Promise<Device>;
  revoke(id: string, now: Date, ex?: Executor): Promise<Device>;
  delete(id: string, ex?: Executor): Promise<void>;

  /**
   * Devices eligible to appear in a roster: not revoked, sync enabled, protocol-compatible.
   * Filtering in SQL rather than in the service keeps a revoked device from ever being loaded
   * into a roster candidate list in the first place.
   */
  listSyncEligibleByUserIds(userIds: string[], protocolVersions: number[], ex?: Executor): Promise<Device[]>;

  /**
   * Coalesced liveness write. Returns true when a write actually happened.
   *
   * The coalescing predicate lives in the UPDATE's WHERE clause, so this costs one indexed write
   * attempt with no read, no cache and no lock — which is why `last_seen_at` never becomes the
   * write-hot column that would otherwise argue for a different datastore (ADR-007).
   */
  touchLastSeen(id: string, now: Date, coalesceSeconds: number, ex?: Executor): Promise<boolean>;

  /**
   * Bumps `rosterVersion` for the given devices. This is how a client detects that its cached
   * authorization is stale, and how a revocation reaches devices that never see a push.
   */
  bumpRosterVersions(deviceIds: string[], ex?: Executor): Promise<void>;

  /** All devices of these users, revoked included. Used to compute who a change affects. */
  listAllByUserIds(userIds: string[], ex?: Executor): Promise<Device[]>;
}
