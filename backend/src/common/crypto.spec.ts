import {
  decodeEd25519PublicKey,
  generateEd25519Seed,
  generateHumanCode,
  HUMAN_CODE_PATTERN,
  keyFingerprint,
  publicKeyFromPrivateRaw,
  sha256Prefixed,
  signEd25519,
  timingSafeEqualString,
  verifyEd25519,
} from './crypto';

describe('crypto', () => {
  describe('sha256Prefixed', () => {
    it('matches the contract pattern and a known digest', () => {
      // Known SHA-256 of "hello", so a change in hashing is caught rather than silently accepted.
      // This is the same digest the `text-minimal` contract vector carries.
      expect(sha256Prefixed('hello')).toBe(
        'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      );
      expect(sha256Prefixed('hello')).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('Ed25519', () => {
    it('signs and verifies with a generated keypair', () => {
      const seed = generateEd25519Seed();
      const publicKey = publicKeyFromPrivateRaw(seed);
      const message = Buffer.from('synthetic roster payload');

      const signature = signEd25519(seed, message);
      expect(signature).toHaveLength(64);
      expect(verifyEd25519(publicKey, message, signature)).toBe(true);
    });

    it('rejects a signature over different bytes', () => {
      const seed = generateEd25519Seed();
      const publicKey = publicKeyFromPrivateRaw(seed);
      const signature = signEd25519(seed, Buffer.from('original'));

      expect(verifyEd25519(publicKey, Buffer.from('tampered'), signature)).toBe(false);
    });

    it('rejects a signature from a different key', () => {
      const message = Buffer.from('roster');
      const signature = signEd25519(generateEd25519Seed(), message);
      const otherPublicKey = publicKeyFromPrivateRaw(generateEd25519Seed());

      expect(verifyEd25519(otherPublicKey, message, signature)).toBe(false);
    });

    it('returns false rather than throwing on a malformed key or signature', () => {
      // A hostile peer must produce a rejected signature, never a 500.
      expect(verifyEd25519(Buffer.alloc(5), Buffer.from('m'), Buffer.alloc(64))).toBe(false);
      expect(
        verifyEd25519(publicKeyFromPrivateRaw(generateEd25519Seed()), Buffer.from('m'), Buffer.alloc(3)),
      ).toBe(false);
    });
  });

  describe('decodeEd25519PublicKey', () => {
    it('accepts a genuine key', () => {
      const publicKey = publicKeyFromPrivateRaw(generateEd25519Seed());
      const decoded = decodeEd25519PublicKey(publicKey.toString('base64'));
      expect(decoded).not.toBeNull();
      expect(decoded!.equals(publicKey)).toBe(true);
    });

    it('rejects lenient base64 that Buffer.from would happily accept', () => {
      // Node's base64 decoder silently ignores characters it does not understand. Whitespace
      // injected into a key still decodes to a full, plausible-looking 32 bytes, so a naive
      // `Buffer.from(x, 'base64').length === 32` check would accept it. Re-encoding and comparing
      // is what makes the check real.
      const valid = publicKeyFromPrivateRaw(generateEd25519Seed()).toString('base64');
      const whitespaceInjected = valid.slice(0, 20) + '\n' + valid.slice(20);

      expect(Buffer.from(whitespaceInjected, 'base64')).toHaveLength(32); // lenient decode "succeeds"
      expect(decodeEd25519PublicKey(whitespaceInjected)).toBeNull(); // strict check does not

      // A substituted invalid character silently loses a byte instead of failing.
      const substituted = '!' + valid.slice(1);
      expect(Buffer.from(substituted, 'base64')).toHaveLength(31);
      expect(decodeEd25519PublicKey(substituted)).toBeNull();
    });

    it('rejects wrong lengths, wrong padding and non-strings', () => {
      expect(decodeEd25519PublicKey('')).toBeNull();
      expect(decodeEd25519PublicKey('AAAA')).toBeNull();
      expect(decodeEd25519PublicKey('A'.repeat(44))).toBeNull(); // no '=' terminator
      expect(decodeEd25519PublicKey(Buffer.alloc(31).toString('base64'))).toBeNull();
      expect(decodeEd25519PublicKey(Buffer.alloc(33).toString('base64'))).toBeNull();
      expect(decodeEd25519PublicKey(undefined as unknown as string)).toBeNull();
    });
  });

  describe('keyFingerprint', () => {
    it('is stable and distinct per key', () => {
      const a = publicKeyFromPrivateRaw(generateEd25519Seed());
      const b = publicKeyFromPrivateRaw(generateEd25519Seed());

      expect(keyFingerprint(a)).toBe(keyFingerprint(a));
      expect(keyFingerprint(a)).not.toBe(keyFingerprint(b));
      expect(keyFingerprint(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('generateHumanCode', () => {
    it('matches the contract pattern', () => {
      for (let i = 0; i < 200; i++) expect(generateHumanCode()).toMatch(HUMAN_CODE_PATTERN);
    });

    it('never emits the ambiguous characters I, L, O or U', () => {
      // These are excluded so a code cannot be misread as 1/1/0, and cannot spell a word.
      const sample = Array.from({ length: 500 }, () => generateHumanCode()).join('');
      expect(sample).not.toMatch(/[ILOU]/);
    });

    it('does not repeat within a large sample', () => {
      const codes = new Set(Array.from({ length: 2000 }, () => generateHumanCode()));
      expect(codes.size).toBeGreaterThan(1990); // 40 bits of entropy; collisions should be absent
    });
  });

  describe('timingSafeEqualString', () => {
    it('compares equality correctly regardless of length', () => {
      expect(timingSafeEqualString('abc', 'abc')).toBe(true);
      expect(timingSafeEqualString('abc', 'abd')).toBe(false);
      // Different lengths must not throw — timingSafeEqual on raw buffers would.
      expect(timingSafeEqualString('a', 'a-much-longer-value')).toBe(false);
      expect(timingSafeEqualString('', '')).toBe(true);
    });
  });
});
