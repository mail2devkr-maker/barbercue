import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus, summarizeServiceNames } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';

// How far ahead of a booking's slotStart the reminder fires. A single fixed window for V1 — no
// per-user configurable window UI exists yet (that's Phase 13's communication-preferences job) —
// but it's a named constant precisely so that becomes a one-line change, not a rewrite.
export const REMINDER_WINDOW_MINUTES = 15;

/**
 * Appointment reminders (Phase 12) — a periodic sweep, not a per-booking scheduled job (no job
 * queue infrastructure exists in this codebase, and one isn't warranted for a once-per-booking
 * reminder at this scale). Every CONFIRMED/PENDING_PAYMENT booking entering the reminder window
 * gets exactly one in-app notification, tracked via Booking.reminderSentAt so the sweep never
 * double-reminds even if it overlaps its own previous run.
 *
 * The in-app row is committed with the claim; the native OS push is dispatched only after that
 * transaction succeeds, so provider/network work can never hold a database transaction open.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly pushDispatch: PushDispatchService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const count = await this.sendDueReminders();
    if (count > 0) this.logger.log(`Sent ${count} appointment reminder(s).`);
  }

  /** The actual sweep logic, separated from the @Cron wrapper so it's directly unit-testable
   * without simulating cron timing. Returns how many reminders were sent. */
  async sendDueReminders(): Promise<number> {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + REMINDER_WINDOW_MINUTES * 60_000,
    );
    const due = await this.prisma.booking.findMany({
      where: {
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
        },
        reminderSentAt: null,
        slotStart: { gt: now, lte: windowEnd },
      },
      select: {
        id: true,
        customerId: true,
        salonId: true,
        slotStart: true,
        salon: { select: { name: true } },
        serviceId: true,
        service: {
          select: { name: true, durationMinutes: true, price: true },
        },
        services: {
          orderBy: { sortOrder: 'asc' },
          select: {
            serviceId: true,
            serviceName: true,
            durationMinutes: true,
            price: true,
          },
        },
      },
    });

    let sentCount = 0;
    for (const booking of due) {
      const serviceName = summarizeServiceNames(
        resolveEffectiveBookingServices(booking).map((service) => service.serviceName),
      );

      const sent = await this.prisma.$transaction(async (tx) => {
        // The conditional marker is the durable claim. Concurrent instances contend on the same
        // row; only one can change reminderSentAt from null. Because notification creation runs
        // in this transaction too, an insertion failure rolls the claim back for the next sweep.
        const claim = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: {
              in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
            },
            reminderSentAt: null,
            slotStart: { gt: now, lte: windowEnd },
          },
          data: { reminderSentAt: now },
        });
        if (claim.count === 0) return false;

        return this.notifications.notifyInTransaction(
          tx,
          booking.customerId,
          'booking.reminder',
          {
            salonId: booking.salonId,
            salonName: booking.salon.name,
            serviceName,
            slotStart: booking.slotStart.toISOString(),
          },
          'account/bookings',
        );
      });
      if (sent) {
        sentCount += 1;
        // Push delivery is deliberately after commit. PushDispatchService is best-effort and
        // catches provider failures; reminderSentAt + the in-app notification remain durable.
        await this.pushDispatch.dispatchLocalizedToUser(
          booking.customerId,
          'bookingReminder',
          serviceName,
          { type: 'booking.reminder', bookingId: booking.id, salonId: booking.salonId },
        );
      }
    }

    return sentCount;
  }
}
