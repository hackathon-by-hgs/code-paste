/**
 * The single HTTP path to the control plane.
 *
 * Responsibilities, all of them contract-mandated:
 *   - attach the bearer access token
 *   - normalise every failure into an `ApiError` carrying a stable `code`
 *   - refresh an expired access token exactly once, under a single-flight lock
 *
 * The refresh call is a bare `fetch` rather than a `request()` recursion: a
 * refresh must never be able to trigger another refresh, and `/auth/refresh`
 * is unauthenticated (it carries the refresh token in its body).
 */

import { apiBaseUrl, CLIENT_ID } from './config';
import { ApiError, type ErrorCode, type ErrorDetail } from './errors';
import { clearTokens, getTokens, setTokens, type Tokens } from './tokens';

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Send the bearer token. Defaults to true. */
  auth?: boolean;
  signal?: AbortSignal;
}

const buildUrl = (path: string, query?: Record<string, QueryValue>): string => {
  const url = new URL(`${apiBaseUrl()}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const parseRetryAfter = (res: Response): number | undefined => {
  const raw = res.headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
};

/**
 * Reads the API's error envelope. A non-JSON body (gateway HTML, empty 502)
 * still has to become a typed error, so it degrades to `internal`.
 */
const toApiError = async (res: Response): Promise<ApiError> => {
  const retryAfter = parseRetryAfter(res);
  let code: ErrorCode = 'internal';
  let message = `Request failed with status ${res.status}.`;
  let details: ErrorDetail[] | undefined;
  let requestId: string | undefined;

  try {
    const body = (await res.json()) as {
      error?: { code?: ErrorCode; message?: string; details?: ErrorDetail[]; requestId?: string };
    };
    if (body?.error) {
      if (body.error.code) code = body.error.code;
      if (body.error.message) message = body.error.message;
      details = body.error.details;
      requestId = body.error.requestId;
    }
  } catch {
    // Body was absent or not JSON; the status-derived defaults above stand.
  }

  return new ApiError({ code, message, status: res.status, details, requestId, retryAfter });
};

// --- single-flight refresh -------------------------------------------------

let refreshInFlight: Promise<Tokens> | null = null;

const performRefresh = async (refreshToken: string): Promise<Tokens> => {
  // Built outside the try: a config error is a bug to surface, not a network blip.
  const url = buildUrl('/auth/refresh');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CodePaste-Client': CLIENT_ID },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    throw new ApiError({ code: 'network', message: 'Network request failed.', status: 0 });
  }

  if (!res.ok) throw await toApiError(res);

  const pair = (await res.json()) as Tokens;
  const next: Tokens = {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    expiresIn: pair.expiresIn,
  };
  setTokens(next);
  return next;
};

/**
 * Serialises refreshes. Two concurrent `/auth/refresh` calls with the same token
 * make the second one a *reuse*, and the server revokes the whole family and
 * logs the user out (ADR-004). Every caller therefore awaits one shared promise.
 */
const refreshOnce = (): Promise<Tokens> => {
  if (refreshInFlight) return refreshInFlight;

  const tokens = getTokens();
  if (!tokens) {
    return Promise.reject(
      new ApiError({ code: 'unauthenticated', message: 'Not signed in.', status: 401 }),
    );
  }

  refreshInFlight = performRefresh(tokens.refreshToken)
    .catch((err: unknown) => {
      // Any refresh failure ends the session: the family is gone or was never valid.
      clearTokens();
      throw err;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
};

// --- the request path ------------------------------------------------------

const send = async (path: string, options: RequestOptions, token: string | null): Promise<Response> => {
  const { method = 'GET', body, query, signal } = options;

  const headers: Record<string, string> = { 'X-CodePaste-Client': CLIENT_ID };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  // Built outside the try so a missing NEXT_PUBLIC_API_URL surfaces as the
  // configuration error it is, rather than as "check your connection".
  const url = buildUrl(path, query);

  try {
    return await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({ code: 'network', message: 'Network request failed.', status: 0 });
  }
};

/**
 * Performs a request, refreshing and retrying once on an expired access token.
 *
 * Unknown response fields are preserved, not stripped: new optional fields ship
 * inside /v1 (ADR-008), and a strict decoder here would break the app on a
 * backend deploy.
 */
export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const useAuth = options.auth !== false;
  let res = await send(path, options, useAuth ? (getTokens()?.accessToken ?? null) : null);

  if (res.status === 401 && useAuth && getTokens()) {
    const err = await toApiError(res);

    // A reused token is a compromise signal — wipe and stop, never retry.
    if (err.code === 'token_reused') {
      clearTokens();
      throw err;
    }

    if (err.code === 'token_expired' || err.code === 'unauthenticated') {
      const refreshed = await refreshOnce(); // throws (and clears) if the family is dead
      res = await send(path, options, refreshed.accessToken);
    } else {
      throw err;
    }
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
};

/** For endpoints whose success is `204 No Content`. */
export const requestVoid = async (path: string, options: RequestOptions = {}): Promise<void> => {
  await request<undefined>(path, options);
};

/** Test seam: drops any in-flight refresh so cases cannot bleed into each other. */
export const __resetHttpState = (): void => {
  refreshInFlight = null;
};
