import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingStatus } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// How far ahead of a booking's slotStart the reminder fires. A single fixed window for V1 — no
// per-user configurable window UI exists yet (that's Phase 13's communication-preferences job) —
// but it's a named constant precisely so that becomes a one-line change, not a rewrite.
export const REMINDER_WINDOW_MINUTES = 60;
// The sweep runs every 5 minutes, so a booking could in principle enter the reminder window up to
// ~5 minutes before the sweep notices it; this floor keeps a booking that's already essentially
// starting from getting a "your appointment is coming up" reminder that arrives after the fact.
const REMINDER_MIN_LEAD_MINUTES = 5;

/**
 * Appointment reminders (Phase 12) — a periodic sweep, not a per-booking scheduled job (no job
 * queue infrastructure exists in this codebase, and one isn't warranted for a once-per-booking
 * reminder at this scale). Every CONFIRMED/PENDING_PAYMENT booking entering the reminder window
 * gets exactly one in-app notification, tracked via Booking.reminderSentAt so the sweep never
 * double-reminds even if it overlaps its own previous run.
 *
 * This is in-app/foreground only — see BARBERCUE_NON_PAYMENT_FEATURE_STATUS.md for the explicit
 * BLOCKED status on true Android background push (no FCM V1 credentials configured). A customer
 * only sees this reminder if the app/site is open when NotificationBell polls, or the next time
 * they open it — never a system-tray push while the app is closed.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    const count = await this.sendDueReminders();
    if (count > 0) this.logger.log(`Sent ${count} appointment reminder(s).`);
  }

  /** The actual sweep logic, separated from the @Cron wrapper so it's directly unit-testable
   * without simulating cron timing. Returns how many reminders were sent. */
  async sendDueReminders(): Promise<number> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000);
    const windowStart = new Date(now.getTime() + REMINDER_MIN_LEAD_MINUTES * 60_000);

    const due = await this.prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] },
        reminderSentAt: null,
        slotStart: { gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        customerId: true,
        salonId: true,
        slotStart: true,
        salon: { select: { name: true } },
        service: { select: { name: true } },
      },
    });

    for (const booking of due) {
      await this.notifications.notify(
        booking.customerId,
        'booking.reminder',
        {
          salonId: booking.salonId,
          salonName: booking.salon.name,
          serviceName: booking.service.name,
          slotStart: booking.slotStart.toISOString(),
        },
        'account/bookings',
      );
      // Marked sent even if a later step somehow failed for a different booking in this batch —
      // each booking is independent, no partial-batch rollback needed.
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: now },
      });
    }

    return due.length;
  }
}
