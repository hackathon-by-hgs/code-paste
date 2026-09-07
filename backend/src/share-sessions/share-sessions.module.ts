import { Module } from '@nestjs/common';
import { ShareSessionsController } from './share-sessions.controller';
import { ShareSessionsService } from './share-sessions.service';

@Module({
  controllers: [ShareSessionsController],
  providers: [ShareSessionsService],
  exports: [ShareSessionsService],
})
export class ShareSessionsModule {}
