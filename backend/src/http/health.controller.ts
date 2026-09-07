import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { DatabaseService } from '../persistence/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Liveness and readiness.
   *
   * Reports the driver in use and nothing else about the deployment: a health endpoint is
   * unauthenticated, so it must not become a reconnaissance surface. No version numbers, no
   * hostnames, no connection strings.
   */
  @Get()
  @Public()
  health(): { status: 'ok'; driver: string } {
    return { status: 'ok', driver: this.database.driver };
  }
}
