import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ADMIN_PATHS,
  Role,
  decideVerificationSchema,
  updateSalonStatusSchema,
  type AuthenticatedUser,
  type DecideVerificationInput,
  type UpdateSalonStatusInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminMonitoringService } from './admin-monitoring.service';
import { AdminVerificationService } from './admin-verification.service';
import { AdminSalonManagementService } from './admin-salon-management.service';
import { SalonActivationService } from '../salon-setup/salon-activation.service';

/** Authentication is global; authorization is admin-role only. Monitoring routes are read-only;
 * the verification routes (Phase 18) and shop deletion are this controller's mutating surfaces —
 * always a human admin's explicit action, never an automated one. */
@Controller(ADMIN_PATHS.admin)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(
    private readonly monitoring: AdminMonitoringService,
    private readonly verification: AdminVerificationService,
    private readonly salonManagement: AdminSalonManagementService,
    private readonly activation: SalonActivationService,
  ) {}

  @Get(ADMIN_PATHS.overview)
  overview() {
    return this.monitoring.getOverview();
  }

  @Get(ADMIN_PATHS.verification)
  listVerification(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.verification.list(status, cursor, limit);
  }

  @Get(`${ADMIN_PATHS.verification}/:id`)
  getVerification(@Param('id') id: string) {
    return this.verification.getOne(id);
  }

  @Post(`${ADMIN_PATHS.verification}/:id/${ADMIN_PATHS.startReview}`)
  startReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.verification.startReview(user.id, id);
  }

  @Post(`${ADMIN_PATHS.verification}/:id/${ADMIN_PATHS.decide}`)
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideVerificationSchema))
    body: DecideVerificationInput,
  ) {
    return this.verification.decide(
      user.id,
      id,
      body.decision,
      body.reviewNotes,
    );
  }

  @Delete(`${ADMIN_PATHS.shops}/:id`)
  deleteShop(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salonManagement.deleteSalon(user.id, id);
  }

  @Patch(`${ADMIN_PATHS.shops}/:id/${ADMIN_PATHS.status}`)
  updateShopStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSalonStatusSchema))
    body: UpdateSalonStatusInput,
  ) {
    return this.activation.updateStatusAsAdmin(user.id, id, body);
  }
}
