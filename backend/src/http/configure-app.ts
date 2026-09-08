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

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  /**
   * CORS: a strict allowlist of exact origins.
   *
   * `credentials` is **false**, and that is a deliberate security property rather than an
   * oversight. Authentication is a Bearer token that the web app holds and attaches explicitly
   * (ADR-004); there are no cookies and therefore no ambient credentials for a cross-site request
   * to ride on. That is what makes this API structurally immune to CSRF, and enabling credentials
   * would give that up for nothing.
   *
   * **Web clients must not set `withCredentials` / `credentials: 'include'`** — the browser will
   * block the response. Send the `Authorization` header and nothing else.
   *
   * `origin` is an array, so Nest echoes back only a matching origin and omits the header
   * entirely for anything else. It never reflects an arbitrary `Origin`, which is the usual way a
   * CORS policy ends up decorative.
   */
  app.enableCors({
    origin: config.cors.allowedOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CodePaste-Client'],
    // Clients need these to correlate support requests, honour backoff, and notice deprecation.
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Deprecation', 'Sunset'],
    maxAge: 600,
  });

  // The control plane accepts nothing large: it never receives clipboard payloads, so a body over
  // 64 KiB is either a bug or an attempt to exhaust memory (SPEC_CONTRACT.md §10.8).
  app.useBodyParser('json', { limit: config.http.maxBodyBytes });

  app.useGlobalFilters(new AllExceptionsFilter(logger, metrics));
  app.useGlobalInterceptors(new LoggingInterceptor(logger, metrics));

  app.enableShutdownHooks();
}
