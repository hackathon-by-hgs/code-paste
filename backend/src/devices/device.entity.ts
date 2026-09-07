/**
 * Device domain entity.
 *
 * Framework-free and driver-free by design (`RULES.md` §3.6). It carries an internal `id` for
 * joins and a `publicId` for the outside world; `DeviceMapper.toPublic` is the only thing that
 * decides which of these — and which other fields — a client ever sees.
 */

export const PLATFORMS = ['macos', 'windows', 'linux', 'ios', 'android', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_TYPES = ['text/plain', 'image/png', 'image/jpeg'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export interface DeviceCapabilities {
  contentTypes: ContentType[];
  maxPayloadBytes?: number;
}

export interface Device {
  /** Internal key. Never leaves the process. */
  id: string;
  publicId: string;
  userId: string;
  name: string;
  platform: Platform;
  appVersion: string;
  protocolVersion: number;
  /** Ed25519 public key, 32 raw bytes, base64. */
  publicKey: string;
  keyFingerprint: string;
  capabilities: DeviceCapabilities;
  syncEnabled: boolean;
  rosterVersion: number;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

/** The public projection. This is the shape clients receive — see `contracts/openapi`. */
export interface PublicDevice {
  id: string;
  name: string;
  platform: Platform;
  appVersion: string;
  protocolVersion: number;
  publicKey: string;
  keyFingerprint: string;
  capabilities: DeviceCapabilities;
  syncEnabled: boolean;
  revoked: boolean;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export const isRevoked = (device: Device): boolean => device.revokedAt !== null;

/**
 * Whether this device may participate in clipboard exchange at all.
 *
 * Distinct from "may talk to peer X": this is the device-local half of the authorization
 * predicate, and `AuthorizationService` owns the rest.
 */
export const isSyncEligible = (device: Device): boolean => !isRevoked(device) && device.syncEnabled;
