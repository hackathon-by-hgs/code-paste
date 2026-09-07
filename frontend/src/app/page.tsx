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
    // Mock user joining
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
    <div className="min-h-screen bg-black text-white flex justify-center p-8 font-sans selection:bg-white selection:text-black">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        
        <header className="flex justify-between items-center border-b border-white/20 pb-4">
          <h1 className="text-2xl font-bold tracking-tight uppercase">Clipboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-400">Not logged in</span>
            <button className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
              Log In
            </button>
          </div>
        </header>

        <main className="flex flex-col gap-8">
          
          {/* Sync Status Section */}
          <section className="border border-white/20 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold uppercase tracking-wide">Sync Status</h2>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={isSyncing} onChange={handleToggleSync} />
                <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:h-5 after:w-5 after:transition-all peer-checked:bg-white"></div>
              </label>
            </div>
            <p className={`text-sm ${isSyncing ? 'text-white' : 'text-neutral-500'}`}>
              {isSyncing ? 'Sync is ON. Your clipboard will be synced across your devices.' : 'Sync is paused. Devices will not receive clipboard updates.'}
            </p>
          </section>

          {/* Device Management Section */}
          <section className="border border-white/20 p-6">
            <h2 className="text-lg font-bold uppercase tracking-wide mb-1">My Devices</h2>
            <p className="text-sm text-neutral-400 mb-6">Devices that can receive your clipboard.</p>
            <ul className="flex flex-col mb-6">
              {devices.map(device => (
                <li key={device.id} className="flex justify-between items-center py-4 border-b border-white/10 last:border-0">
                  <div>
                    <strong className="block text-white font-medium">{device.name}</strong>
                    <span className="text-xs text-neutral-400">{device.platform}</span>
                  </div>
                  <button onClick={() => handleRevokeDevice(device.id)} className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors">
                    Revoke
                  </button>
                </li>
              ))}
              {devices.length === 0 && <li className="py-4 text-sm text-neutral-500">No devices registered.</li>}
            </ul>
            <button className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
              Register New Device
            </button>
          </section>

          {/* Sharing Section */}
          <section className="border border-white/20 p-6">
            <h2 className="text-lg font-bold uppercase tracking-wide mb-4">Sharing Session</h2>
            
            {!isSharing ? (
              <div className="flex flex-col items-start gap-6">
                <p className="text-sm text-neutral-400">Not currently sharing with others.</p>
                <div className="flex gap-4">
                  <button onClick={handleStartShare} className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
                    Start Sharing
                  </button>
                  <button className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
                    Join Session
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <p className="text-sm text-white font-bold border-l-2 border-white pl-3 py-1">You are sharing clipboard data.</p>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide mb-2 text-neutral-400">Authorized Members:</h3>
                  <ul className="flex flex-col mb-6">
                    {shareMembers.length === 0 ? (
                      <li className="text-sm text-neutral-500 italic py-2">Waiting for members to join...</li>
                    ) : (
                      shareMembers.map(member => (
                        <li key={member.id} className="flex justify-between items-center py-3 border-b border-white/10 last:border-0">
                          <span className="text-sm text-white font-medium">{member.name}</span>
                          <button onClick={() => handleRevokeMember(member.id)} className="bg-transparent hover:bg-white text-white hover:text-black border border-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors">
                            Remove
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                  <button onClick={handleStopShare} className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors">
                    Stop Sharing
                  </button>
                </div>
              </div>
            )}
          </section>

        </main>
      </div>
    </div>
  );
}
