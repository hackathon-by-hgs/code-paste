import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { LoggerService } from '../observability/logger.service';
import { PAIRING_CODE_REPOSITORY, type PairingCodeRepository } from './repositories/pairing-code.repository';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from './repositories/refresh-token.repository';

/** Rows are kept past expiry only long enough to be useful for diagnosis. */
const RETENTION_GRACE_SECONDS = 24 * 60 * 60;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Deletes expired authorization material.
 *
 * Without this, `refresh_tokens` and `pairing_codes` grow forever: every login, every rotation and
 * every pairing attempt leaves a row that is useless the moment it expires. That is an unbounded
 * resource, and it is also a data-minimisation problem — `SECURITY.md` requires that temporary
 * material actually be temporary rather than merely ineffective.
 *
 * Deleting is safe because expiry is enforced at read time regardless: removing a row can never
 * grant access, only reclaim space. Nothing here touches clipboard data, because none is stored.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(PAIRING_CODE_REPOSITORY) private readonly pairingCodes: PairingCodeRepository,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      // Failures are logged and swallowed: housekeeping must never take the process down, and the
      // next sweep will retry.
      void this.sweep().catch((error: unknown) => {
        this.logger.warn('retention sweep failed', {
          errorCategory: error instanceof Error ? error.name : 'unknown',
        });
      });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Exposed so a test or an operator can run it deterministically rather than waiting an hour. */
  async sweep(): Promise<{ refreshTokens: number; pairingCodes: number }> {
    const cutoff = new Date(this.clock.nowMs() - RETENTION_GRACE_SECONDS * 1000);
    const removedTokens = await this.refreshTokens.deleteExpiredBefore(cutoff);
    const removedCodes = await this.pairingCodes.deleteExpiredBefore(cutoff);

    if (removedTokens > 0 || removedCodes > 0) {
      this.logger.info('retention sweep completed', { count: removedTokens + removedCodes });
    }
    return { refreshTokens: removedTokens, pairingCodes: removedCodes };
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
