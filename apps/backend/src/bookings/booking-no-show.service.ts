import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BookingStatus,
  LedgerReason,
  LedgerStatus,
  computeCancellationCharge,
  type CancellationPolicyDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CancellationPolicyService } from './cancellation-policy.service';

/**
 * STATE_MACHINES.md: "CONFIRMED --> NO_SHOW: customer never checks in within
 * appointmentArrivalGraceMinutes of slotStart." Distinct from booking-expiry.service.ts's
 * PENDING_PAYMENT timeout in every way that matters: the terminal state is NO_SHOW not EXPIRED,
 * the grace window is a per-salon CancellationPolicy setting (not a fixed platform constant) and
 * is measured from slotStart (not slotEnd or createdAt), and — per the cancellation flow's own
 * documented fork ("No-show follows the same fork... using noShowChargeType/noShowChargeValue
 * instead of the late-cancellation values") — a no-show owes the salon's configured no-show
 * charge, exactly like BookingsService.cancel() computes a late-cancellation charge, reusing the
 * identical shared computeCancellationCharge function with isNoShow=true.
 *
 * "Never checks in" is Booking.queueEntries being empty: a checked-in appointment gets a
 * QueueEntry (source=APPOINTMENT, see STATE_MACHINES.md's "Queue entry creation timing"), so once
 * that exists the booking's fate is tracked through the queue engine instead, never this sweep.
 *
 * Same claim-based sweep shape as booking-expiry.service.ts and RemindersService — the updateMany
 * re-checks status/slotStart/queueEntries inside its own where clause as the durable claim, so a
 * late check-in or a cancel/reschedule between the initial read and the write is silently skipped
 * rather than incorrectly overwritten.
 */
@Injectable()
export class BookingNoShowService {
  private readonly logger = new Logger(BookingNoShowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellationPolicy: CancellationPolicyService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    const count = await this.markOverdueNoShows();
    if (count > 0) this.logger.log(`Marked ${count} booking(s) as no-show.`);
  }

  async markOverdueNoShows(): Promise<number> {
    const now = Date.now();

    // Broad candidate read: any CONFIRMED, never-checked-in booking whose slot has already
    // started. The salon-specific grace check happens per candidate below — appointmentArrivalGraceMinutes
    // varies per salon, so it can't be expressed as a single WHERE cutoff across every row.
    const candidates = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        slotStart: { lt: new Date(now) },
        queueEntries: { none: {} },
      },
      select: {
        id: true,
        salonId: true,
        customerId: true,
        slotStart: true,
        service: { select: { price: true } },
        salon: { select: { ownerUserId: true } },
      },
    });

    if (candidates.length === 0) return 0;

    // One policy lookup per salon per run, not per booking — getEffectivePolicy falls back to the
    // platform-default row, which is the common case for most salons.
    const policyCache = new Map<string, CancellationPolicyDto>();
    async function policyFor(
      this: BookingNoShowService,
      salonId: string,
    ): Promise<CancellationPolicyDto> {
      const cached = policyCache.get(salonId);
      if (cached) return cached;
      const policy = await this.cancellationPolicy.getEffectivePolicy(salonId);
      policyCache.set(salonId, policy);
      return policy;
    }

    let markedCount = 0;
    for (const booking of candidates) {
      const policy = await policyFor.call(this, booking.salonId);
      const graceMs = policy.appointmentArrivalGraceMinutes * 60_000;
      if (booking.slotStart.getTime() + graceMs > now) continue; // not yet overdue for this salon

      const chargeAmount = computeCancellationCharge(
        policy,
        Number(booking.service.price),
        0, // unused by the isNoShow branch — see computeCancellationCharge
        true,
      );

      const result = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: BookingStatus.CONFIRMED,
            queueEntries: { none: {} },
          },
          data: {
            status: BookingStatus.NO_SHOW,
            cancellationChargeAmount: chargeAmount,
          },
        });
        if (claim.count === 0) return false;

        if (chargeAmount > 0) {
          await tx.customerLedgerEntry.create({
            data: {
              customerId: booking.customerId,
              salonId: booking.salonId,
              bookingId: booking.id,
              amount: chargeAmount,
              reason: LedgerReason.NO_SHOW_CHARGE,
              status: LedgerStatus.OUTSTANDING,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: 'BOOKING_NO_SHOW',
            entityType: 'Booking',
            entityId: booking.id,
            metadata: {
              chargeAmount,
              appointmentArrivalGraceMinutes: policy.appointmentArrivalGraceMinutes,
            },
          },
        });

        await this.notifications.notifyInTransaction(
          tx,
          booking.customerId,
          'booking.no_show',
          { salonId: booking.salonId },
          'account/bookings',
        );
        await this.notifications.notifyInTransaction(
          tx,
          booking.salon.ownerUserId,
          'owner.booking.no_show',
          { salonId: booking.salonId, bookingId: booking.id },
          `dashboard/salons/${booking.salonId}/bookings`,
        );
        return true;
      });

      if (result) {
        markedCount += 1;
        this.realtime.emitBookingNoShow(booking.salonId, booking.id);
      }
    }

    return markedCount;
  }
}
