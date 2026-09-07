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
    <div className="min-h-screen bg-slate-900 text-slate-50 flex justify-center p-8 font-sans">
      <div className="w-full max-w-2xl flex flex-col gap-8">
        
        <header className="flex justify-between items-center border-b border-slate-700 pb-4">
          <h1 className="text-2xl font-semibold">Clipboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400">Not logged in</span>
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
              Log In
            </button>
          </div>
        </header>

        <main className="flex flex-col gap-6">
          
          {/* Sync Status Section */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Sync Status</h2>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={isSyncing} onChange={handleToggleSync} />
                <div className="w-11 h-6 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            <p className={`text-sm ${isSyncing ? 'text-emerald-400' : 'text-slate-400'}`}>
              {isSyncing ? 'Sync is ON. Your clipboard will be synced across your devices.' : 'Sync is paused. Devices will not receive clipboard updates.'}
            </p>
          </section>

          {/* Device Management Section */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-1">My Devices</h2>
            <p className="text-sm text-slate-400 mb-4">Devices that can receive your clipboard.</p>
            <ul className="flex flex-col mb-4">
              {devices.map(device => (
                <li key={device.id} className="flex justify-between items-center py-3 border-b border-slate-700 last:border-0">
                  <div>
                    <strong className="block text-slate-200">{device.name}</strong>
                    <span className="text-xs text-slate-400">{device.platform}</span>
                  </div>
                  <button onClick={() => handleRevokeDevice(device.id)} className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors">
                    Revoke
                  </button>
                </li>
              ))}
              {devices.length === 0 && <li className="py-3 text-sm text-slate-400">No devices registered.</li>}
            </ul>
            <button className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
              Register New Device
            </button>
          </section>

          {/* Sharing Section */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">Sharing Session</h2>
            
            {!isSharing ? (
              <div className="flex flex-col items-start gap-4">
                <p className="text-sm text-slate-400">Not currently sharing with others.</p>
                <div className="flex gap-3">
                  <button onClick={handleStartShare} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                    Start Sharing
                  </button>
                  <button className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                    Join Session
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-emerald-400 font-medium">You are sharing clipboard data.</p>
                <div>
                  <h3 className="text-sm font-semibold mb-2">Authorized Members:</h3>
                  <ul className="flex flex-col mb-4">
                    {shareMembers.length === 0 ? (
                      <li className="text-sm text-slate-400 italic">Waiting for members to join...</li>
                    ) : (
                      shareMembers.map(member => (
                        <li key={member.id} className="flex justify-between items-center py-2 border-b border-slate-700 last:border-0">
                          <span className="text-sm text-slate-200">{member.name}</span>
                          <button onClick={() => handleRevokeMember(member.id)} className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors">
                            Remove
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                  <button onClick={handleStopShare} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
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
