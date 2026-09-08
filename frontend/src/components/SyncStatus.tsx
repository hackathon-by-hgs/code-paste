'use client';

/**
 * Sync state, derived rather than invented.
 *
 * The control plane has no account-level sync switch — `syncEnabled` is a
 * per-device flag (`PATCH /devices/{id}`). So this panel summarises the devices
 * and its toggle fans out across them, instead of implying a global setting that
 * does not exist on the server.
 */

import { useState } from 'react';
import { useDevices } from '../features/devices/DevicesProvider';

export const SyncStatus = () => {
  const { devices, loading, pauseSync } = useDevices();
  const [busy, setBusy] = useState(false);

  const active = devices.filter((d) => d.syncEnabled);
  const anyActive = active.length > 0;
  const hasDevices = devices.length > 0;

  const handleToggleAll = async () => {
    const next = !anyActive;
    setBusy(true);
    
    // Sequential: the API rate-limits, and a burst of PATCHes buys nothing here.
    for (const device of devices) {
      if (device.syncEnabled !== next) await pauseSync(device.id, next);
    }
    setBusy(false);
  };

  return (
    <section className="px-4 sm:px-8 py-6 flex flex-col gap-4">
      <div className="border-b border-white/20 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Sync Status</h2>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">
          {loading ? 'Checking…' : !hasDevices ? 'No devices' : anyActive ? 'Active' : 'Paused'}
        </span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={anyActive}
            onChange={() => void handleToggleAll()}
            disabled={busy || loading || !hasDevices}
            aria-label="Toggle sync for all devices"
          />
          <div className="w-11 h-6 bg-neutral-800 peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:h-5 after:w-5 after:transition-all peer-checked:bg-white peer-disabled:opacity-50"></div>
        </label>
      </div>

      <p className={`text-sm ${anyActive ? 'text-white' : 'text-neutral-500'}`}>
        {!hasDevices
          ? 'Pair a device to start syncing your clipboard.'
          : anyActive
            ? `${active.length} of ${devices.length} ${devices.length === 1 ? 'device is' : 'devices are'} syncing.`
            : 'Sync is paused on every device. No device will receive clipboard updates.'}
      </p>

      {hasDevices && (
        <p className="text-xs text-neutral-600">
          Pausing takes effect within about five minutes for peers without a live connection, and
          immediately for those with one.
        </p>
      )}
    </section>
  );
};
