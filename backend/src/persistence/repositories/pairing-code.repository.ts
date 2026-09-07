import type { PairingCode } from '../../devices/pairing-code.entity';
import type { Executor } from '../database.service';

export const PAIRING_CODE_REPOSITORY = Symbol('PAIRING_CODE_REPOSITORY');

export interface CreatePairingCodeInput {
  userId: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface PairingCodeRepository {
  create(input: CreatePairingCodeInput, ex?: Executor): Promise<PairingCode>;

  /**
   * Atomically consumes an unconsumed, unexpired code and returns it; returns null otherwise.
   *
   * This is a single conditional UPDATE (`WHERE consumed_at IS NULL AND expires_at > now`), not a
   * find-then-update. Two agents racing on the same code must produce exactly one registration —
   * a check-then-act would let both through and bind two devices from one authorisation.
   */
  consume(codeHash: string, now: Date, ex?: Executor): Promise<PairingCode | null>;

  deleteExpiredBefore(cutoff: Date, ex?: Executor): Promise<number>;
}
