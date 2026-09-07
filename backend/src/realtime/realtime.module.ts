import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AUTHORIZATION_EVENT_PUBLISHER } from '../common/events';
import { ConnectionRegistry } from './connection-registry';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Binds the AuthorizationEventPublisher port to the gateway.
 *
 * Devices and share-sessions publish through the port and never import this module, so there is no
 * cycle — and swapping realtime for something else (or nothing) needs no change to any service.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    ConnectionRegistry,
    RealtimeGateway,
    { provide: AUTHORIZATION_EVENT_PUBLISHER, useExisting: RealtimeGateway },
  ],
  exports: [AUTHORIZATION_EVENT_PUBLISHER, RealtimeGateway, ConnectionRegistry],
})
export class RealtimeModule {}
