'use client';

import { useState, useEffect } from 'react';
import { getSession, createSession, joinSession, revokeMember } from '../api/sharing';
import type { ShareSession } from '../api/types';

export const SharingSession = () => {
  const [session, setSession] = useState<ShareSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  useEffect(() => {
    getSession().then(s => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  const handleStartShare = async () => {
    setLoading(true);
    const result = await createSession();
    setSession(result.session);
    alert(`Session created! Join code: ${result.joinCode}`);
    setLoading(false);
  };
  
  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput) return;
    setLoading(true);
    try {
      const s = await joinSession(joinCodeInput);
      setSession(s);
      setShowJoinInput(false);
    } catch (err) {
      alert("Failed to join session. Ensure the code is correct.");
    }
    setLoading(false);
  };

  const handleStopShare = () => {
    if (confirm("Are you sure you want to stop sharing?")) {
      setSession(null);
    }
  };

  const handleRevokeMember = async (id: string) => {
    if (confirm("Remove this member from the session?")) {
      await revokeMember(id);
      setSession(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.userId === id ? { ...m, revoked: true } : m)
      } : null);
    }
  };

  return (
    <section className="px-8 py-6 flex flex-col gap-4">
      <div className="border-b border-white/20 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Sharing Session</h2>
      </div>

      {loading && !session ? (
        <p className="text-sm text-neutral-500">Loading session...</p>
      ) : !session ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-400">Not currently sharing with others.</p>
          
          {showJoinInput ? (
            <form onSubmit={handleJoinSubmit} className="flex gap-2">
              <input 
                type="text" 
                value={joinCodeInput}
                onChange={e => setJoinCodeInput(e.target.value)}
                placeholder="Enter Join Code"
                className="bg-neutral-900 border border-white/40 text-white px-3 py-2 text-sm focus:outline-none focus:border-white"
              />
              <button 
                type="submit"
                disabled={loading}
                className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                Join
              </button>
              <button 
                type="button"
                onClick={() => setShowJoinInput(false)}
                className="text-white hover:text-neutral-400 px-2"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={handleStartShare}
                disabled={loading}
                className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                Start Sharing
              </button>
              <button 
                onClick={() => setShowJoinInput(true)}
                className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors"
              >
                Join Session
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold border-l-2 border-white pl-3">Sharing active.</p>
            <button
              onClick={handleStopShare}
              className="bg-white hover:bg-neutral-200 text-black px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Stop
            </button>
          </div>
          <div>
            <p className="text-xs text-neutral-400 uppercase tracking-widest mb-2">Members</p>
            <ul className="flex flex-col divide-y divide-white/10">
              {session.members.filter(m => !m.revoked).length === 0 ? (
                <li className="text-sm text-neutral-500 italic py-2">Waiting for members to join...</li>
              ) : (
                session.members.filter(m => !m.revoked).map(member => (
                  <li key={member.userId} className="flex justify-between items-center py-3">
                    <span className="text-sm">
                      {member.email} {member.role === 'owner' ? '(Owner)' : ''}
                    </span>
                    {member.role !== 'owner' && (
                      <button
                        onClick={() => handleRevokeMember(member.userId)}
                        className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors"
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
}
