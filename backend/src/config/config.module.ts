import { Global, Module } from '@nestjs/common';
import { CLOCK, SystemClock } from '../common/clock';
import { APP_CONFIG, loadConfig } from './configuration';

/**
 * Global, and imported before everything else.
 *
 * Configuration and the clock are needed by the logger, the rate limiter, the token service and
 * the roster signer alike. Declaring them here rather than in AppModule means every module — not
 * just the root — can resolve them, and it gives the test harness a single provider to override
 * when it needs deterministic time.
 */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [APP_CONFIG, CLOCK],
})
export class ConfigModule {}
