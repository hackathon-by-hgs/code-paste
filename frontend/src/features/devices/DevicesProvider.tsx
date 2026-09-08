'use client';

/**
 * Shared device state.
 *
 * Both the sync summary and the device list render the same `syncEnabled` flags,
 * so they read one fetch rather than two — otherwise pausing a device in one
 * panel leaves the other showing stale truth until it happens to refetch.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getDevices, revokeDevice, setDeviceSync } from '../../api/devices';
import type { Device, DeviceId } from '../../api/types';
import { messageFor } from '../../lib/errors';

interface DevicesContextValue {
  devices: Device[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  pauseSync: (id: DeviceId, syncEnabled: boolean) => Promise<void>;
  revoke: (id: DeviceId) => Promise<void>;
}

const DevicesContext = createContext<DevicesContextValue | null>(null);

export const DevicesProvider = ({ children }: { children: ReactNode }) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * `isCancelled` lets the mount path drop a late response instead of setting
   * state on an unmounted tree. The initial `loading` value is already true, so
   * this deliberately does not flip it — that keeps every state write after the
   * await, which is what makes it safe to call from an effect.
   */
  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const next = await getDevices();
      if (isCancelled()) return;
      setDevices(next);
      setError(null);
    } catch (err) {
      if (isCancelled()) return;
      setError(messageFor(err, 'Could not load devices.'));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Replaces one device with the server's copy — never a locally-guessed shape. */
  const replace = useCallback((updated: Device) => {
    setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }, []);

  const pauseSync = useCallback(
    async (id: DeviceId, syncEnabled: boolean) => {
      setError(null);
      try {
        replace(await setDeviceSync(id, syncEnabled));
      } catch (err) {
        setError(messageFor(err, 'Could not change sync for that device.'));
      }
    },
    [replace],
  );

  const revoke = useCallback(async (id: DeviceId) => {
    setError(null);
    try {
      await revokeDevice(id);
      // Revoked devices are excluded from the default listing, so drop it here too.
      setDevices((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(messageFor(err, 'Could not revoke that device.'));
    }
  }, []);

  const value = useMemo<DevicesContextValue>(
    () => ({ devices, loading, error, refresh, pauseSync, revoke }),
    [devices, loading, error, refresh, pauseSync, revoke],
  );

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
};

export const useDevices = (): DevicesContextValue => {
  const ctx = useContext(DevicesContext);
  if (!ctx) throw new Error('useDevices must be used within a DevicesProvider.');
  return ctx;
};
