import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BookingStatus, ServiceSessionStatus, type StaffAvailabilityState } from '@barbercue/shared';
import type { Db } from './availability.service';

/**
 * Booking/queue resource-reservation mission — the ONE place that answers "does this booking /
 * session consume capacity for this interval," reused by AvailabilityService, BookingsService and
 * QueueService instead of each keeping its own copy of the reserving-status array and overlap
 * math (which had already drifted: booking availability treated a COMPLETED appointment as fully
 * released the instant its ServiceSession finished, even when its booked slotEnd was still in the
 * future — the exact production gap this service closes).
 *
 * ==========================================================================================
 * AUTHORITATIVE RULE — a booked appointment reserves its resources for the FULL half-open
 * interval [slotStart, slotEnd), regardless of when the underlying service actually finishes:
 * ==========================================================================================
 *
 *  CONFIRMED        — blocks [slotStart, slotEnd)
 *  PENDING_PAYMENT  — blocks [slotStart, slotEnd), same as CONFIRMED (existing booking policy)
 *  COMPLETED        — STILL blocks through the ORIGINAL slotEnd. "Service completed" and
 *                      "reservation interval has ended" are different facts — a service finishing
 *                      early must never be allowed to quietly reopen its reserved capacity before
 *                      the customer's actual booked slotEnd. The interval-overlap check itself is
 *                      what naturally stops a COMPLETED booking from blocking anything once real
 *                      time passes slotEnd — no separate cutoff/expiry logic is needed, and this
 *                      never scans "every historical COMPLETED booking forever" because the
 *                      candidate interval query is always narrowed to overlap a specific window.
 *  CANCELLED        — releases immediately (excluded from every reserving query)
 *  NO_SHOW          — releases once the no-show transition is applied (same: excluded once status
 *                      is actually NO_SHOW; booking-no-show.service.ts owns *when* that happens)
 *  EXPIRED          — releases immediately (excluded)
 *
 * A currently-ACTIVE ServiceSession is a SEPARATE reservation source layered on top of the above
 * (a walk-in has no Booking row at all, and an appointment's actual service can start early or
 * run past its nominal duration) — see isStaffFreeForInterval's own doc comment for how the two
 * are combined without double-counting one appointment's own booking+session as two conflicts.
 */
const RESERVING_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.COMPLETED,
];

export interface StaffReservationCheck {
  free: boolean;
  reason: 'BOOKING_RESERVATION' | 'ACTIVE_SESSION' | null;
  /** ISO end of the specific conflicting reservation/session, when free is false. */
  busyUntil: Date | null;
}

@Injectable()
export class ReservationService {
  /** The Prisma where-fragment for "this booking can ever consume capacity" — callers still AND
   * this with their own salonId/staffId/interval filters. Exported as a method (not a bare
   * constant) so every call site goes through this one file, keeping the rule impossible to
   * silently fork again. */
  reservingBookingWhere(): Prisma.BookingWhereInput {
    return { status: { in: [...RESERVING_BOOKING_STATUSES] } };
  }

  /** Half-open interval overlap: [aStart, aEnd) intersects [bStart, bEnd). Exact boundary contact
   * (aEnd === bStart or bEnd === aStart) is NOT an overlap. */
  intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
    return aStart < bEnd && aEnd > bStart;
  }

  /**
   * A conservative projected occupied window for an ACTIVE ServiceSession: [startedAt,
   * projectedEnd), where projectedEnd = max(startedAt + durationMinutes, now). While the session
   * is still ACTIVE, this can never sit in the past — an overrunning service (already past its
   * nominal duration) keeps its barber marked busy at least through "now" rather than pretending
   * they freed up the moment the nominal duration elapsed (Part 4/8's explicit rule: "do not
   * pretend the barber is free while the session is still ACTIVE"). This is a documented
   * heuristic for projected/future availability, not a prediction of the real finish time.
   */
  projectedActiveSessionEnd(startedAt: Date, durationMinutes: number, now: Date = new Date()): Date {
    const nominalEnd = new Date(startedAt.getTime() + durationMinutes * 60_000);
    return nominalEnd > now ? nominalEnd : now;
  }

  /**
   * Pool capacity consumed for a candidate interval — used by "Any Staff" bookability (SLOT_FULL)
   * and by capacity/ETA math. Counts, without double-counting, the union of:
   *  (a) reserving Bookings (any staff, named or Any Staff) whose [slotStart, slotEnd) overlaps
   *      the candidate interval;
   *  (b) ACTIVE ServiceSessions for a genuine WALK_IN (queueEntry.bookingId is null — an
   *      appointment's own check-in session is already counted via its Booking in (a)) whose
   *      projected window overlaps the candidate interval.
   * One appointment or one active walk-in consumes exactly one pool unit, matching DATABASE.md's
   * "one service = one staff + one chair" capacity model. `excludeBookingId` lets reschedule()
   * check a candidate interval without counting the booking being moved against itself.
   */
  async countPoolReservations(
    db: Db,
    salonId: string,
    start: Date,
    end: Date,
    options?: { excludeBookingId?: string },
  ): Promise<number> {
    const [bookingCount, activeWalkInSessions] = await Promise.all([
      db.booking.count({
        where: {
          salonId,
          ...(options?.excludeBookingId ? { id: { not: options.excludeBookingId } } : {}),
          ...this.reservingBookingWhere(),
          slotStart: { lt: end },
          slotEnd: { gt: start },
        },
      }),
      db.serviceSession.findMany({
        where: {
          status: ServiceSessionStatus.ACTIVE,
          chair: { salonId },
          queueEntry: { bookingId: null },
        },
        select: { startedAt: true, service: { select: { durationMinutes: true } } },
      }),
    ]);
    const now = new Date();
    const overlappingWalkIns = activeWalkInSessions.filter((s) =>
      this.intervalsOverlap(
        s.startedAt,
        this.projectedActiveSessionEnd(s.startedAt, s.service.durationMinutes, now),
        start,
        end,
      ),
    ).length;
    return bookingCount + overlappingWalkIns;
  }

  /**
   * The single, authoritative "is this NAMED staff member free for this interval" check —
   * combines both reservation sources (see this file's own header comment) as a boolean, since a
   * named-staff check only needs existence, not a dedup-sensitive count. `excludeBookingId` (Case
   * O: an appointment's own queue entry, assigned to its own preferredStaffId, must never conflict
   * with its own reservation) and `excludeQueueEntryId` (the entry's own ACTIVE session, if a
   * reassign is checking the same entry) both prevent a reservation from conflicting with itself.
   */
  async isStaffFreeForInterval(
    db: Db,
    salonId: string,
    staffId: string,
    start: Date,
    end: Date,
    options?: { excludeBookingId?: string; excludeQueueEntryId?: string },
  ): Promise<StaffReservationCheck> {
    const bookingConflictWhere: Prisma.BookingWhereInput = {
      salonId,
      preferredStaffId: staffId,
      ...(options?.excludeBookingId ? { id: { not: options.excludeBookingId } } : {}),
      ...this.reservingBookingWhere(),
      slotStart: { lt: end },
      slotEnd: { gt: start },
    };
    const [conflictingBookingCount, activeSession] = await Promise.all([
      // A plain count first, matching the same query shape create()/reschedule() always used —
      // the (rare) conflict path below pays one extra query only when there actually IS one, to
      // learn its slotEnd for `busyUntil`.
      db.booking.count({ where: bookingConflictWhere }),
      db.serviceSession.findFirst({
        where: {
          staffId,
          status: ServiceSessionStatus.ACTIVE,
          ...(options?.excludeQueueEntryId ? { queueEntryId: { not: options.excludeQueueEntryId } } : {}),
        },
        select: { startedAt: true, service: { select: { durationMinutes: true } } },
      }),
    ]);
    if (conflictingBookingCount > 0) {
      const conflictingBooking = await db.booking.findFirst({
        where: bookingConflictWhere,
        select: { slotEnd: true },
        orderBy: { slotEnd: 'asc' },
      });
      return { free: false, reason: 'BOOKING_RESERVATION', busyUntil: conflictingBooking?.slotEnd ?? null };
    }
    if (activeSession) {
      const projectedEnd = this.projectedActiveSessionEnd(
        activeSession.startedAt,
        activeSession.service.durationMinutes,
      );
      if (this.intervalsOverlap(activeSession.startedAt, projectedEnd, start, end)) {
        return { free: false, reason: 'ACTIVE_SESSION', busyUntil: projectedEnd };
      }
    }
    return { free: true, reason: null, busyUntil: null };
  }

  /** This staff member's next reservation strictly after `after` — used for display
   * ("nextBookingStart") and for a free/available barber who is booked again soon. */
  async nextReservationForStaff(
    db: Db,
    salonId: string,
    staffId: string,
    after: Date,
  ): Promise<{ slotStart: Date; slotEnd: Date } | null> {
    const next = await db.booking.findFirst({
      where: {
        salonId,
        preferredStaffId: staffId,
        ...this.reservingBookingWhere(),
        slotEnd: { gt: after },
      },
      select: { slotStart: true, slotEnd: true },
      orderBy: { slotStart: 'asc' },
    });
    return next;
  }

  /**
   * Derived, point-in-time operational availability for a staff member (Part 9) — deliberately
   * NOT stored on SalonStaff.status, which stays exactly what it always was (working/clock-in
   * state). OFF_DUTY mirrors `status !== ACTIVE`; otherwise IN_SERVICE wins over RESERVED (a
   * barber physically serving someone right now is "in service" even if that session happens to
   * be the same appointment reserving them), which wins over AVAILABLE.
   */
  async getStaffAvailabilityState(
    db: Db,
    salonId: string,
    staffId: string,
    isWorking: boolean,
    now: Date = new Date(),
  ): Promise<{ availabilityState: StaffAvailabilityState; busyUntil: Date | null; nextBookingStart: Date | null }> {
    if (!isWorking) {
      return { availabilityState: 'OFF_DUTY', busyUntil: null, nextBookingStart: null };
    }
    // A zero-width probe at `now` — free the instant AFTER a reservation exactly ends.
    const check = await this.isStaffFreeForInterval(db, salonId, staffId, now, new Date(now.getTime() + 1));
    // Sequenced deliberately, not run in parallel with the check above: "next" must mean the next
    // reservation AFTER whatever is currently blocking this instant (busyUntil), never the current
    // one's own (already-past-or-present) slotStart reported back as if it were upcoming.
    const next = await this.nextReservationForStaff(db, salonId, staffId, check.free ? now : (check.busyUntil ?? now));
    if (!check.free) {
      return {
        availabilityState: check.reason === 'ACTIVE_SESSION' ? 'IN_SERVICE' : 'RESERVED',
        busyUntil: check.busyUntil,
        nextBookingStart: next?.slotStart ?? null,
      };
    }
    return { availabilityState: 'AVAILABLE', busyUntil: null, nextBookingStart: next?.slotStart ?? null };
  }
}
