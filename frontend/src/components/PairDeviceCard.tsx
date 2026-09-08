'use client';

/**
 * The browser's half of device pairing.
 *
 * A browser holds no Ed25519 keypair, so it cannot call `POST /devices` — it
 * mints a code here and the agent redeems it. The plaintext code is returned
 * exactly once and is never stored server-side, so it is held in component state
 * only: never persisted, never logged.
 */

import { useEffect, useState } from 'react';
import { createPairingCode } from '../api/devices';
import type { PairingCode } from '../api/types';
import { isApiError, messageFor } from '../lib/errors';
import { formatCountdown, secondsUntil } from '../lib/time';

export const PairDeviceCard = ({ onDismiss }: { onDismiss: () => void }) => {
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const code = await createPairingCode();
        if (cancelled) return;
        setPairing(code);
        setRemaining(secondsUntil(code.expiresAt));
      } catch (err) {
        if (cancelled) return;
        if (isApiError(err) && err.code === 'rate_limited') {
          setError('Too many pairing codes requested. Wait a moment and try again.');
        } else {
          setError(messageFor(err, 'Could not mint a pairing code.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setRemaining(secondsUntil(pairing.expiresAt)), 1000);
    
    return () => clearInterval(timer);
  }, [pairing]);

  const expired = pairing !== null && remaining === 0;

  return (
    <div className="border border-white/40 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs uppercase tracking-widest text-neutral-400">Pairing Code</p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-neutral-400 hover:text-white"
        >
          Close
        </button>
      </div>

      {loading && <p className="text-sm text-neutral-500">Minting a code…</p>}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {pairing && !expired && (
        <>
          <p className="font-mono text-3xl tracking-[0.3em] select-all">{pairing.code}</p>
          <p className="text-xs text-neutral-400">
            Enter this in the agent on the device you are adding. Expires in{' '}
            <span className="font-mono text-white">{formatCountdown(remaining)}</span>.
          </p>
          <p className="text-xs text-neutral-600">
            Shown once and single-use. If you lose it, mint another.
          </p>
        </>
      )}

      {expired && (
        <p className="text-sm text-neutral-400">
          That code expired. Close this and start pairing again.
        </p>
      )}
    </div>
  );
};
