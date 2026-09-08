'use client';

import { useAuth } from '../features/auth/AuthProvider';

export const Header = () => {
  const { user, pending, signOut } = useAuth();

  return (
    <header className="flex justify-between items-center border-b border-white/20 px-4 sm:px-8 py-4">
      <h1 className="text-xl font-bold tracking-tight uppercase">Clipboard</h1>
      <div className="flex items-center gap-4">
        {user ? (
          <>
            <span className="text-sm text-neutral-400">{user.email}</span>
            <button
              onClick={() => void signOut()}
              disabled={pending}
              className="bg-transparent hover:bg-white text-white hover:text-black border border-white/40 hover:border-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            >
              Log Out
            </button>
          </>
        ) : (
          <span className="text-sm text-neutral-400">Not logged in</span>
        )}
      </div>
    </header>
  );
};
