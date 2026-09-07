'use client';

import { useState, useEffect } from 'react';
import { login, logout, getCurrentUser } from '../api/auth';
import type { User } from '../api/types';

export const Header = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then(u => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    const u = await login();
    setUser(u);
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    await logout();
    setUser(null);
    setLoading(false);
  };

  return (
    <header className="flex justify-between items-center border-b border-white/20 px-8 py-4">
      <h1 className="text-xl font-bold tracking-tight uppercase">Clipboard</h1>
      <div className="flex items-center gap-4">
        {loading ? (
          <span className="text-sm text-neutral-400">Loading...</span>
        ) : user ? (
          <>
            <span className="text-sm text-neutral-400">{user.email}</span>
            <button 
              onClick={handleLogout}
              className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Log Out
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-neutral-400">Not logged in</span>
            <button 
              onClick={handleLogin}
              className="bg-white hover:bg-neutral-200 text-black px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors"
            >
              Log In
            </button>
          </>
        )}
      </div>
    </header>
  );
}
