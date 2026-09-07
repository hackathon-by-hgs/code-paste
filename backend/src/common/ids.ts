import { randomBytes } from 'node:crypto';

/**
 * Opaque public identifiers.
 *
 * `API_CONTRACTS.md` requires that internal database ids never leak. Every entity therefore has a
 * prefixed, opaque public id that is stable, sortable and meaningless to a client.
 *
 * The encoding is Crockford base32 (lowercase), which deliberately omits i, l, o and u so an id
 * cannot be misread and cannot accidentally spell a word. 26 characters = 48 bits of timestamp
 * plus 80 bits of randomness, so ids sort chronologically without revealing a sequence — an
 * incrementing id would leak how many users or devices exist.
 */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const ID_BODY_LENGTH = 26;

export const ID_PREFIX = {
  user: 'cp_usr_',
  device: 'cp_dev_',
  session: 'cp_ses_',
  rosterKey: 'cp_rk_',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

function encodeBase32(bytes: Uint8Array, length: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.slice(0, length).padEnd(length, '0');
}

/** ULID-shaped body: 48-bit big-endian millisecond timestamp, then 80 random bits. */
function newIdBody(now: number): string {
  const buf = Buffer.alloc(16);
  buf.writeUIntBE(now, 0, 6);
  randomBytes(10).copy(buf, 6);
  return encodeBase32(buf, ID_BODY_LENGTH);
}

export function newId(prefix: IdPrefix, now: number = Date.now()): string {
  return prefix + newIdBody(now);
}

export const newUserId = (now?: number): string => newId(ID_PREFIX.user, now);
export const newDeviceId = (now?: number): string => newId(ID_PREFIX.device, now);
export const newSessionId = (now?: number): string => newId(ID_PREFIX.session, now);

/** Correlation id: no prefix, same alphabet. Carries no user data (SPEC_CONTRACT.md §11). */
export const newCorrelationId = (now: number = Date.now()): string => newIdBody(now);

const ID_PATTERN = new RegExp(`^[0-9a-hjkmnp-tv-z]{${ID_BODY_LENGTH}}$`);

export function isValidId(value: unknown, prefix: IdPrefix): value is string {
  return typeof value === 'string' && value.startsWith(prefix) && ID_PATTERN.test(value.slice(prefix.length));
}
