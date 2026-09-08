/**
 * The control plane returns one error shape everywhere (CLIENT_RESPONSES.md §8).
 * Clients switch on `code` and never on `message` — messages are for humans and
 * may be reworded without an API version bump.
 */

export type ErrorCode =
  | 'invalid_request'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'token_expired'
  | 'token_reused'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'device_revoked'
  | 'session_expired'
  | 'not_a_member'
  | 'payload_too_large'
  | 'unsupported_protocol_version'
  | 'rate_limited'
  | 'internal';

/** Client-side only: the request never reached the API (offline, DNS, CORS, abort). */
export type ClientErrorCode = 'network';

export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * Codes where retrying produces the identical outcome, so the UI must not offer
 * a retry affordance (CLIENT_RESPONSES.md §8).
 */
const TERMINAL: ReadonlySet<string> = new Set<ErrorCode>([
  'invalid_request',
  'forbidden',
  'device_revoked',
  'token_reused',
  'conflict',
  'not_found',
]);

/**
 * Codes that mean the session is unrecoverable and every stored token must go.
 * `token_reused` is a compromise signal, not a transient failure (ADR-004).
 */
const SESSION_FATAL: ReadonlySet<string> = new Set<ErrorCode>([
  'token_reused',
  'unauthenticated',
  'token_expired',
]);

export class ApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[];
  readonly requestId?: string;
  /** Seconds from a `Retry-After` header, when the API sent one. */
  readonly retryAfter?: number;

  constructor(init: {
    code: ErrorCode | ClientErrorCode;
    message: string;
    status: number;
    details?: ErrorDetail[];
    requestId?: string;
    retryAfter?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
  }

  get isTerminal(): boolean {
    return TERMINAL.has(this.code);
  }

  get isSessionFatal(): boolean {
    return SESSION_FATAL.has(this.code);
  }

  /** The validation message for one field, if the API flagged it. */
  detailFor(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

/**
 * Turns any thrown value into something safe to render. Unknown throwables
 * become a generic line rather than leaking a stack trace into the DOM.
 */
export const messageFor = (err: unknown, fallback = 'Something went wrong.'): string => {
  if (isApiError(err)) {
    if (err.code === 'network') {
      return 'Cannot reach the control plane. Check your connection and try again.';
    }
    return err.message || fallback;
  }
  return fallback;
};
