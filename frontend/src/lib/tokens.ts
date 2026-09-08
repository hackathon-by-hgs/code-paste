/**
 * Token storage — deliberately in-memory only.
 *
 * CLIENT_RESPONSES.md §9 (Web checklist): "Never log or persist a token, pairing
 * code or join code." So there is no localStorage/sessionStorage/cookie write
 * here, and the consequence is real: a page reload ends the session and the user
 * logs in again. That is the contract's chosen trade — an access token is a
 * 10-minute credential and a refresh token is a 30-day one, and neither belongs
 * in a store that any XSS payload can read.
 *
 * This module is the single seam. If the project later adopts httpOnly refresh
 * cookies (a backend change), only this file and `http.ts` need to move.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, as reported at issue time. */
  expiresIn: number;
}

let current: Tokens | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const getTokens = (): Tokens | null => current;

export const getAccessToken = (): string | null => current?.accessToken ?? null;

export const setTokens = (next: Tokens): void => {
  current = next;
  emit();
};

export const clearTokens = (): void => {
  if (current === null) return;
  current = null;
  emit();
};

/** Subscribe to auth-state changes; returns an unsubscribe fn (useSyncExternalStore shape). */
export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isAuthenticated = (): boolean => current !== null;
