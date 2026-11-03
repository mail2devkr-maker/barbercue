import { Module } from '@nestjs/common';
import { SalonSetupModule } from '../salon-setup/salon-setup.module';
import { QueueModule } from '../queue/queue.module';
import { OwnerOpsModule } from '../owner-ops/owner-ops.module';
import { SalonsModule } from '../salons/salons.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { interpreterFromEnv } from './assistant-interpreter';
import { ASSISTANT_INTERPRETER } from './assistant-interpreter.token';

/** Action Assistant (issue #362): reuses the existing services, so their access checks and audit apply. */
@Module({
  imports: [SalonSetupModule, QueueModule, OwnerOpsModule, SalonsModule],
  controllers: [AssistantController],
  providers: [AssistantService, { provide: ASSISTANT_INTERPRETER, useFactory: interpreterFromEnv }],
})
export class AssistantModule {}
