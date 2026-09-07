import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { rateLimited } from '../common/errors';
import { routePathOf } from '../common/route-path';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { RateLimitService, type RateLimitPolicy } from './rate-limit.service';

export const RATE_LIMIT_POLICY = 'rate-limit:policy';

export const RateLimit = (policy: RateLimitPolicy): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_POLICY, policy);

interface AuthenticatedRequest extends Request {
  principal?: { user: { publicId: string } };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const policy =
      this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT_POLICY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'default';

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const decision = this.limiter.consume(policy, identityOf(request));

    if (!decision.allowed) {
      this.metrics.increment('rate_limit_rejections_total', { policy });
      this.logger.warn('rate limit exceeded', {
        policy,
        retryAfterSeconds: decision.retryAfterSeconds,
        path: routePathOf(request),
      });
      throw rateLimited(decision.retryAfterSeconds);
    }
    return true;
  }
}

/**
 * Buckets by authenticated user when there is one, and by IP otherwise.
 *
 * Using the user id once authenticated means one abusive account cannot exhaust the budget of
 * everyone sharing its NAT, and cannot escape its own limit by rotating source addresses.
 *
 * The IP fallback trusts `req.ip`, which is only trustworthy because `trust proxy` is configured
 * explicitly at the edge; an unvalidated `X-Forwarded-For` would let a client pick its own bucket.
 */
function identityOf(request: AuthenticatedRequest): string {
  const userId = request.principal?.user.publicId;
  if (userId) return `u:${userId}`;
  return `ip:${request.ip ?? 'unknown'}`;
}
