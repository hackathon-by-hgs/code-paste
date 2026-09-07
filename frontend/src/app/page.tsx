'use client';

import { useState } from 'react';

// Types
type Device = { id: string; name: string; platform: string; active: boolean };
type Member = { id: string; name: string };

export default function Home() {
  const [isSyncing, setIsSyncing] = useState(true);
  const [isSharing, setIsSharing] = useState(false);
  const [devices, setDevices] = useState<Device[]>([
    { id: '1', name: 'MacBook Pro', platform: 'macOS', active: true },
    { id: '2', name: 'iPhone 15', platform: 'iOS', active: true },
  ]);
  const [shareMembers, setShareMembers] = useState<Member[]>([]);

  const handleToggleSync = () => setIsSyncing(!isSyncing);

  const handleStartShare = () => {
    setIsSharing(true);
    setTimeout(() => {
      setShareMembers(prev => [...prev, { id: 'a1', name: 'Alice (alice@example.com)' }]);
    }, 2000);
  };

  const handleStopShare = () => {
    if (confirm("Are you sure you want to stop sharing?")) {
      setIsSharing(false);
      setShareMembers([]);
    }
  };

  const handleRevokeDevice = (id: string) => {
    if (confirm("Are you sure you want to revoke this device? It will stop syncing immediately.")) {
      setDevices(prev => prev.filter(d => d.id !== id));
    }
  };

  const handleRevokeMember = (id: string) => {
    if (confirm("Remove this member from the session?")) {
      setShareMembers(prev => prev.filter(m => m.id !== id));
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans">

      {/* Header */}
      <header className="flex justify-between items-center border-b border-white/20 px-8 py-4">
        <h1 className="text-xl font-bold tracking-tight uppercase">Clipboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-400">Not logged in</span>
          <button className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
            Log In
          </button>
        </div>
      </header>

      {/* Main 3-column grid layout */}
      <main className="flex-1 grid grid-cols-3 divide-x divide-white/20">

        {/* Left — Sync Status */}
        <section className="px-8 py-6 flex flex-col gap-4">
          <div className="border-b border-white/20 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Sync Status</h2>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold">{isSyncing ? 'Active' : 'Paused'}</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={isSyncing} onChange={handleToggleSync} />
              <div className="w-11 h-6 bg-neutral-800 peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:h-5 after:w-5 after:transition-all peer-checked:bg-white"></div>
            </label>
          </div>
          <p className={`text-sm ${isSyncing ? 'text-white' : 'text-neutral-500'}`}>
            {isSyncing
              ? 'Your clipboard is being synced across all registered devices in real time.'
              : 'Sync is paused. Devices will not receive clipboard updates.'}
          </p>
        </section>

        {/* Middle — Device Management */}
        <section className="px-8 py-6 flex flex-col gap-4">
          <div className="border-b border-white/20 pb-3 flex justify-between items-center">
            <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">My Devices</h2>
            <button className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors">
              + Register
            </button>
          </div>
          <ul className="flex flex-col divide-y divide-white/10 flex-1">
            {devices.map(device => (
              <li key={device.id} className="flex justify-between items-center py-3">
                <div>
                  <strong className="block text-sm font-medium">{device.name}</strong>
                  <span className="text-xs text-neutral-400">{device.platform}</span>
                </div>
                <button
                  onClick={() => handleRevokeDevice(device.id)}
                  className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  Revoke
                </button>
              </li>
            ))}
            {devices.length === 0 && (
              <li className="py-3 text-sm text-neutral-500">No devices registered.</li>
            )}
          </ul>
        </section>

        {/* Right — Sharing Session */}
        <section className="px-8 py-6 flex flex-col gap-4">
          <div className="border-b border-white/20 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Sharing Session</h2>
          </div>

          {!isSharing ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-neutral-400">Not currently sharing with others.</p>
              <div className="flex gap-3">
                <button
                  onClick={handleStartShare}
                  className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  Start Sharing
                </button>
                <button className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
                  Join Session
                </button>
              </div>
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
                  {shareMembers.length === 0 ? (
                    <li className="text-sm text-neutral-500 italic py-2">Waiting for members to join...</li>
                  ) : (
                    shareMembers.map(member => (
                      <li key={member.id} className="flex justify-between items-center py-3">
                        <span className="text-sm">{member.name}</span>
                        <button
                          onClick={() => handleRevokeMember(member.id)}
                          className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors"
                        >
                          Remove
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
