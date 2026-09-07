/**
 * Pairing code domain entity (ADR-005).
 *
 * Short-lived, single-use material that authorises exactly one action: bind one public key to one
 * account. It is never an access credential, and only its hash is stored.
 */
export interface PairingCode {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
}

export const isPairingCodeUsable = (code: PairingCode, now: Date): boolean =>
  code.consumedAt === null && code.expiresAt.getTime() > now.getTime();
