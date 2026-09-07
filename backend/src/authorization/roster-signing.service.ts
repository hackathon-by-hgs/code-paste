import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  ED25519_RAW_KEY_BYTES,
  generateEd25519Seed,
  publicKeyFromPrivateRaw,
  sha256,
  signEd25519,
} from '../common/crypto';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { LoggerService } from '../observability/logger.service';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

export interface RosterSignature {
  algorithm: 'ed25519';
  keyId: string;
  value: string;
}

export interface RosterPublicKey {
  keyId: string;
  algorithm: 'ed25519';
  publicKey: string;
}

/**
 * Signs peer rosters (ADR-003).
 *
 * Signing happens over the **exact transmitted bytes**, not over a JSON object. Verifying a
 * signature on an object would require canonicalisation (RFC 8785), and across Rust, Swift and
 * Kotlin, divergent canonicalisation is a near-certain signature-bypass bug. Signing bytes removes
 * the failure class entirely: a verifier checks the signature over `payload` as received, and only
 * then parses it.
 */
@Injectable()
export class RosterSigningService implements OnModuleInit {
  private privateKeyRaw!: Buffer;
  private publicKeyRaw!: Buffer;
  private keyIdValue!: string;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: LoggerService,
  ) {
    this.load();
  }

  onModuleInit(): void {
    this.logger.info('roster signing key ready', { policy: this.keyIdValue });
  }

  private load(): void {
    const configured = this.config.roster.signingSecretKey;

    if (configured) {
      const raw = Buffer.from(configured, 'base64');
      if (raw.length !== ED25519_RAW_KEY_BYTES) {
        throw new Error('ROSTER_SIGNING_SECRET_KEY must decode to exactly 32 bytes.');
      }
      this.privateKeyRaw = raw;
    } else {
      // Development and test only. Configuration validation already refuses to boot production
      // without a configured key, because a key regenerated on restart would invalidate every
      // cached roster in the field.
      this.privateKeyRaw = generateEd25519Seed();
      this.logger.warn('roster signing key generated at boot; cached rosters will not survive restart');
    }

    this.publicKeyRaw = publicKeyFromPrivateRaw(this.privateKeyRaw);
    // Deterministic key id derived from the public key: no table, no bootstrap step, and rotation
    // works because verifiers match on `keyId` rather than assuming a single key.
    this.keyIdValue = 'cp_rk_' + encodeBase32(sha256(this.publicKeyRaw)).slice(0, 26);
  }

  get keyId(): string {
    return this.keyIdValue;
  }

  sign(payload: Buffer): RosterSignature {
    return {
      algorithm: 'ed25519',
      keyId: this.keyIdValue,
      value: signEd25519(this.privateKeyRaw, payload).toString('base64'),
    };
  }

  /** Public keys only. Served unauthenticated so an agent can verify a cached roster offline. */
  getPublicKeys(): RosterPublicKey[] {
    return [
      { keyId: this.keyIdValue, algorithm: 'ed25519', publicKey: this.publicKeyRaw.toString('base64') },
    ];
  }
}

function encodeBase32(bytes: Buffer): string {
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
  return out;
}
