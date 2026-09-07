/**
 * The single error vocabulary. Stable codes are a contract
 * (`contracts/openapi/control-plane.yaml` → ErrorCode); messages are for humans and may change
 * without a version bump, which is why clients are told to switch on `code`.
 */
export const ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'invalid_credentials',
  'token_expired',
  'token_reused',
  'forbidden',
  'not_found',
  'conflict',
  'device_revoked',
  'session_expired',
  'not_a_member',
  'payload_too_large',
  'unsupported_protocol_version',
  'rate_limited',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FieldError {
  path: string;
  message: string;
}

/**
 * Every failure leaving this process is an AppError. Anything else becomes a bare `internal` with
 * no detail, so a stack trace or a driver message can never reach a client
 * (`API_CONTRACTS.md`: no internal stack traces, no private data leakage).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: FieldError[];
  /** Safe, non-sensitive context for logs only. Never serialised into a response. */
  readonly logContext?: Record<string, string | number | boolean>;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options?: { details?: FieldError[]; logContext?: Record<string, string | number | boolean> },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = options?.details;
    this.logContext = options?.logContext;
  }
}

export const invalidRequest = (message: string, details?: FieldError[]): AppError =>
  new AppError('invalid_request', 400, message, { details });

export const unauthenticated = (message = 'Authentication required.'): AppError =>
  new AppError('unauthenticated', 401, message);

/** Deliberately identical for unknown email, wrong password and disabled account (ADR-004). */
export const invalidCredentials = (): AppError =>
  new AppError('invalid_credentials', 401, 'Email or password is incorrect.');

export const tokenExpired = (): AppError => new AppError('token_expired', 401, 'Token has expired.');

export const tokenReused = (): AppError =>
  new AppError('token_reused', 401, 'Refresh token was already used. All sessions have been revoked.');

export const forbidden = (message = 'Not permitted.'): AppError => new AppError('forbidden', 403, message);

export const notFound = (message = 'Not found.'): AppError => new AppError('not_found', 404, message);

export const conflict = (message: string): AppError => new AppError('conflict', 409, message);

export const deviceRevoked = (): AppError =>
  new AppError('device_revoked', 403, 'This device has been revoked.');

export const sessionExpired = (): AppError =>
  new AppError('session_expired', 409, 'This sharing session is no longer active.');

export const notAMember = (): AppError =>
  new AppError('not_a_member', 403, 'You are not a member of this session.');

export const payloadTooLarge = (): AppError =>
  new AppError('payload_too_large', 413, 'Request body is too large.');

export const unsupportedProtocolVersion = (supported: readonly number[]): AppError =>
  new AppError(
    'unsupported_protocol_version',
    422,
    'Unsupported protocol version. Supported: ' + supported.join(', ') + '.',
  );

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError('rate_limited', 429, 'Too many requests.', { logContext: { retryAfterSeconds } });

export const internal = (): AppError => new AppError('internal', 500, 'An unexpected error occurred.');
