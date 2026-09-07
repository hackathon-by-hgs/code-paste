import { Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id password hashing (ADR-004).
 *
 * Parameters follow OWASP's 2024 guidance: 19 MiB memory, 2 iterations, parallelism 1. The
 * library generates a per-password random salt and encodes it in the output string, so there is
 * no salt handling to get wrong here.
 */
const OPTIONS = {
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
  algorithm: Algorithm.Argon2id,
} as const;

/**
 * A real Argon2id hash of a value no one will ever present.
 *
 * Used to equalise login timing when an email does not exist: without it, "unknown email" returns
 * in microseconds while "wrong password" takes ~50ms, and that difference is a reliable account
 * enumeration oracle regardless of what the response body says.
 */
let dummyHashPromise: Promise<string> | null = null;

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return hash(plaintext, OPTIONS);
  }

  async verify(passwordHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plaintext, OPTIONS);
    } catch {
      // A malformed or truncated stored hash is a failed login, never a 500.
      return false;
    }
  }

  /**
   * Performs equivalent work to a real verification and always fails.
   *
   * `AuthService.login` calls this when the user is absent, so both branches cost the same.
   */
  async verifyAgainstDummy(plaintext: string): Promise<false> {
    dummyHashPromise ??= hash('argon2id-timing-equalisation-placeholder', OPTIONS);
    await verify(await dummyHashPromise, plaintext, OPTIONS).catch(() => false);
    return false;
  }
}
