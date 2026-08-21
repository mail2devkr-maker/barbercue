import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { PublicQueueController } from './public-queue.controller';
import { PublicQueueTokenService } from './public-queue-token.service';

@Module({
  // Reuses QueueModule's exported QueueService (joinWalkIn) — no second queue implementation.
  imports: [QueueModule],
  controllers: [PublicQueueController],
  providers: [PublicQueueTokenService],
})
export class PublicQueueModule {}
