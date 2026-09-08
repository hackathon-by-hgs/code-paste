/**
 * Device registration, lifecycle and revocation.
 *
 * Note what is absent: this module cannot register a device. `POST /devices` is
 * authorised by a pairing code and called by the *agent*, which holds the
 * Ed25519 private key. A browser has no keypair and is not a clipboard peer, so
 * its half of pairing is `createPairingCode()` — mint a code, show it once, let
 * the agent redeem it.
 */

import { request, requestVoid } from '../lib/http';
import type { Device, DeviceId, DeviceList, PairingCode } from './types';

export interface ListDevicesOptions {
  limit?: number;
  cursor?: string;
  includeRevoked?: boolean;
}

/** One page of devices, newest first. */
export const listDevices = (options: ListDevicesOptions = {}): Promise<DeviceList> =>
  request<DeviceList>('/devices', {
    query: {
      limit: options.limit,
      cursor: options.cursor,
      includeRevoked: options.includeRevoked,
    },
  });

/**
 * Every device, following the cursor to exhaustion.
 *
 * The page cap is a safety valve, not a business rule: it stops a malformed
 * cursor loop from hanging the tab forever.
 */
export const getDevices = async (includeRevoked = false): Promise<Device[]> => {
  const all: Device[] = [];
  let cursor: string | undefined;
  const MAX_PAGES = 20;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listDevices({ cursor, includeRevoked, limit: 100 });
    all.push(...result.data);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return all;
};

/** A single device. `404 not_found` for another user's device — never 403. */
export const getDevice = (id: DeviceId): Promise<Device> => request<Device>(`/devices/${id}`);

/** Rename a device. */
export const renameDevice = (id: DeviceId, name: string): Promise<Device> =>
  request<Device>(`/devices/${id}`, { method: 'PATCH', body: { name } });

/**
 * The pause switch. A paused device drops out of every peer roster.
 *
 * It takes effect at the next roster refresh (up to 5 minutes) and immediately
 * for peers holding a live socket — so the UI should say "pausing", not imply
 * it is already true everywhere.
 */
export const setDeviceSync = (id: DeviceId, syncEnabled: boolean): Promise<Device> =>
  request<Device>(`/devices/${id}`, { method: 'PATCH', body: { syncEnabled } });

/** Revoke a device: kills its tokens and drops it from every roster. Idempotent. */
export const revokeDevice = (id: DeviceId): Promise<Device> =>
  request<Device>(`/devices/${id}/revoke`, { method: 'POST' });

/** Revokes, then deletes. Removal is never weaker than revocation. */
export const deleteDevice = (id: DeviceId): Promise<void> =>
  requestVoid(`/devices/${id}`, { method: 'DELETE' });

/**
 * Mints a short-lived pairing code for an agent to redeem.
 *
 * The plaintext is returned exactly once and is never stored server-side. Show
 * it, count it down, and never persist or log it.
 */
export const createPairingCode = (): Promise<PairingCode> =>
  request<PairingCode>('/devices/pairing-codes', { method: 'POST' });
