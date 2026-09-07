import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { ProtocolService, type ProtocolPolicy } from './protocol.service';

@Controller('protocol')
export class ProtocolController {
  constructor(private readonly protocol: ProtocolService) {}

  /**
   * Unauthenticated on purpose: a client must be able to discover whether it is compatible
   * *before* it tries to register, rather than learning it from a failure.
   *
   * Discloses only version numbers and size limits — nothing about users, devices or sessions.
   */
  @Get()
  @Public()
  getPolicy(): ProtocolPolicy {
    return this.protocol.getPolicy();
  }
}
