'use client';

import { useState } from 'react';

export function SyncStatus() {
  const [isSyncing, setIsSyncing] = useState(true);

  const handleToggleSync = () => setIsSyncing(!isSyncing);

  return (
    <section className="px-8 py-6 flex flex-col gap-4">
      <div className="border-b border-white/20 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Sync Status</h2>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">{isSyncing ? 'Active' : 'Paused'}</span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            className="sr-only peer" 
            checked={isSyncing} 
            onChange={handleToggleSync} 
            aria-label="Toggle sync status"
          />
          <div className="w-11 h-6 bg-neutral-800 peer peer-checked:after:translate-x-full peer-checked:after:border-black after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white after:border after:h-5 after:w-5 after:transition-all peer-checked:bg-white"></div>
        </label>
      </div>
      <p className={`text-sm ${isSyncing ? 'text-white' : 'text-neutral-500'}`}>
        {isSyncing
          ? 'Your clipboard is being synced across all registered devices in real time.'
          : 'Sync is paused. Devices will not receive clipboard updates.'}
      </p>
    </section>
  );
}
