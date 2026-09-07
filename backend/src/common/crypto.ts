import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomInt,
  sign as edSign,
  timingSafeEqual,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';

/**
 * Cryptographic primitives, all from Node's standard library.
 *
 * `RULES.md` §2.14: never implement custom encryption. Nothing here invents a scheme — this is
 * DER framing, hashing and constant-time comparison around primitives the runtime provides.
 */

// --- hashing ----------------------------------------------------------------------------------

export const sha256 = (input: Buffer | string): Buffer => createHash('sha256').update(input).digest();

export const sha256Hex = (input: Buffer | string): string => sha256(input).toString('hex');

/** Algorithm-prefixed digest, matching the contract pattern `^sha256:[0-9a-f]{64}$`. */
export const sha256Prefixed = (input: Buffer | string): string => 'sha256:' + sha256Hex(input);

// --- random material --------------------------------------------------------------------------

/** Opaque bearer material (refresh tokens). 32 bytes = 256 bits from a CSPRNG. */
export const randomTokenBase64Url = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/**
 * Human-transcribable code alphabet, Crockford-style: no I, L or O (misread as 1, 1 and 0) and no
 * U (so a code cannot spell an unfortunate word). 32 symbols x 8 characters = 40 bits.
 * Used for both pairing codes (ADR-005) and share-session join codes.
 */
const HUMAN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const HUMAN_CODE_LENGTH = 8;
export const HUMAN_CODE_PATTERN = /^[0-9A-HJ-NP-Z]{8}$/;

export function generateHumanCode(): string {
  let out = '';
  // randomInt is rejection-sampled, so the distribution stays uniform. `% length` on a random byte
  // would not be, and a biased code space is a smaller code space.
  for (let i = 0; i < HUMAN_CODE_LENGTH; i++) out += HUMAN_ALPHABET[randomInt(HUMAN_ALPHABET.length)];
  return out;
}

// --- constant-time comparison -----------------------------------------------------------------

/**
 * Compares two strings without leaking their relationship through timing. Both sides are hashed
 * first so that unequal lengths do not throw and do not leak length either.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

// --- Ed25519 ----------------------------------------------------------------------------------

/**
 * Ed25519 keys travel as 32 raw bytes, base64 — the same shape in every language. Node's key API
 * wants DER, so we frame the raw bytes with the fixed prefixes from RFC 8410. Keeping raw bytes in
 * the contract avoids forcing desktop and mobile to produce byte-identical DER.
 */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // SubjectPublicKeyInfo, 12 bytes
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // PrivateKeyInfo, 16 bytes
export const ED25519_RAW_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== ED25519_RAW_KEY_BYTES) {
    throw new Error('Ed25519 public key must be exactly 32 bytes.');
  }
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function privateKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== ED25519_RAW_KEY_BYTES) {
    throw new Error('Ed25519 private key must be exactly 32 bytes.');
  }
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: 'der', type: 'pkcs8' });
}

export function signEd25519(privateKeyRaw: Buffer, message: Buffer): Buffer {
  return edSign(null, message, privateKeyFromRaw(privateKeyRaw));
}

export function verifyEd25519(publicKeyRaw: Buffer, message: Buffer, signature: Buffer): boolean {
  if (signature.length !== ED25519_SIGNATURE_BYTES) return false;
  try {
    return edVerify(null, message, publicKeyFromRaw(publicKeyRaw), signature);
  } catch {
    // A malformed key must be a rejected signature, never a thrown 500.
    return false;
  }
}

/** Derives the raw public key from a raw private key (seed). */
export function publicKeyFromPrivateRaw(privateKeyRaw: Buffer): Buffer {
  const der = createPublicKey(privateKeyFromRaw(privateKeyRaw)).export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(SPKI_PREFIX.length));
}

export const generateEd25519Seed = (): Buffer => randomBytes(ED25519_RAW_KEY_BYTES);

/**
 * Validates a base64 Ed25519 public key, strictly.
 *
 * Base64 decoding in Node is lenient: it silently ignores invalid characters, so
 * `Buffer.from(x, 'base64')` alone would accept malformed input and produce a plausible-looking
 * key. Re-encoding and comparing is what makes this a real check — and this key becomes a device's
 * identity, so accepting a malformed one means accepting an unverifiable peer.
 */
export function decodeEd25519PublicKey(base64: string): Buffer | null {
  if (typeof base64 !== 'string' || base64.length !== 44 || !base64.endsWith('=')) return null;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(base64)) return null;
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== ED25519_RAW_KEY_BYTES) return null;
  if (raw.toString('base64') !== base64) return null;
  try {
    publicKeyFromRaw(raw); // must be a usable curve point
    return raw;
  } catch {
    return null;
  }
}

/** What LAN discovery advertises, and what a roster entry is matched on. */
export const keyFingerprint = (publicKeyRaw: Buffer): string => sha256Prefixed(publicKeyRaw);
