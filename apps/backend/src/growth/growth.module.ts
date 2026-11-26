import { Module } from '@nestjs/common';
import { GrowthAdminController } from './growth.controller';
import { GrowthMatchingService } from './growth-matching.service';
import { GrowthService } from './growth.service';
import { ModelRouter } from './model-router';

/**
 * FastQue Growth AI — customer acquisition, advisory mode. Every route answers 404 unless
 * GROWTH_AI_ENABLED=true. No worker, scheduler or outbox is registered: nothing runs by itself.
 */
@Module({
  controllers: [GrowthAdminController],
  providers: [GrowthService, GrowthMatchingService, ModelRouter],
})
export class GrowthModule {}
