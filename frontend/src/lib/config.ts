/**
 * Resolution of the control-plane base URL.
 *
 * `NEXT_PUBLIC_API_URL` holds the *origin* (e.g. https://code-paste.onrender.com).
 * The API version lives in the path (`/v1`) per ADR-008, so it is appended here
 * rather than being baked into the env var — that keeps a `/v2` migration a
 * one-line change instead of a redeploy of every environment.
 */

const API_VERSION = 'v1';

/** `<domain>/<appVersion>`, sent as X-CodePaste-Client for diagnostics. */
export const CLIENT_ID = 'frontend/0.1.0';

const normalise = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  // Tolerate an env var that already carries the version suffix.
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/${API_VERSION}`;
};

/**
 * Throws rather than falling back to a default. A silent fallback to localhost
 * is how a build ships pointing at nothing; a loud failure is cheaper.
 */
export const apiBaseUrl = (): string => {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw || raw.trim() === '') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. Copy .env.example to frontend/.env.local and set it to the control-plane origin.',
    );
  }
  return normalise(raw);
};
