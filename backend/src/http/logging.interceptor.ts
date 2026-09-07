import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { routePathOf } from '../common/route-path';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Records request duration and outcome.
 *
 * Logs the route *pattern* (`/v1/devices/:id`), never the concrete path: a path carries opaque
 * ids, and the pattern is what is actually useful for aggregation. No request body, no query
 * string and no headers are recorded — `SPEC_CONTRACT.md` §11.3 lists duration, status, endpoint
 * and error category as the safe set.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const started = Date.now();
    const route = routePathOf(request);

    return next.handle().pipe(
      tap({
        next: () => {
          const { statusCode } = context.switchToHttp().getResponse<{ statusCode: number }>();
          const durationMs = Date.now() - started;
          this.metrics.observeDuration('http_request_duration_ms', durationMs, {
            route,
            method: request.method,
          });
          this.metrics.increment('http_requests_total', { route, method: request.method, statusCode });
          this.logger.info('request completed', {
            requestId: request.requestId,
            method: request.method,
            route,
            statusCode,
            durationMs,
          });
        },
        // Failures are logged by AllExceptionsFilter, which has the mapped error code. Logging
        // them here too would double every error record.
      }),
    );
  }
}
