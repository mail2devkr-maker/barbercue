import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BookingStatus } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

// How long past a booking's own (duration-aware) slotEnd it must sit unresolved before the sweep
// expires it — a fixed grace window for staff to complete the linked queue check-in a little late,
// not an immediate cutoff the instant the clock passes slotEnd.
export const EXPIRY_GRACE_MINUTES = 60;

/**
 * A booking a customer made ahead of time only ever leaves CONFIRMED/PENDING_PAYMENT via an
 * explicit action: cancel(), reschedule(), or — the sole path to COMPLETED — its linked
 * QueueEntry's ServiceSession finishing (queue.service.ts). Nothing previously handled the very
 * common case of a customer simply not showing up and never checking into any queue: that booking
 * sat CONFIRMED forever, still counted as "active" in admin/owner dashboards and My Bookings.
 * BookingStatus.EXPIRED existed in the shared enum for exactly this but was never assigned
 * anywhere — this sweep is what actually assigns it.
 *
 * Same periodic-sweep shape as RemindersService (no job-queue infrastructure exists or is
 * warranted at this scale): the `updateMany` re-checks status inside its own where clause as the
 * durable claim, so a booking that got cancelled/rescheduled/completed between the initial read
 * and the write is silently skipped rather than incorrectly overwritten, two concurrent instances
 * can run this sweep without double-processing, and a crash mid-sweep leaves nothing
 * inconsistent — the next run just picks up any row still CONFIRMED/PENDING_PAYMENT past the
 * grace window. slotEnd is a UTC instant like every other booking timestamp in this codebase, so
 * this needs no per-salon timezone lookup to stay correct across timezones.
 */
@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // '@nestjs/schedule's CronExpression enum has no EVERY_15_MINUTES member (only 5/10/30) —
  // literal standard cron syntax, same six-field format every other value in that enum uses.
  @Cron('0 */15 * * * *')
  async sweep(): Promise<void> {
    const count = await this.expireOverdueBookings();
    if (count > 0) this.logger.log(`Expired ${count} overdue booking(s).`);
  }

  /** The actual sweep logic, separated from the @Cron wrapper so it's directly unit-testable
   * without simulating cron timing. Returns how many bookings were expired. */
  async expireOverdueBookings(): Promise<number> {
    const cutoff = new Date(Date.now() - EXPIRY_GRACE_MINUTES * 60_000);
    const activeStatuses = [
      BookingStatus.CONFIRMED,
      BookingStatus.PENDING_PAYMENT,
    ];

    const overdue = await this.prisma.booking.findMany({
      where: { status: { in: activeStatuses }, slotEnd: { lt: cutoff } },
      select: { id: true },
    });

    let expiredCount = 0;
    for (const booking of overdue) {
      const result = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: { in: activeStatuses },
            slotEnd: { lt: cutoff },
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
            metadata: { graceMinutes: EXPIRY_GRACE_MINUTES },
          },
        });
        return true;
      });
      if (result) expiredCount += 1;
    }

    return expiredCount;
  }
}
