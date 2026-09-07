import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { AuthzController } from './authz.controller';
import { RosterSigningService } from './roster-signing.service';

/**
 * Global so that HTTP controllers and the realtime gateway resolve the *same* AuthorizationService
 * instance — one authorization authority, not one per transport (ADR-006).
 */
@Global()
@Module({
  controllers: [AuthzController],
  providers: [AuthorizationService, RosterSigningService],
  exports: [AuthorizationService, RosterSigningService],
})
export class AuthorizationModule {}
