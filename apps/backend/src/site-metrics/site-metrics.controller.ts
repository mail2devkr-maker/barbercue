import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  SITE_METRICS_PATHS,
  siteVisitSchema,
  type SiteVisitInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SiteMetricsService } from './site-metrics.service';

@Controller(SITE_METRICS_PATHS.siteMetrics)
export class SiteMetricsController {
  constructor(private readonly metrics: SiteMetricsService) {}

  @Public()
  @Post(SITE_METRICS_PATHS.visit)
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordVisit(
    @Headers('user-agent') userAgent: string | undefined,
    @Body(new ZodValidationPipe(siteVisitSchema)) body: SiteVisitInput,
  ): Promise<void> {
    await this.metrics.recordUniqueVisitor(body.visitorId, userAgent);
  }
}
