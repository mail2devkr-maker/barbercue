import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  submitVerificationSchema,
  type AuthenticatedUser,
  type SubmitVerificationInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { VerificationService } from './verification.service';

// Owner-only — seeking verification (for the shop or for one barber) is a business decision, not
// an operational one. Mirrors DashboardReviewsController's own role restriction and rationale.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.verification}`)
  getForSalon(@CurrentUser() user: AuthenticatedUser, @Param('salonId') salonId: string) {
    return this.verification.getForSalon(user.id, salonId);
  }

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.verification}`)
  submitForSalon(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(submitVerificationSchema)) body: SubmitVerificationInput,
  ) {
    return this.verification.submitForSalon(user.id, salonId, body);
  }

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.staff}/:staffId/${DASHBOARD_PATHS.verification}`)
  getForStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.verification.getForStaff(user.id, salonId, staffId);
  }

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.staff}/:staffId/${DASHBOARD_PATHS.verification}`)
  submitForStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
    @Body(new ZodValidationPipe(submitVerificationSchema)) body: SubmitVerificationInput,
  ) {
    return this.verification.submitForStaff(user.id, salonId, staffId, body);
  }
}
