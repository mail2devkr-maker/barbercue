import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DASHBOARD_PATHS,
  Role,
  salonContactImportPreviewSchema,
  type AuthenticatedUser,
  type SalonContactImportPreviewDto,
  type SalonContactImportPreviewInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SalonContactImportPreviewService } from './salon-contact-import-preview.service';

const MAX_PREVIEW_REQUESTS = { default: { limit: 10, ttl: 60_000 } };

@Controller(
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.contacts}`,
)
@Roles(Role.SALON_OWNER)
export class SalonContactImportPreviewController {
  constructor(private readonly previews: SalonContactImportPreviewService) {}

  @Post('preview')
  @Throttle(MAX_PREVIEW_REQUESTS)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(salonContactImportPreviewSchema))
    body: SalonContactImportPreviewInput,
  ): Promise<SalonContactImportPreviewDto> {
    return this.previews.preview(user.id, salonId, body);
  }
}
