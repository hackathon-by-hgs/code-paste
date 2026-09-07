import { Controller, Get, Header } from '@nestjs/common';
import { CurrentDevice, Public, RequireDevice } from '../auth/decorators';
import type { DevicePrincipal } from '../auth/principal';
import { AuthorizationService, type SignedPeerRoster } from './authorization.service';

@Controller('authz')
export class AuthzController {
  constructor(private readonly authorization: AuthorizationService) {}

  /**
   * The endpoint the whole product turns on.
   *
   * Device-bound tokens only: a browser is not a clipboard peer, so a stolen web session cannot
   * obtain peer keys. `no-store` because a roster is authorization material — a cached copy in a
   * proxy would outlive the revocation it is supposed to reflect.
   */
  @Get('peer-set')
  @RequireDevice()
  @Header('Cache-Control', 'no-store')
  async peerSet(@CurrentDevice() principal: DevicePrincipal): Promise<SignedPeerRoster> {
    return this.authorization.buildSignedRoster(principal.user, principal.device);
  }

  /**
   * Public keys that verify a roster.
   *
   * Unauthenticated on purpose: an agent must be able to verify a cached roster precisely when it
   * cannot reach the API to authenticate. Contains public keys only.
   */
  @Get('roster-keys')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  rosterKeys() {
    return { keys: this.authorization.getSigningKeys() };
  }
}
