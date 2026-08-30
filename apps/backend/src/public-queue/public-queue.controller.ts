import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  BookingErrorCode,
  ChairStatus,
  DASHBOARD_PATHS,
  PUBLIC_QUEUE_PATHS,
  QueueEntryStatus,
  Role,
  StaffMemberStatus,
  joinQueueSchema,
  type AuthenticatedUser,
  type JoinQueueInput,
  type PublicQueueInfoDto,
  type PublicQueueQrDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { PublicQueueTokenService } from './public-queue-token.service';

// Same shape/intent as AUTH_THROTTLE and STYLE_ADVISOR_THROTTLE — this is a public, internet-
// reachable, queue-mutating endpoint, tighter than the app-wide default (60/60s).
const PUBLIC_QUEUE_JOIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
// Read-only token lookup — still tightened below the app-wide default as a mild deterrent against
// token-enumeration attempts, without being so tight it breaks a normal customer reloading the page.
const PUBLIC_QUEUE_INFO_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@Controller()
export class PublicQueueController {
  constructor(
    private readonly tokenService: PublicQueueTokenService,
    private readonly queueService: QueueService,
    private readonly salonAccess: SalonAccessService,
    private readonly prisma: PrismaService,
  ) {}

  // Public: resolves the QR token to safe, minimal salon info. Never returns Salon.id,
  // ownerUserId, or anything beyond what the join page needs.
  @Public()
  @Throttle(PUBLIC_QUEUE_INFO_THROTTLE)
  @Get(`${PUBLIC_QUEUE_PATHS.publicQueue}/:token`)
  async getInfo(@Param('token') token: string): Promise<PublicQueueInfoDto> {
    const salon = await this.tokenService.resolveToken(token);
    if (!salon) {
      // Identical error for "no such token" as every other not-found case elsewhere in the app —
      // no distinct message that would help an attacker distinguish a malformed token from a
      // syntactically valid but unknown one.
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'This queue link is no longer available.',
        HttpStatus.NOT_FOUND,
      );
    }

    const [services, waitingCount, activeChairCount, activeStaffCount] =
      await Promise.all([
        this.prisma.service.findMany({
          where: { salonId: salon.id, isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, durationMinutes: true },
        }),
        this.prisma.queueEntry.count({
          where: { salonId: salon.id, status: QueueEntryStatus.WAITING },
        }),
        this.prisma.chair.count({
          where: { salonId: salon.id, status: ChairStatus.ACTIVE },
        }),
        this.prisma.salonStaff.count({
          where: { salonId: salon.id, status: StaffMemberStatus.ACTIVE },
        }),
      ]);

    const { queueAvailable, unavailableReason } =
      this.tokenService.resolveQueueAvailability({
        status: salon.status,
        activeStaffCount,
        activeChairCount,
        activeServiceCount: services.length,
      });

    return {
      salonName: salon.name,
      queueAvailable,
      unavailableReason,
      services,
      waitingCount,
      // Deliberately not the full estimateWaitMinutes algorithm here (that's QueueService's own,
      // staff/chair-derived computation) — the public pre-join page only needs a coarse waiting
      // count; the real ETA appears via QueueStatusPanel/getActiveForCustomer after joining,
      // exactly like the existing authenticated walk-in flow.
      estimatedWaitMinutes: null,
    };
  }

  // Public route, but requires a real authenticated CUSTOMER — the customer completes phone-OTP
  // login (existing auth endpoints, unmodified) before this is ever called. The salon is derived
  // ONLY from the token, server-side; the request body carries no salonId, so a customer cannot
  // manipulate which salon's queue they join. Delegates straight to the existing, unmodified
  // QueueService.joinWalkIn — every capacity/duplicate/concurrency rule it already enforces
  // (including the SalonStatus.ACTIVE check inside AvailabilityService.getSalonOrThrow) applies
  // unchanged.
  @Roles(Role.CUSTOMER)
  @Throttle(PUBLIC_QUEUE_JOIN_THROTTLE)
  @Idempotent()
  @Post(`${PUBLIC_QUEUE_PATHS.publicQueue}/:token/${PUBLIC_QUEUE_PATHS.join}`)
  async join(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: JoinQueueInput,
  ) {
    const salon = await this.tokenService.resolveToken(token);
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'This queue link is no longer available.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.queueService.joinWalkIn(
      user.id,
      salon.id,
      body.serviceId,
      body.preferredStaffId,
    );
  }

  // Authenticated owner/staff endpoint — same authorization mechanism as every other dashboard
  // salon-scoped route (SalonAccessService.assertAccess), so an owner can only ever retrieve
  // their own salon's QR/URL, never another salon's.
  @Roles(Role.SALON_OWNER, Role.SALON_STAFF)
  @Get(
    `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.queueQr}`,
  )
  async getQueueQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ): Promise<PublicQueueQrDto> {
    await this.salonAccess.assertAccess(user.id, salonId);
    const publicQueueToken = await this.tokenService.getOrCreateToken(salonId);
    return {
      publicQueueToken,
      publicQueueUrl: this.tokenService.buildPublicQueueUrl(publicQueueToken),
    };
  }
}
