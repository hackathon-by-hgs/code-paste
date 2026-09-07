import type { Device } from '../devices/device.entity';
import type { User } from '../users/user.entity';

/**
 * Two principal kinds, deliberately not interchangeable (ADR-004).
 *
 * A **browser** principal manages the account. A **device** principal is additionally a clipboard
 * peer, and only a device may fetch a roster, heartbeat, or open the realtime socket.
 *
 * Without the split, a stolen web session would grant clipboard peer access and a compromised
 * device would grant full account control. Guards enforce it; controllers never re-derive it.
 */
export type PrincipalKind = 'browser' | 'device';

export interface AccessTokenClaims {
  /** User public id. */
  sub: string;
  /** Device public id. Present only on device tokens. */
  did?: string;
  typ: PrincipalKind;
  /** Session version. A mismatch invalidates the token without a database read. */
  sv: number;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/** Resolved, verified caller. Attached to the request by AuthGuard. */
export interface Principal {
  kind: PrincipalKind;
  user: User;
  /** Present when kind === 'device'. Guaranteed non-revoked at the time the guard ran. */
  device?: Device;
  tokenId: string;
}

export interface DevicePrincipal extends Principal {
  kind: 'device';
  device: Device;
}

export const isDevicePrincipal = (principal: Principal): principal is DevicePrincipal =>
  principal.kind === 'device' && principal.device !== undefined;
