'use client';

import { useState } from 'react';
import { useDevices } from '../features/devices/DevicesProvider';
import type { Device } from '../api/types';
import { AGENT_DOWNLOAD_URL } from '../lib/agent';
import { relativeTime } from '../lib/time';
import { PairDeviceCard } from './PairDeviceCard';

const DeviceRow = ({ device }: { device: Device }) => {
  const { pauseSync, revoke } = useDevices();
  const [busy, setBusy] = useState(false);

  const handleToggleSync = async () => {
    setBusy(true);
    await pauseSync(device.id, !device.syncEnabled);
    setBusy(false);
  };

  // Destructive and irreversible — name the device in the prompt (RULES.md §10).
  const handleRevoke = async () => {
    const ok = confirm(
      `Revoke "${device.name}"? It stops syncing immediately and its tokens are destroyed. This cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    await revoke(device.id);
    setBusy(false);
  };

  return (
    <li className="flex justify-between items-center gap-4 py-3">
      <div className="min-w-0">
        <strong className="block text-sm font-medium truncate">{device.name}</strong>
        <span className="text-xs text-neutral-400">
          {device.platform} · seen {relativeTime(device.lastSeenAt)}
          {!device.syncEnabled && <span className="text-neutral-500"> · paused</span>}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => void handleToggleSync()}
          disabled={busy}
          className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {device.syncEnabled ? 'Pause' : 'Resume'}
        </button>
        <button
          onClick={() => void handleRevoke()}
          disabled={busy}
          className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          Revoke
        </button>
      </div>
    </li>
  );
};

export const DeviceList = () => {
  const { devices, loading, error } = useDevices();
  const [pairing, setPairing] = useState(false);

  return (
    <section className="px-4 sm:px-8 py-6 flex flex-col gap-4">
      <div className="border-b border-white/20 pb-3 flex justify-between items-center">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">My Devices</h2>
        <button
          onClick={() => setPairing(true)}
          disabled={loading || pairing}
          className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          + Pair Device
        </button>
      </div>

      {pairing && <PairDeviceCard onDismiss={() => setPairing(false)} />}

      {error && (
        <p role="alert" className="text-sm text-red-400 border-l-2 border-red-400 pl-3">
          {error}
        </p>
      )}

      {loading && devices.length === 0 ? (
        <p className="text-sm text-neutral-500 py-3">Loading devices...</p>
      ) : (
        <ul className="flex flex-col divide-y divide-white/10 flex-1">
          {devices.map((device) => (
            <DeviceRow key={device.id} device={device} />
          ))}
          {devices.length === 0 && !error && (
            <li className="py-3 text-sm text-neutral-500 flex flex-col gap-2">
              <span>
                No devices registered. Clipboard syncing needs the desktop agent running on each
                machine — this page pairs and manages them, but never moves clipboard content
                itself.
              </span>
              <a
                href={AGENT_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                className="text-white underline underline-offset-2 hover:text-neutral-300 self-start"
              >
                Download the agent →
              </a>
            </li>
          )}
        </ul>
      )}
    </section>
  );
};
