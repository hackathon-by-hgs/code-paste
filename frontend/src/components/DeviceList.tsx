'use client';

import { useState, useEffect } from 'react';
import { getDevices, registerDevice, revokeDevice } from '../api/devices';
import type { Device } from '../api/types';

export const DeviceList = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDevices().then(data => {
      setDevices(data);
      setLoading(false);
    });
  }, []);

  const handleRegister = async () => {
    setLoading(true);
    const newDevice = await registerDevice();
    setDevices(prev => [...prev, newDevice]);
    setLoading(false);
  };

  const handleRevokeDevice = async (id: string) => {
    if (confirm("Are you sure you want to revoke this device? It will stop syncing immediately.")) {
      await revokeDevice(id);
      setDevices(prev => prev.filter(d => d.id !== id));
    }
  };

  return (
    <section className="px-8 py-6 flex flex-col gap-4">
      <div className="border-b border-white/20 pb-3 flex justify-between items-center">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">My Devices</h2>
        <button 
          onClick={handleRegister}
          disabled={loading}
          className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          + Register
        </button>
      </div>
      
      {loading && devices.length === 0 ? (
        <p className="text-sm text-neutral-500 py-3">Loading devices...</p>
      ) : (
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
      )}
    </section>
  );
}
