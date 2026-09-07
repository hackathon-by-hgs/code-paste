import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { forbidden } from '../common/errors';
import { isDevicePrincipal, type DevicePrincipal, type Principal } from './principal';

export const IS_PUBLIC = 'auth:public';
export const REQUIRES_DEVICE = 'auth:requires-device';

/**
 * Marks a route as unauthenticated.
 *
 * Authentication is on by default: `AuthGuard` is registered globally and every route requires a
 * token unless it opts out here. The inverse — remembering to add a guard to each protected route
 * — fails silently the first time someone forgets.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Restricts a route to device-bound tokens.
 *
 * Peer rosters, heartbeats and the realtime socket are device-only: a browser is not a clipboard
 * peer, and a stolen web session must not become one (ADR-004).
 */
export const RequireDevice = (): MethodDecorator & ClassDecorator => SetMetadata(REQUIRES_DEVICE, true);

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const request = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
  if (!request.principal) throw forbidden('No authenticated principal.');
  return request.principal;
});

export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DevicePrincipal => {
    const request = ctx.switchToHttp().getRequest<{ principal?: Principal }>();
    if (!request.principal || !isDevicePrincipal(request.principal)) {
      throw forbidden('This endpoint requires a device-bound token.');
    }
    return request.principal;
  },
);
