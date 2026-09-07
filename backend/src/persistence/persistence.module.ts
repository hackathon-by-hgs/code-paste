import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { RetentionService } from './retention.service';
import { DEVICE_REPOSITORY } from './repositories/device.repository';
import { DrizzleDeviceRepository } from './repositories/drizzle-device.repository';
import { DrizzlePairingCodeRepository } from './repositories/drizzle-pairing-code.repository';
import { DrizzleRefreshTokenRepository } from './repositories/drizzle-refresh-token.repository';
import { DrizzleShareSessionRepository } from './repositories/drizzle-share-session.repository';
import { DrizzleUserRepository } from './repositories/drizzle-user.repository';
import { PAIRING_CODE_REPOSITORY } from './repositories/pairing-code.repository';
import { REFRESH_TOKEN_REPOSITORY } from './repositories/refresh-token.repository';
import { SHARE_SESSION_REPOSITORY } from './repositories/share-session.repository';
import { USER_REPOSITORY } from './repositories/user.repository';

/**
 * Binds each repository port to its Drizzle adapter.
 *
 * Services inject the symbol, never the class, so swapping the storage engine is a change to this
 * file and one adapter — not to any business logic (ADR-007).
 */
@Global()
@Module({
  providers: [
    DatabaseService,
    RetentionService,
    { provide: USER_REPOSITORY, useClass: DrizzleUserRepository },
    { provide: DEVICE_REPOSITORY, useClass: DrizzleDeviceRepository },
    { provide: SHARE_SESSION_REPOSITORY, useClass: DrizzleShareSessionRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: DrizzleRefreshTokenRepository },
    { provide: PAIRING_CODE_REPOSITORY, useClass: DrizzlePairingCodeRepository },
  ],
  exports: [
    DatabaseService,
    RetentionService,
    USER_REPOSITORY,
    DEVICE_REPOSITORY,
    SHARE_SESSION_REPOSITORY,
    REFRESH_TOKEN_REPOSITORY,
    PAIRING_CODE_REPOSITORY,
  ],
})
export class PersistenceModule {}
