import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ARRIVAL_ALERT_LEAD_MINUTES,
  BookingStatus,
  computeCancellationCharge,
  decimalStringToPaise,
  paiseToRupees,
  summarizeServiceNames,
  type ArrivalAlertDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { resolveEffectiveBookingServices } from './effective-booking-services';

const arrivalCandidateSelect = {
  id: true,
  salonId: true,
  slotStart: true,
  serviceId: true,
  service: { select: { name: true, durationMinutes: true, price: true } },
  services: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      serviceId: true,
      serviceName: true,
      durationMinutes: true,
      price: true,
    },
  },
  salon: { select: { ownerUserId: true, currency: true } },
};

/**
 * Requirement 3 (arrival alert, P0 mission) — deliberately split from BookingNoShowService: this
 * service never terminalizes a booking, it only (a) computes the LIVE, always-recomputable "which
 * bookings need an arrival check right now" read (`getEligibleAlerts`, requirement 15 — a client
 * that reconnects/hard-refreshes recovers this from backend truth, never from a one-shot event it
 * might have missed) and (b) fires the one-time T-5-minute nudge exactly once per booking
 * (`sendDueAlerts`, deduped via Booking.arrivalAlertSentAt — same claim shape as
 * RemindersService.sendDueReminders' reminderSentAt).
 */
@Injectable()
export class ArrivalAlertsService {
  private readonly logger = new Logger(ArrivalAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellationPolicy: CancellationPolicyService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly pushDispatch: PushDispatchService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const count = await this.sendDueAlerts();
    if (count > 0) this.logger.log(`Sent ${count} arrival alert(s).`);
  }

  /** The actual sweep logic, separated from the @Cron wrapper for direct unit testing, same
   * pattern as BookingNoShowService/RemindersService. Returns how many alerts were sent. */
  async sendDueAlerts(): Promise<number> {
    const now = Date.now();
    const dueBefore = new Date(now + ARRIVAL_ALERT_LEAD_MINUTES * 60_000);

    const candidates = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CONFIRMED,
        arrivalAlertSentAt: null,
        slotStart: { lte: dueBefore },
        queueEntries: { none: {} },
      },
      select: arrivalCandidateSelect,
    });

    let sentCount = 0;
    for (const booking of candidates) {
      const serviceName = summarizeServiceNames(
        resolveEffectiveBookingServices(booking).map((s) => s.serviceName),
      );

      const claimed = await this.prisma.$transaction(async (tx) => {
        // Same durable-claim shape as every other sweep in this codebase: only one concurrent run
        // (or an overlapping manual retry) can flip arrivalAlertSentAt from null, so a duplicate
        // scheduler tick can never send the same logical alert twice.
        const claim = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: BookingStatus.CONFIRMED,
            arrivalAlertSentAt: null,
            slotStart: { lte: dueBefore },
            queueEntries: { none: {} },
          },
          data: { arrivalAlertSentAt: new Date(now) },
        });
        if (claim.count === 0) return false;

        // Supplemental only: the Notification Center entry follows the user's ARRIVAL_ALERTS in-app
        // preference (notifyInTransaction returns false when they turned it off). Its outcome must
        // NOT decide whether the mandatory alert is dispatched, so it is deliberately ignored here.
        await this.notifications.notifyInTransaction(
          tx,
          booking.salon.ownerUserId,
          'owner.booking.arrival_check',
          {
            type: 'booking.arrival_check',
            salonId: booking.salonId,
            bookingId: booking.id,
            serviceName,
            slotStart: booking.slotStart.toISOString(),
          },
          `dashboard/salons/${booking.salonId}/bookings`,
        );
        return true;
      });

      if (claimed) {
        sentCount += 1;
        // The critical arrival prompt: ALWAYS dispatched once the booking is claimed, whatever the
        // user's notification preferences say. Realtime wakes a connected app; the push is the
        // transport that can wake a backgrounded, locked or killed one (native full-screen alert).
        this.realtime.emitBookingArrivalAlert(booking.salonId, booking.id);
        // Fire-and-forget, same convention as bookings.service.ts's own push call sites - a push
        // failure must never affect the alert sweep itself. IDs and non-PII operational fields only:
        // no customer name, phone or email ever goes into this payload.
        void this.pushDispatch.dispatchLocalizedToUser(
          booking.salon.ownerUserId,
          'arrivalCheck',
          serviceName,
          {
            type: 'booking.arrival_check',
            salonId: booking.salonId,
            bookingId: booking.id,
            slotStart: booking.slotStart.toISOString(),
            serviceName,
          },
        );
      }
    }

    return sentCount;
  }

  /**
   * Requirement 15's "reconstruct eligibility from backend truth" read. Never trusts client
   * state or the one-shot sweep event — a booking is eligible for exactly as long as it stays
   * CONFIRMED with no QueueEntry and within ARRIVAL_ALERT_LEAD_MINUTES of its slot, regardless of
   * whether/when the sweep above already sent its one-time nudge for it.
   */
  async getEligibleAlerts(userId: string, salonId: string): Promise<ArrivalAlertDto[]> {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const policy = await this.cancellationPolicy.getEffectivePolicy(salonId);
    const now = Date.now();
    const graceMs = policy.appointmentArrivalGraceMinutes * 60_000;

    const bookings = await this.prisma.booking.findMany({
      where: {
        salonId,
        status: BookingStatus.CONFIRMED,
        queueEntries: { none: {} },
        slotStart: { lte: new Date(now + ARRIVAL_ALERT_LEAD_MINUTES * 60_000) },
      },
      select: arrivalCandidateSelect,
      orderBy: { slotStart: 'asc' },
    });

    return bookings.map((booking): ArrivalAlertDto => {
      const effectiveServices = resolveEffectiveBookingServices(booking);
      const serviceName = summarizeServiceNames(effectiveServices.map((s) => s.serviceName));
      const graceExpired = booking.slotStart.getTime() + graceMs <= now;
      const appointmentPrice = paiseToRupees(
        effectiveServices.reduce(
          (sum, s) => sum + decimalStringToPaise(s.price.toString()),
          0,
        ),
      );
      return {
        bookingId: booking.id,
        salonId: booking.salonId,
        slotStart: booking.slotStart.toISOString(),
        serviceName,
        // Never a real name — no canonical customer display name exists in this product (User has
        // only phone/email). See ArrivalAlertDto's own doc comment.
        customerDisplayName: serviceName ? `Your ${serviceName} customer` : 'Your appointment customer',
        graceExpired,
        noShowChargePreview: graceExpired
          ? computeCancellationCharge(policy, appointmentPrice, 0, true)
          : null,
        currency: booking.salon.currency,
      };
    });
  }
}
