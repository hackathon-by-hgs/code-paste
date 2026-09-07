/**
 * The seam between state changes and realtime delivery.
 *
 * Devices and share-sessions publish through this interface; the realtime gateway implements it.
 * Neither imports the other, so there is no cycle and no temptation for a service to reach into
 * socket internals.
 *
 * Every event is a **hint that cached authorization is stale**, never state transfer and never
 * clipboard content. Delivery is at-most-once by design: a dropped event costs at most one roster
 * TTL of staleness, which is exactly the guarantee that holds when no socket exists at all
 * (ADR-006). That is why no queue, broker or offline buffer is needed here.
 */
export const AUTHORIZATION_EVENT_PUBLISHER = Symbol('AUTHORIZATION_EVENT_PUBLISHER');

export type AuthorizationChangeReason =
  | 'device-registered'
  | 'device-revoked'
  | 'device-removed'
  | 'sync-toggled'
  | 'session-joined'
  | 'session-left'
  | 'session-member-revoked'
  | 'session-expired';

export interface AuthorizationEventPublisher {
  /** Tells these devices (by public id) to re-fetch their roster. */
  authorizationChanged(
    devicePublicIds: string[],
    reason: AuthorizationChangeReason,
    sessionPublicId?: string | null,
  ): void;

  /**
   * Tells one device it is revoked, then closes its sockets.
   *
   * The server does not wait for the client to cooperate: a revoked device is not a party whose
   * agreement is required.
   */
  deviceRevoked(devicePublicId: string): void;

  /** Sync was paused or resumed elsewhere. */
  deviceSyncToggled(devicePublicId: string, syncEnabled: boolean): void;
}

/**
 * Used when no realtime transport is attached.
 *
 * Doing nothing is a correct implementation, not a stub: roster expiry is the correctness floor,
 * and realtime only shortens the window. Tests that assert revocation behaviour therefore pass
 * with or without a socket — which is the property worth having.
 */
export class NoopAuthorizationEventPublisher implements AuthorizationEventPublisher {
  authorizationChanged(): void {}
  deviceRevoked(): void {}
  deviceSyncToggled(): void {}
}
