import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, internal, payloadTooLarge, type ErrorCode } from '../common/errors';
import { routePathOf } from '../common/route-path';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';

interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Array<{ path: string; message: string }>;
    requestId?: string;
  };
}

/**
 * The single exit point for every failure.
 *
 * Anything that is not an AppError becomes a bare `internal` with a fixed message. That is the
 * rule that stops a Postgres driver error, a stack trace, or an interpolated secret reaching a
 * client — `API_CONTRACTS.md`: no internal stack traces, no private data leakage.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId;

    const appError = this.toAppError(exception);

    this.metrics.increment('http_errors_total', { code: appError.code, status: appError.status });

    // 5xx is our bug; 4xx is the client's. Only the former is worth an error-level record, and
    // neither logs the request body.
    const level = appError.status >= 500 ? 'error' : 'warn';
    const fields = {
      requestId,
      method: request.method,
      path: routePathOf(request),
      statusCode: appError.status,
      errorCode: appError.code,
      ...appError.logContext,
    };
    if (level === 'error') {
      this.logger.error(appError.message, fields);
      // The original throw site, kept for diagnosis but never sent to the client.
      if (exception instanceof Error && exception.stack) {
        this.logger.debug('unhandled exception', { requestId, errorCategory: exception.name });
      }
    } else {
      this.logger.warn(appError.message, fields);
    }

    const body: ErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };

    if (appError.code === 'rate_limited') {
      const retryAfter = appError.logContext?.retryAfterSeconds;
      if (typeof retryAfter === 'number') response.setHeader('Retry-After', String(retryAfter));
    }

    response.status(appError.status).json(body);
  }

  private toAppError(exception: unknown): AppError {
    if (exception instanceof AppError) return exception;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Nest's own failures (404 on an unknown route, 413 from the body parser) still have to
      // speak our error vocabulary, or clients would face two different error shapes.
      const code: ErrorCode =
        status === 404
          ? 'not_found'
          : status === 413
            ? 'payload_too_large'
            : status === 401
              ? 'unauthenticated'
              : status === 403
                ? 'forbidden'
                : status >= 500
                  ? 'internal'
                  : 'invalid_request';
      const message = status >= 500 ? 'An unexpected error occurred.' : exception.message;
      return new AppError(code, status, message);
    }

    /**
     * body-parser rejects an oversized or unparseable body by throwing a plain Error carrying a
     * numeric `status` — not an HttpException. Without this branch those became a generic 500,
     * which means hostile input produced an "unexpected error" instead of a deterministic
     * rejection (`SPEC_CONTRACT.md` §18). The message is discarded either way, so nothing about
     * the request is echoed back.
     */
    if (isStatusCarryingError(exception)) {
      const status = exception.status ?? exception.statusCode ?? 500;
      if (status === 413) return payloadTooLarge();
      if (status >= 400 && status < 500) {
        return new AppError('invalid_request', 400, 'Request body could not be parsed.');
      }
    }

    // Unknown: deliberately opaque.
    return internal();
  }
}

interface StatusCarryingError {
  status?: number;
  statusCode?: number;
}

/** Detects framework errors (notably body-parser's) that carry an HTTP status but are not HttpExceptions. */
function isStatusCarryingError(error: unknown): error is StatusCarryingError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as StatusCarryingError;
  return typeof candidate.status === 'number' || typeof candidate.statusCode === 'number';
}
