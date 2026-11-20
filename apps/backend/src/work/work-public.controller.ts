import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { workJobSearchSchema } from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkEnabledGuard } from './work-enabled.guard';
import { WorkJobsService } from './work-jobs.service';

/**
 * Public marketplace browsing. Never returns employer contact details, worker data, check-in
 * codes or anything about unverified businesses or unfunded jobs. Works with no AI dependency.
 */
@Controller('work')
@UseGuards(WorkEnabledGuard)
export class WorkPublicController {
  constructor(private readonly jobs: WorkJobsService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.jobs.categories();
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get('jobs')
  search(
    @Query(new ZodValidationPipe(workJobSearchSchema))
    query: z.infer<typeof workJobSearchSchema>,
  ) {
    return this.jobs.search(query);
  }

  @Public()
  @Get('jobs/:jobId')
  detail(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.publicDetail(jobId);
  }
}
