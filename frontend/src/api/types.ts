/**
 * Types mirroring contracts/openapi/control-plane.yaml (protocol-v1.0.0).
 *
 * Ids are opaque strings with a type prefix — never parse them, never assume a
 * length. Timestamps are RFC3339 UTC strings.
 *
 * These interfaces are intentionally not sealed: the API may add optional fields
 * inside /v1 (ADR-008) and clients must tolerate them.
 */

/** `cp_usr_…` */
export type UserId = string;
/** `cp_dev_…` */
export type DeviceId = string;
/** `cp_ses_…` */
export type SessionId = string;

export type Platform = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'web';
export type ContentType = 'text/plain' | 'image/png' | 'image/jpeg';
export type PrincipalKind = 'browser' | 'device';
export type SessionStatus = 'active' | 'expired' | 'revoked';
export type MemberRole = 'owner' | 'member';

export interface User {
  id: UserId;
  email: string;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: User;
}

export interface Me {
  user: User;
  principal: PrincipalKind;
  /** Present only when `principal` is `device`. */
  device?: Device | null;
}

export interface DeviceCapabilities {
  contentTypes: ContentType[];
  maxPayloadBytes?: number;
}

export interface Device {
  id: DeviceId;
  name: string;
  platform: Platform;
  appVersion: string;
  protocolVersion: number;
  /** Public half only. */
  publicKey: string;
  /** `sha256:<64 hex>` */
  keyFingerprint: string;
  capabilities: DeviceCapabilities;
  syncEnabled: boolean;
  revoked: boolean;
  revokedAt?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
}

/** Shown once at mint time and never retrievable. Never persist it. */
export interface PairingCode {
  /** 8 chars, Crockford-style alphabet with I/L/O/U removed. */
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface ShareMember {
  userId: UserId;
  email: string;
  role: MemberRole;
  joinedAt: string;
  revoked: boolean;
  revokedAt?: string | null;
}

export interface ShareSession {
  id: SessionId;
  ownerUserId: UserId;
  status: SessionStatus;
  expiresAt: string;
  createdAt: string;
  members: ShareMember[];
}

/** `joinCode` is returned only by the creation call. */
export interface ShareSessionWithJoinCode extends ShareSession {
  joinCode: string;
}

export interface ProtocolPolicy {
  apiVersion: string;
  supportedProtocolVersions: number[];
  currentProtocolVersion: number;
  contractsVersion: string;
  limits: Record<ContentType, number>;
}

/** Cursor-paginated collection. Loop until `nextCursor` is null. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export type DeviceList = Page<Device>;
export type ShareSessionList = Page<ShareSession>;
