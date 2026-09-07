import { Global, Module } from '@nestjs/common';
import { ProtocolController } from './protocol.controller';
import { ProtocolService } from './protocol.service';

@Global()
@Module({
  controllers: [ProtocolController],
  providers: [ProtocolService],
  exports: [ProtocolService],
})
export class ProtocolModule {}
