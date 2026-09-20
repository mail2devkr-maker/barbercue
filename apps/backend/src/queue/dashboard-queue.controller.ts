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
import { BookingNoShowService } from '../bookings/booking-no-show.service';
import { ArrivalAlertsService } from '../bookings/arrival-alerts.service';

// PLATFORM_ADMIN allowed at the route level (Part 2 delegated shop management) —
// SalonAccessService.assertAccessOrAdminAccess inside every method below enforces ACTIVE-only +
// global-admin, and each mutation writes an AuditLog row under the real admin actor
// (QueueService.logAdminQueueAction) — a no-op for the ordinary staff/owner path.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_STAFF, Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class DashboardQueueController {
  constructor(
    private readonly queueService: QueueService,
    private readonly staffStatusService: StaffStatusService,
    private readonly bookingNoShowService: BookingNoShowService,
    private readonly arrivalAlertsService: ArrivalAlertsService,
  ) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.queue}`)
  getQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.queueService.getDashboardQueue(user.id, salonId);
  }

  // P0 arrival-alert mission — requirement 15's "reconstruct eligibility from backend truth" read,
  // used by the full-screen overlay on mount/reconnect/hard-refresh rather than trusting any
  // one-shot realtime event or client-cached state.
  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.arrivalAlerts}`)
  getArrivalAlerts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.arrivalAlertsService.getEligibleAlerts(user.id, salonId);
  }

  // P0 arrival-alert mission — owner/staff-triggered arrival confirmation (the ARRIVED action's
  // two-step confirmation dialog's actual backend call). Reuses QueueService.arriveAsOperator,
  // which converges on the exact same QueueEntry-creation path as customer self-check-in.
  @Post(`${DASHBOARD_PATHS.bookings}/:id/${DASHBOARD_PATHS.arrive}`)
  @Idempotent()
  arrive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.arriveAsOperator(user.id, id);
  }

  // P0 arrival-alert mission — the MANUAL no-show endpoint that replaces the removed automatic
  // sweep. Distinct route (`bookings/:id/no-show`) from the existing queue-entry no-show above
  // (`queue-entries/:id/no-show`) — the two operate on different domain objects and never collide.
  @Post(`${DASHBOARD_PATHS.bookings}/:id/${DASHBOARD_PATHS.noShow}`)
  @Idempotent()
  bookingNoShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingNoShowService.markNoShow(user.id, id);
  }

  // P0 arrival-alert mission — requirement 17's auditable correction for a booking that was
  // wrongly marked no-show.
  @Post(`${DASHBOARD_PATHS.bookings}/:id/${DASHBOARD_PATHS.correctNoShow}`)
  @Idempotent()
  correctNoShow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bookingNoShowService.correctToCompleted(user.id, id);
  }

  @Post(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.call}`)
  call(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.call(user.id, id);
  }

  // Live Queue operations mission — staff acknowledge a queue customer is physically in the shop.
  @Post(`${DASHBOARD_PATHS.queueEntries}/:id/${DASHBOARD_PATHS.arrive}`)
  markArrived(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.markArrived(user.id, id);
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

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.capacity}`)
  getCapacitySummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.queueService.getCapacitySummary(user.id, salonId);
  }
}
