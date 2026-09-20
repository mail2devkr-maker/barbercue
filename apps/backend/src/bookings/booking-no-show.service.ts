import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  LedgerReason,
  LedgerStatus,
  computeCancellationCharge,
  decimalStringToPaise,
  paiseToRupees,
  type CancellationPolicyDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { lockBookingResolution } from './booking-resolution-lock';
import { resolveEffectiveBookingServices } from './effective-booking-services';

const noShowCandidateSelect = {
  id: true,
  salonId: true,
  customerId: true,
  slotStart: true,
  status: true,
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
  queueEntries: { select: { id: true }, take: 1 },
  salon: { select: { ownerUserId: true } },
};

/**
 * P0 production incident (2026-09-19, booking d3c70810-...): the previous version of this service
 * ran an unattended `@Cron` sweep that automatically flipped any CONFIRMED booking to NO_SHOW —
 * with a real financial charge — purely because `slotStart + appointmentArrivalGraceMinutes` had
 * elapsed and no QueueEntry existed. That is not proof of physical absence: a salon can serve a
 * customer without the customer ever using FastQue's own self-check-in. The booking above was
 * served in person and still got charged as a no-show ten minutes after its slot started.
 *
 * New rule, matching STATE_MACHINES.md's corrected diagram: CONFIRMED never auto-transitions to
 * NO_SHOW on a timer. It only becomes NO_SHOW through `markNoShow`, an explicit operator action
 * (owner/staff, gated by the exact same salon-access check as every other dashboard mutation),
 * itself only reachable once the arrival grace has genuinely elapsed AND no QueueEntry exists —
 * the automatic sweep's every other safety property (claim-based re-check, multi-service charge
 * math, ledger/audit/notification shape) is preserved here, just behind a human decision instead
 * of a timer. Detecting "overdue, still unconfirmed" and nudging an operator toward that decision
 * is ArrivalAlertsService's job now, not this service's.
 */
@Injectable()
export class BookingNoShowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellationPolicy: CancellationPolicyService,
    private readonly salonAccess: SalonAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async markNoShow(
    userId: string,
    bookingId: string,
  ): Promise<{ id: string; status: BookingStatus; chargeAmount: number }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: noShowCandidateSelect,
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.salonAccess.assertAccessOrAdminAccess(userId, booking.salonId);

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new AppException(
        BookingErrorCode.NO_SHOW_NOT_ELIGIBLE,
        'Only a confirmed booking can be marked no-show.',
        HttpStatus.CONFLICT,
      );
    }
    if (booking.queueEntries.length > 0) {
      throw new AppException(
        BookingErrorCode.NO_SHOW_NOT_ELIGIBLE,
        'This booking has already checked in and cannot be marked no-show.',
        HttpStatus.CONFLICT,
      );
    }

    const policy = await this.cancellationPolicy.getEffectivePolicy(booking.salonId);
    const graceMs = policy.appointmentArrivalGraceMinutes * 60_000;
    if (booking.slotStart.getTime() + graceMs > Date.now()) {
      throw new AppException(
        BookingErrorCode.NO_SHOW_NOT_ELIGIBLE,
        `No-show can only be confirmed after the ${policy.appointmentArrivalGraceMinutes}-minute arrival grace has elapsed.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const chargeAmount = this.computeNoShowCharge(booking, policy);

    const claimed = await this.prisma.$transaction(async (tx) => {
      // Serialise with a simultaneous Arrived / customer check-in for this booking: the claim's
      // "no queue entry" condition below is evaluated only after that transaction has committed.
      await lockBookingResolution(tx, booking.id);
      // Claim-based re-check, exactly as the removed automatic sweep did: a concurrent check-in
      // (customer self-check-in racing this exact operator click) or a duplicate/retried request
      // is silently rejected here rather than double-charging or overwriting a real arrival.
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
          actorUserId: userId,
          action: 'BOOKING_NO_SHOW',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: {
            chargeAmount,
            appointmentArrivalGraceMinutes: policy.appointmentArrivalGraceMinutes,
            mode: 'manual',
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

    if (!claimed) {
      throw new AppException(
        BookingErrorCode.NO_SHOW_NOT_ELIGIBLE,
        'This booking is no longer eligible to be marked no-show — it may have just been checked in.',
        HttpStatus.CONFLICT,
      );
    }

    this.realtime.emitBookingNoShow(booking.salonId, booking.id);
    return { id: booking.id, status: BookingStatus.NO_SHOW, chargeAmount };
  }

  /**
   * Requirement 17 (existing false no-show correction) — an auditable, reversible-in-spirit
   * correction for a booking that was wrongly marked NO_SHOW (by the now-removed automatic sweep,
   * or by operator mistake). Never deletes the original BOOKING_NO_SHOW audit row or ledger
   * history: the outstanding charge (if any) is WAIVED, not deleted, and a second, distinct audit
   * row records the correction. Never fabricates a QueueEntry/ServiceSession/staff/chair — this
   * booking never actually flowed through the live queue, and pretending it did would fabricate
   * history the mission explicitly forbids.
   */
  async correctToCompleted(
    userId: string,
    bookingId: string,
  ): Promise<{ id: string; status: BookingStatus; waivedLedgerEntryIds: string[] }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        salonId: true,
        customerId: true,
        status: true,
        cancellationChargeAmount: true,
      },
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.salonAccess.assertAccessOrAdminAccess(userId, booking.salonId);

    if (booking.status !== BookingStatus.NO_SHOW) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_NO_SHOW,
        'Only a booking currently marked no-show can be corrected to completed.',
        HttpStatus.CONFLICT,
      );
    }

    const waivedLedgerEntryIds = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.NO_SHOW },
        // Booking.cancellationChargeAmount is current-state, customer/owner-facing data (the
        // customer bookings page, owner bookings view and both mobile screens render it whenever
        // it is > 0/non-null). Left at the old no-show figure it would keep presenting a
        // COMPLETED, served booking as carrying a charge even though the ledger due is WAIVED — so
        // it is reset here, in the same transaction, and the original figure is preserved in the
        // AuditLog metadata below rather than lost.
        data: { status: BookingStatus.COMPLETED, cancellationChargeAmount: null },
      });
      if (claim.count === 0) {
        throw new AppException(
          BookingErrorCode.BOOKING_NOT_NO_SHOW,
          'This booking is no longer marked no-show.',
          HttpStatus.CONFLICT,
        );
      }

      // Neutralize any outstanding no-show charge without deleting it — WAIVED is the same
      // reversible terminal state dashboard-customers.service.ts's own waiveNoShowDue uses.
      const outstanding = await tx.customerLedgerEntry.findMany({
        where: {
          bookingId: booking.id,
          reason: LedgerReason.NO_SHOW_CHARGE,
          status: LedgerStatus.OUTSTANDING,
        },
        select: { id: true },
      });
      if (outstanding.length > 0) {
        await tx.customerLedgerEntry.updateMany({
          // Status is re-asserted in the claim so an entry can only ever transition
          // OUTSTANDING -> WAIVED once, even if something else touched it since the read above.
          where: {
            id: { in: outstanding.map((e) => e.id) },
            status: LedgerStatus.OUTSTANDING,
          },
          data: { status: LedgerStatus.WAIVED },
        });
      }

      // The original BOOKING_NO_SHOW row is never touched — this is an additional, distinct audit
      // entry recording the correction, not an edit of history.
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'BOOKING_NO_SHOW_CORRECTED_TO_COMPLETED',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: {
            waivedLedgerEntryIds: outstanding.map((e) => e.id),
            previousStatus: BookingStatus.NO_SHOW,
            previousCancellationChargeAmount:
              booking.cancellationChargeAmount !== null
                ? Number(booking.cancellationChargeAmount)
                : null,
          },
        },
      });

      await this.notifications.notifyInTransaction(
        tx,
        booking.customerId,
        'booking.corrected',
        { salonId: booking.salonId, bookingId: booking.id },
        'account/bookings',
      );

      return outstanding.map((e) => e.id);
    });

    this.realtime.emitBookingCorrected(booking.salonId, booking.id, booking.customerId);
    return { id: booking.id, status: BookingStatus.COMPLETED, waivedLedgerEntryIds };
  }

  private computeNoShowCharge(
    booking: {
      serviceId: string;
      service: { name: string; durationMinutes: number; price: Prisma.Decimal };
      services: Array<{
        serviceId: string;
        serviceName: string;
        durationMinutes: number;
        price: Prisma.Decimal;
      }>;
    },
    policy: CancellationPolicyDto,
  ): number {
    // Multi-service financial correctness: no-show percentage charges must apply to the complete
    // appointment value, never only Booking.service (the primary/first compatibility pointer).
    // Integer-paise summation avoids float drift.
    const effectiveServices = resolveEffectiveBookingServices(booking);
    const appointmentPrice = paiseToRupees(
      effectiveServices.reduce(
        (sum, service) => sum + decimalStringToPaise(service.price.toString()),
        0,
      ),
    );
    return computeCancellationCharge(policy, appointmentPrice, 0, true);
  }
}
