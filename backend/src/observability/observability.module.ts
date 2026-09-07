import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [LoggerService, MetricsService],
  exports: [LoggerService, MetricsService],
})
export class ObservabilityModule {}
