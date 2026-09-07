/**
 * Log redaction, by allowlist.
 *
 * `SECURITY.md` forbids clipboard content, tokens, keys and passwords in logs. A denylist gets
 * this wrong the first time someone adds a field: the new field is logged by default, and nobody
 * notices until it is in a log aggregator. An allowlist fails the other way — a new field is
 * dropped until someone deliberately permits it.
 *
 * The control plane never receives clipboard content, so no field here could contain any. That is
 * the structural guarantee; this is the belt-and-braces one.
 */

/** Field names that may appear in a log record. Everything else is dropped. */
export const LOG_FIELD_ALLOWLIST = new Set([
  'timestamp',
  'level',
  'message',
  'context',
  'requestId',
  'correlationId',
  'method',
  'path',
  'route',
  'statusCode',
  'durationMs',
  'errorCode',
  'errorCategory',
  'userId',
  'deviceId',
  'sessionId',
  'platform',
  'appVersion',
  'protocolVersion',
  'rosterVersion',
  'peerCount',
  'connectionCount',
  'connectionDurationMs',
  'bytesTransferred',
  'messageType',
  'reason',
  'retryAfterSeconds',
  'limit',
  'remaining',
  'policy',
  'outcome',
  'count',
  'event',
  'ip',
]);

/**
 * Substrings that mark a value as sensitive no matter what it is called. This is a second line of
 * defence: the allowlist already drops unknown keys, but an allowlisted key holding an
 * accidentally-interpolated secret would otherwise slip through.
 */
const SENSITIVE_KEY_PATTERN =
  /(token|password|secret|credential|authorization|cookie|privatekey|passphrase|apikey|joincode|pairingcode|hash|payload|clipboard|content)/i;

export const REDACTED = '[redacted]';

export type LogValue = string | number | boolean | null | undefined;

export function redactLogFields(fields: Record<string, unknown>): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!LOG_FIELD_ALLOWLIST.has(key)) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = coerce(value);
  }
  return out;
}

function coerce(value: unknown): LogValue {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 512 ? value.slice(0, 512) + '…' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  // Objects, arrays, buffers and errors are never logged whole: that is how a payload leaks.
  return REDACTED;
}

/**
 * Last-resort scrubber for free-text log messages. An interpolated JWT or key is the realistic
 * accident; these patterns catch the shapes rather than trusting the caller.
 */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]'],
  [/\b[A-Za-z0-9_-]{43,}\b/g, '[redacted-token]'],
];

export function scrubMessage(message: string): string {
  let out = message;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
