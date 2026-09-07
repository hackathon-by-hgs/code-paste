import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { AuthorizationModule } from './authorization/authorization.module';
import { ConfigModule } from './config/config.module';
import { DevicesModule } from './devices/devices.module';
import { HealthController } from './http/health.controller';
import { RequestContextMiddleware } from './http/request-context.middleware';
import { ObservabilityModule } from './observability/observability.module';
import { PersistenceModule } from './persistence/persistence.module';
import { ProtocolModule } from './protocol/protocol.module';
import { RateLimitGuard } from './rate-limiting/rate-limit.guard';
import { RateLimitingModule } from './rate-limiting/rate-limiting.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ShareSessionsModule } from './share-sessions/share-sessions.module';

@Module({
  imports: [
    // First: everything below resolves APP_CONFIG and CLOCK from it.
    ConfigModule,
    ObservabilityModule,
    PersistenceModule,
    RateLimitingModule,
    ProtocolModule,
    AuthModule,
    RealtimeModule,
    AuthorizationModule,
    DevicesModule,
    ShareSessionsModule,
  ],
  controllers: [HealthController],
  providers: [
    /**
     * Global guard order is registration order, and it matters.
     *
     * RateLimitGuard runs FIRST so that requests rejected by authentication are still counted.
     * If AuthGuard ran first, an attacker could brute-force tokens without ever incurring a rate
     * limit, because the request would never reach the limiter. Pre-authentication bucketing is by
     * IP, which is the correct granularity for brute-force and denial-of-service defence.
     *
     * AuthGuard then establishes the principal. Rate limiting is a volume control and never a
     * substitute for the authorization that follows it.
     */
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
