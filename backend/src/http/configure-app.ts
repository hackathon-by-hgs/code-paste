import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from '../config/configuration';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { LoggingInterceptor } from './logging.interceptor';

/**
 * Applied identically by `main.ts` and by the test harness.
 *
 * Tests therefore exercise the same filters, prefixes and body limits as production. A harness
 * that skipped this would be testing a different application than the one that ships — and the
 * differences would be exactly the security-relevant parts.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  const logger = app.get(LoggerService);
  const metrics = app.get(MetricsService);

  app.useLogger(logger);

  // API version lives in the URL path (ADR-008). `/v1` is applied here, once.
  app.setGlobalPrefix('v1');

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));

  // The control plane accepts nothing large: it never receives clipboard payloads, so a body over
  // 64 KiB is either a bug or an attempt to exhaust memory (SPEC_CONTRACT.md §10.8).
  app.useBodyParser('json', { limit: config.http.maxBodyBytes });

  app.useGlobalFilters(new AllExceptionsFilter(logger, metrics));
  app.useGlobalInterceptors(new LoggingInterceptor(logger, metrics));

  app.enableShutdownHooks();
}
