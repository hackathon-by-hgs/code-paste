'use client';

/**
 * Holds the signed-in user for the app.
 *
 * There is no "restore session on mount" step, and that is not an oversight:
 * tokens live in memory only (see `lib/tokens.ts`), so a reload genuinely starts
 * signed out. The provider still subscribes to the token store so that a session
 * killed deeper in the stack — a `token_reused` wipe inside `http.ts`, say —
 * propagates to the UI instead of leaving a stale user on screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { login as apiLogin, logout as apiLogout, signup as apiSignup } from '../../api/auth';
import type { User } from '../../api/types';
import { subscribe, isAuthenticated } from '../../lib/tokens';

interface AuthContextValue {
  user: User | null;
  /** True while a sign-in / sign-up / sign-out call is in flight. */
  pending: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [pending, setPending] = useState(false);

  // If the token store empties underneath us, the user is gone. Nothing else
  // in the app should have to remember to clear this.
  useEffect(
    () =>
      subscribe(() => {
        if (!isAuthenticated()) setUser(null);
      }),
    [],
  );

  const run = useCallback(async (action: () => Promise<User>) => {
    setPending(true);
    try {
      setUser(await action());
    } finally {
      setPending(false);
    }
  }, []);

  const signIn = useCallback(
    (email: string, password: string) => run(() => apiLogin(email, password)),
    [run],
  );

  const signUp = useCallback(
    (email: string, password: string) => run(() => apiSignup(email, password)),
    [run],
  );

  const signOut = useCallback(async () => {
    setPending(true);
    try {
      await apiLogout(); // clears tokens even if the network call fails
    } finally {
      setUser(null);
      setPending(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, pending, signIn, signUp, signOut }),
    [user, pending, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.');
  return ctx;
};
