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
    <div className="min-h-screen bg-black text-white flex justify-center px-4 py-6 font-sans">
      <div className="w-full max-w-xl flex flex-col gap-4">

        <header className="flex justify-between items-center border-b border-white/20 pb-3">
          <h1 className="text-xl font-bold tracking-tight uppercase">Clipboard</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-400">Not logged in</span>
            <button className="bg-white hover:bg-neutral-200 text-black px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors">
              Log In
            </button>
          </div>
        </header>

        <main className="flex flex-col gap-3">

          {/* Sync Status */}
          <section className="border border-white/20 px-4 py-3">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide">Sync Status</h2>
                <p className={`text-xs mt-0.5 ${isSyncing ? 'text-white' : 'text-neutral-500'}`}>
                  {isSyncing ? 'ON — clipboard syncing across your devices.' : 'PAUSED — devices will not receive updates.'}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                <input type="checkbox" className="sr-only peer" checked={isSyncing} onChange={handleToggleSync} />
                <div className="w-10 h-5 bg-neutral-800 peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:h-4 after:w-4 after:transition-all peer-checked:bg-white"></div>
              </label>
            </div>
          </section>

          {/* Device Management */}
          <section className="border border-white/20 px-4 py-3">
            <div className="flex justify-between items-center mb-2">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide">My Devices</h2>
                <p className="text-xs text-neutral-400">Devices that can receive your clipboard.</p>
              </div>
              <button className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors shrink-0 ml-4">
                + Register
              </button>
            </div>
            <ul className="flex flex-col divide-y divide-white/10">
              {devices.map(device => (
                <li key={device.id} className="flex justify-between items-center py-2">
                  <div>
                    <strong className="block text-sm text-white font-medium">{device.name}</strong>
                    <span className="text-xs text-neutral-400">{device.platform}</span>
                  </div>
                  <button onClick={() => handleRevokeDevice(device.id)} className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-2 py-1 text-xs font-bold uppercase tracking-wider transition-colors ml-4">
                    Revoke
                  </button>
                </li>
              ))}
              {devices.length === 0 && <li className="py-2 text-xs text-neutral-500">No devices registered.</li>}
            </ul>
          </section>

          {/* Sharing Session */}
          <section className="border border-white/20 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Sharing Session</h2>

            {!isSharing ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-neutral-400">Not currently sharing with others.</p>
                <div className="flex gap-2 ml-4">
                  <button onClick={handleStartShare} className="bg-white hover:bg-neutral-200 text-black px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors">
                    Start
                  </button>
                  <button className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors">
                    Join
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-white font-bold border-l-2 border-white pl-2">Sharing active.</p>
                  <button onClick={handleStopShare} className="bg-white hover:bg-neutral-200 text-black px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors ml-4">
                    Stop
                  </button>
                </div>
                <div>
                  <p className="text-xs text-neutral-400 uppercase tracking-wide mb-1">Members:</p>
                  <ul className="flex flex-col divide-y divide-white/10">
                    {shareMembers.length === 0 ? (
                      <li className="text-xs text-neutral-500 italic py-1.5">Waiting for members to join...</li>
                    ) : (
                      shareMembers.map(member => (
                        <li key={member.id} className="flex justify-between items-center py-2">
                          <span className="text-sm text-white">{member.name}</span>
                          <button onClick={() => handleRevokeMember(member.id)} className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-2 py-1 text-xs font-bold uppercase tracking-wider transition-colors ml-4">
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
    </div>
  );
}
