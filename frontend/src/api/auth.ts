/**
 * Account identity and token lifecycle.
 *
 * Token *rotation* is not here — it lives in `lib/http.ts` behind a single-flight
 * lock, because every request may trigger it and only one may be in flight.
 */

import { request, requestVoid } from '../lib/http';
import { clearTokens, getTokens, setTokens } from '../lib/tokens';
import type { Me, TokenPair, User } from './types';

const adopt = (pair: TokenPair): User => {
  setTokens({
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
  });
  return pair.user;
};

/**
 * Creates an account. Unlike login, this *does* distinguish a duplicate email
 * (`409 conflict`) — signup is an account-existence oracle by nature, so hiding
 * it costs usability and conceals nothing.
 */
export const signup = async (email: string, password: string): Promise<User> => {
  const pair = await request<TokenPair>('/auth/signup', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  return adopt(pair);
};

/**
 * Exchanges credentials for tokens.
 *
 * A failure is always `invalid_credentials` — unknown email, wrong password and
 * disabled account are deliberately indistinguishable. Do not try to tell the
 * user which one it was; the API will not say.
 */
export const login = async (email: string, password: string): Promise<User> => {
  const pair = await request<TokenPair>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  return adopt(pair);
};

/**
 * Revokes the refresh-token family. Always succeeds (204 even for an unknown
 * token, so logout is not a validity oracle), so local state is cleared
 * unconditionally — including when the network call fails.
 */
export const logout = async (): Promise<void> => {
  const tokens = getTokens();
  try {
    if (tokens) {
      await requestVoid('/auth/logout', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
        auth: false,
      });
    }
  } finally {
    clearTokens();
  }
};

/** The authenticated principal. `principal` says whether this is a browser or device token. */
export const getMe = (): Promise<Me> => request<Me>('/auth/me');

/**
 * Resolves the current user, or null when there is no live session.
 * Returns null rather than throwing on an auth failure — "signed out" is an
 * ordinary state for this call, not an error.
 */
export const getCurrentUser = async (): Promise<User | null> => {
  if (!getTokens()) return null;
  try {
    const me = await getMe();
    return me.user;
  } catch {
    return null;
  }
};
