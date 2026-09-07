import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, unauthenticated } from '../../common/errors';
import type { Principal } from '../principal';
import { AuthService } from '../auth.service';
import { IS_PUBLIC, REQUIRES_DEVICE } from '../decorators';
import { TokenService } from '../token.service';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

/**
 * Registered globally, so authentication is opt-out rather than opt-in.
 *
 * A route is protected unless it carries `@Public()`. The alternative — adding a guard per
 * controller — fails open the first time someone forgets, and an unauthenticated device endpoint
 * is exactly the failure this system cannot afford.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw unauthenticated();

    // Signature, algorithm, issuer, audience and expiry.
    const claims = this.tokens.verifyAccessToken(token);
    // Then the stateful checks a JWT cannot express: user still enabled, session version current,
    // device still registered and not revoked.
    const principal = await this.auth.resolvePrincipal(claims);
    request.principal = principal;

    const requiresDevice = this.reflector.getAllAndOverride<boolean>(REQUIRES_DEVICE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresDevice && principal.kind !== 'device') {
      throw forbidden('This endpoint requires a device-bound token.');
    }

    return true;
  }
}

/**
 * Strictly `Bearer <token>`.
 *
 * Case-insensitive on the scheme, but it rejects extra whitespace or extra parts rather than
 * trying to be helpful — lenient header parsing is how smuggled credentials get through.
 */
export function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts[1].trim();
  return token.length > 0 ? token : null;
}
