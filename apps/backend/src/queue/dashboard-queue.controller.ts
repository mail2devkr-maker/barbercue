import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  assignQueueEntrySchema,
  reassignQueueEntrySchema,
  staffStatusSchema,
  type AssignQueueEntryInput,
  type ReassignQueueEntryInput,
  type AuthenticatedUser,
  type StaffStatusInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { QueueService } from './queue.service';
import { StaffStatusService } from './staff-status.service';

@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_STAFF, Role.SALON_OWNER)
export class DashboardQueueController {
  constructor(
    private readonly queueService: QueueService,
    private readonly staffStatusService: StaffStatusService,
  ) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.queue}`)
  getQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.queueService.getDashboardQueue(user.id, salonId);
  }

  @Post(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.call}`)
  call(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.call(user.id, id);
  }

  @Post(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.assign}`)
  @Idempotent()
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignQueueEntrySchema))
    body: AssignQueueEntryInput,
  ) {
    return this.queueService.assign(user.id, id, body);
  }

  @Patch(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.reassign}`)
  reassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reassignQueueEntrySchema))
    body: ReassignQueueEntryInput,
  ) {
    return this.queueService.reassign(user.id, id, body);
  }

  @Post(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.noShow}`)
  noShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.noShow(user.id, id);
  }

  @Post(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.cancel}`)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.cancelByStaff(user.id, id);
  }

  @Post(`${DASHBOARD_PATHS.serviceSessions}/:id/${DASHBOARD_PATHS.complete}`)
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.completeSession(user.id, id);
  }

  @Patch(`${DASHBOARD_PATHS.staff}/:id/${DASHBOARD_PATHS.status}`)
  updateStaffStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(staffStatusSchema)) body: StaffStatusInput,
  ) {
    return this.staffStatusService.updateStatus(user, id, body.status);
  }

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.staff}/${DASHBOARD_PATHS.me}`)
  getMyStaffProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.staffStatusService.getMe(user.id, salonId);
  }
}
