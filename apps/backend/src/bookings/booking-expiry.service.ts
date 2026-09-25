import { Injectable, Logger, Optional } from '@nestjs/common';
import { BookingStatus } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { DbDeadlineSchedulerService } from '../common/db-deadline-scheduler/db-deadline-scheduler.service';

// STATE_MACHINES.md: "PENDING_PAYMENT --> EXPIRED: payment hold timeout (10 min) — capacity
// released." This is a fixed platform timeout on the *checkout* itself, not a per-salon setting
// and not measured from the appointment's slot time — a booking held for a slot next week must
// still release its capacity within 10 minutes of being created if the customer never pays.
export const PAYMENT_HOLD_TIMEOUT_MINUTES = 10;

/**
 * Sweeps abandoned PENDING_PAYMENT bookings — a customer who starts checkout (creating capacity-
 * holding PENDING_PAYMENT row) and never completes payment previously left that row stuck forever,
 * permanently holding a slot no one could ever book. This is the ONLY transition this service
 * handles; CONFIRMED bookings that are simply never checked in are a different, per-salon-graced
 * transition (CONFIRMED -> NO_SHOW, see booking-no-show.service.ts) — conflating the two under one
 * fixed-slotEnd-based cutoff was this service's original bug: it expired both statuses uniformly
 * 60 minutes past slotEnd, which (a) let a PENDING_PAYMENT hold survive for days on a future slot
 * instead of releasing in the documented 10 minutes, and (b) put confirmed-but-unattended bookings
 * into EXPIRED rather than the state machine's actual NO_SHOW (which also owes a no-show charge —
 * see booking-no-show.service.ts).
 *
 * Same periodic-sweep shape as RemindersService: the `updateMany` re-checks status inside its own
 * where clause as the durable claim, so a booking that got paid/cancelled between the initial read
 * and the write is silently skipped rather than incorrectly overwritten, two concurrent instances
 * can run this sweep without double-processing, and a crash mid-sweep leaves nothing inconsistent
 * — the next run just picks up any row still PENDING_PAYMENT past the timeout. createdAt is a UTC
 * instant like every other timestamp in this codebase, so this needs no per-salon timezone lookup.
 */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    @Optional() private readonly deadlineScheduler?: DbDeadlineSchedulerService,
  ) {}

  onModuleInit(): void {
    this.deadlineScheduler?.register({
      name: 'booking-payment-expiry',
      domain: 'booking',
      nextDueAt: () => this.findNextDueAt(),
      runDue: () => this.sweep(),
    });
  }

  private async findNextDueAt(): Promise<Date | null> {
    const next = await this.prisma.booking.findFirst({
      where: { status: BookingStatus.PENDING_PAYMENT },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return next
      ? new Date(next.createdAt.getTime() + PAYMENT_HOLD_TIMEOUT_MINUTES * 60_000)
      : null;
  }

  async sweep(): Promise<void> {
    const count = await this.expireOverdueBookings();
    if (count > 0) this.logger.log(`Expired ${count} abandoned payment hold(s).`);
  }

  /** The actual sweep logic, separated from the @Cron wrapper so it's directly unit-testable
   * without simulating cron timing. Returns how many bookings were expired. */
  async expireOverdueBookings(): Promise<number> {
    const cutoff = new Date(
      Date.now() - PAYMENT_HOLD_TIMEOUT_MINUTES * 60_000,
    );

    const overdue = await this.prisma.booking.findMany({
      where: {
        status: BookingStatus.PENDING_PAYMENT,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        customerId: true,
        salonId: true,
        salon: { select: { name: true, ownerUserId: true } },
      },
    });

    let expiredCount = 0;
    for (const booking of overdue) {
      const result = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: BookingStatus.PENDING_PAYMENT,
            createdAt: { lt: cutoff },
          },
          data: { status: BookingStatus.EXPIRED },
        });
        if (claim.count === 0) return false;

        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: 'BOOKING_EXPIRED',
            entityType: 'Booking',
            entityId: booking.id,
            metadata: { paymentHoldTimeoutMinutes: PAYMENT_HOLD_TIMEOUT_MINUTES },
          },
        });

        await this.notifications.notifyInTransaction(
          tx,
          booking.customerId,
          'booking.expired',
          { salonId: booking.salonId },
          'account/bookings',
        );
        await this.notifications.notifyInTransaction(
          tx,
          booking.salon.ownerUserId,
          'owner.booking.expired',
          { salonId: booking.salonId, bookingId: booking.id },
          `dashboard/salons/${booking.salonId}/bookings`,
        );
        return true;
      });
      if (result) {
        expiredCount += 1;
        this.realtime.emitBookingExpired(booking.salonId, booking.id);
      }
    }

    return expiredCount;
  }
}
