'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createSession,
  expireSession,
  getActiveSession,
  joinSession,
  leaveSession,
  revokeMember,
} from '../api/sharing';
import type { ShareSession as Session } from '../api/types';
import { useAuth } from '../features/auth/AuthProvider';
import { isApiError, messageFor } from '../lib/errors';
import { formatCountdown, secondsUntil } from '../lib/time';

const inputClass =
  'bg-neutral-900 border border-white/40 text-white px-3 py-2 text-sm focus:outline-none focus:border-white';

/**
 * Joining needs the session id *and* the code — the code alone does not identify
 * a session in the contract, so the form collects both.
 */
const JoinForm = ({
  onJoined,
  onCancel,
}: {
  onJoined: (session: Session) => void;
  onCancel: () => void;
}) => {
  const [sessionId, setSessionId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!sessionId || !joinCode) return;

    setBusy(true);
    setError(null);
    try {
      onJoined(await joinSession(sessionId.trim(), joinCode.trim().toUpperCase()));
    } catch (err) {
      if (isApiError(err)) {
        // `forbidden` covers a wrong code and a revoked membership alike.
        if (err.code === 'forbidden') setError('Wrong join code, or your membership was revoked.');
        else if (err.code === 'not_found') setError('No such session.');
        else if (err.code === 'session_expired') setError('That session has already ended.');
        else if (err.code === 'rate_limited') setError('Too many attempts. Wait a moment.');
        else setError(messageFor(err, 'Could not join that session.'));
      } else {
        setError(messageFor(err, 'Could not join that session.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        value={sessionId}
        onChange={(e) => setSessionId(e.target.value)}
        placeholder="Session ID (cp_ses_…)"
        autoComplete="off"
        aria-label="Session ID"
        className={inputClass}
      />
      <input
        type="text"
        value={joinCode}
        onChange={(e) => setJoinCode(e.target.value)}
        placeholder="Join Code"
        aria-label="Join Code"
        maxLength={8}
        className={`${inputClass} font-mono tracking-widest uppercase`}
      />

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
        <button type="button" onClick={onCancel} className="text-white hover:text-neutral-400 px-2">
          Cancel
        </button>
      </div>
    </form>
  );
};

export const SharingSession = () => {
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  /** Held in state only — the API returns it once and never again. */
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  // Every state write lands after the await, and a late response is dropped if
  // the panel unmounted first. `loading` already starts true, so no flag flip.
  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const active = await getActiveSession();
      if (isCancelled()) return;
      setSession(active);
      setError(null);
    } catch (err) {
      if (isCancelled()) return;
      setError(messageFor(err, 'Could not load sharing sessions.'));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!session) return;
    const tick = () => setRemaining(secondsUntil(session.expiresAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);

  const isOwner = session !== null && user !== null && session.ownerUserId === user.id;

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await createSession();
      const { joinCode: code, ...rest } = created;
      setSession(rest);
      setJoinCode(code);
    } catch (err) {
      setError(messageFor(err, 'Could not start a sharing session.'));
    } finally {
      setBusy(false);
    }
  };

  /** An owner ends the session for everyone; a member can only leave it. */
  const handleStop = async () => {
    if (!session) return;

    const prompt = isOwner
      ? 'End this sharing session? Every member stops receiving your clipboard data.'
      : 'Leave this sharing session?';
    if (!confirm(prompt)) return;

    setBusy(true);
    setError(null);
    try {
      if (isOwner) await expireSession(session.id);
      else await leaveSession(session.id);
      setSession(null);
      setJoinCode(null);
    } catch (err) {
      setError(messageFor(err, 'Could not end the session.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeMember = async (userId: string, email: string) => {
    if (!session) return;
    if (!confirm(`Remove ${email} from this session? They cannot rejoin with the same code.`)) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setSession(await revokeMember(session.id, userId));
    } catch (err) {
      setError(messageFor(err, 'Could not remove that member.'));
    } finally {
      setBusy(false);
    }
  };

  const members = session?.members.filter((m) => !m.revoked) ?? [];

  return (
    <section className="px-4 sm:px-8 py-6 flex flex-col gap-4">
      <div className="border-b border-white/20 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          Sharing Session
        </h2>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400 border-l-2 border-red-400 pl-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading session...</p>
      ) : !session ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-400">Not currently sharing with others.</p>

          {showJoin ? (
            <JoinForm
              onJoined={(joined) => {
                setSession(joined);
                setShowJoin(false);
              }}
              onCancel={() => setShowJoin(false)}
            />
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => void handleStart()}
                disabled={busy}
                className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                Start Sharing
              </button>
              <button
                onClick={() => setShowJoin(true)}
                className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors"
              >
                Join Session
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-bold border-l-2 border-white pl-3">
              Sharing active · ends in{' '}
              <span className="font-mono font-normal">{formatCountdown(remaining)}</span>
            </p>
            <button
              onClick={() => void handleStop()}
              disabled={busy}
              className="bg-white hover:bg-neutral-200 text-black px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 shrink-0"
            >
              {isOwner ? 'Stop' : 'Leave'}
            </button>
          </div>

          {joinCode && (
            <div className="border border-white/40 p-3 flex flex-col gap-1">
              <p className="text-xs uppercase tracking-widest text-neutral-400">Session Join Code</p>
              <p className="font-mono text-2xl tracking-[0.3em] select-all">{joinCode}</p>
              <p className="text-xs text-neutral-400 break-all">
                Session ID <span className="font-mono text-neutral-300">{session.id}</span>
              </p>
              <p className="text-xs text-neutral-600">
                Shown once. Both values are needed to join, and neither can be retrieved later.
                This is <strong className="text-neutral-500">not</strong> a device pairing code —
                it invites a person, not a machine.
              </p>
            </div>
          )}

          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-widest mb-2">
              Who can receive your clipboard
            </p>
            <ul className="flex flex-col divide-y divide-white/10">
              {members.length === 0 ? (
                <li className="text-sm text-neutral-500 italic py-2">
                  Waiting for members to join...
                </li>
              ) : (
                members.map((member) => (
                  <li key={member.userId} className="flex justify-between items-center gap-3 py-3">
                    <span className="text-sm truncate">
                      {member.email} {member.role === 'owner' ? '(Owner)' : ''}
                    </span>
                    {isOwner && member.role !== 'owner' && (
                      <button
                        onClick={() => void handleRevokeMember(member.userId, member.email)}
                        disabled={busy}
                        className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
};
