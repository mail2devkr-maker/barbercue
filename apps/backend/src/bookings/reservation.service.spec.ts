import { BookingStatus, ServiceSessionStatus } from '@barbercue/shared';
import { ReservationService } from './reservation.service';

// Booking/queue resource-reservation P0 mission — Part 20's exact regression cases, at the level
// of the one authority every other service (AvailabilityService, BookingsService, QueueService)
// is wired through. Each case name below matches the mission's own CASE A..V labels.

function db(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    booking: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      ...(overrides.booking as object),
    },
    serviceSession: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      ...(overrides.serviceSession as object),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const RAMESH = 'staff-ramesh';
const DINESH = 'staff-dinesh';
const SALON = 'salon-1';

describe('ReservationService', () => {
  let service: ReservationService;

  beforeEach(() => {
    service = new ReservationService();
  });

  describe('intervalsOverlap — half-open [start, end)', () => {
    it('CASE T — a booking ending exactly at a candidate start does NOT overlap', () => {
      const bookingEnd = new Date('2026-09-24T09:30:00.000Z');
      const candidateStart = new Date('2026-09-24T09:30:00.000Z');
      const candidateEnd = new Date('2026-09-24T10:00:00.000Z');
      expect(
        service.intervalsOverlap(new Date('2026-09-24T09:00:00.000Z'), bookingEnd, candidateStart, candidateEnd),
      ).toBe(false);
    });

    it('a candidate overlapping any part of an existing interval DOES overlap', () => {
      expect(
        service.intervalsOverlap(
          new Date('2026-09-24T09:00:00.000Z'),
          new Date('2026-09-24T09:30:00.000Z'),
          new Date('2026-09-24T09:15:00.000Z'),
          new Date('2026-09-24T09:45:00.000Z'),
        ),
      ).toBe(true);
    });
  });

  describe('projectedActiveSessionEnd — Part 4/8 overrun rule', () => {
    it('returns the nominal end when the session has not yet run its full duration', () => {
      const startedAt = new Date('2026-09-24T08:55:00.000Z');
      const now = new Date('2026-09-24T09:05:00.000Z');
      expect(service.projectedActiveSessionEnd(startedAt, 30, now)).toEqual(new Date('2026-09-24T09:25:00.000Z'));
    });

    it('CASE S — an overrunning session is never projected to have already ended', () => {
      const startedAt = new Date('2026-09-24T08:55:00.000Z');
      const now = new Date('2026-09-24T09:40:00.000Z'); // nominal end (09:25) already passed
      expect(service.projectedActiveSessionEnd(startedAt, 30, now)).toEqual(now);
    });
  });

  describe('isStaffFreeForInterval', () => {
    const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000Z`);

    it('CASE A — a CONFIRMED 09:00-09:30 reservation blocks an overlapping 09:00-09:30 candidate', async () => {
      const mockDb = db({ booking: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ slotEnd: at('09:30') }) } });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:30'));
      expect(result).toEqual({ free: false, reason: 'BOOKING_RESERVATION', busyUntil: at('09:30') });
    });

    it('CASE B — the same reservation marked COMPLETED at 09:10 still blocks a 09:15-09:45 candidate', async () => {
      // The mock stands in for the real reservingBookingWhere() query, which already includes
      // COMPLETED — this test pins that isStaffFreeForInterval's caller-facing contract doesn't
      // care about status at all once the row is returned as a match.
      const mockDb = db({ booking: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ slotEnd: at('09:30') }) } });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:15'), at('09:45'));
      expect(result.free).toBe(false);
      expect(result.reason).toBe('BOOKING_RESERVATION');
    });

    it('CASE C — at/after slotEnd, the completed booking no longer conflicts (no matching row returned)', async () => {
      const mockDb = db(); // reservingBookingWhere's own interval filter would exclude it — count=0
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:30'), at('10:00'));
      expect(result.free).toBe(true);
    });

    it('CASE D — a CANCELLED booking never appears (excluded from the reserving-status query) so it never conflicts', async () => {
      const mockDb = db(); // reservingBookingWhere() excludes CANCELLED at the query level
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:30'));
      expect(result.free).toBe(true);
    });

    it('CASE F — a PENDING_PAYMENT booking blocks the same as CONFIRMED', async () => {
      const mockDb = db({ booking: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ slotEnd: at('09:30') }) } });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:30'));
      expect(result.free).toBe(false);
    });

    it('CASE H — Ramesh reserved does not affect Dinesh (a per-staff query, scoped by staffId)', async () => {
      const countMock = jest.fn().mockImplementation((args: { where: { preferredStaffId: string } }) =>
        Promise.resolve(args.where.preferredStaffId === RAMESH ? 1 : 0),
      );
      const mockDb = db({ booking: { count: countMock, findFirst: jest.fn().mockResolvedValue({ slotEnd: at('09:30') }) } });
      const ramesh = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:30'));
      const dinesh = await service.isStaffFreeForInterval(mockDb, SALON, DINESH, at('09:00'), at('09:30'));
      expect(ramesh.free).toBe(false);
      expect(dinesh.free).toBe(true);
    });

    it('CASE J/S — an ACTIVE walk-in session for this staff overlapping the candidate blocks it', async () => {
      const mockDb = db({
        serviceSession: {
          findFirst: jest.fn().mockResolvedValue({ startedAt: at('08:55'), service: { durationMinutes: 30 } }),
        },
      });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:15'));
      expect(result).toEqual({ free: false, reason: 'ACTIVE_SESSION', busyUntil: at('09:25') });
    });

    it('an ACTIVE session that does not overlap the candidate interval does not block it', async () => {
      const mockDb = db({
        serviceSession: {
          findFirst: jest.fn().mockResolvedValue({ startedAt: at('07:00'), service: { durationMinutes: 15 } }),
        },
      });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:30'));
      expect(result.free).toBe(true);
    });

    it('CASE O — excludeBookingId lets an appointment be assigned to its own preferredStaffId without self-conflict', async () => {
      const countMock = jest.fn().mockImplementation((args: { where: { id?: { not: string } } }) =>
        // The excluded booking's own row would have matched; simulate the DB actually excluding it.
        Promise.resolve(args.where.id?.not === 'booking-1' ? 0 : 1),
      );
      const mockDb = db({ booking: { count: countMock } });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:30'), {
        excludeBookingId: 'booking-1',
      });
      expect(result.free).toBe(true);
    });

    it('excludeQueueEntryId excludes that entry\'s own active session from the check', async () => {
      const findFirstMock = jest.fn().mockImplementation((args: { where: { queueEntryId?: { not: string } } }) =>
        Promise.resolve(args.where.queueEntryId?.not === 'entry-1' ? null : { startedAt: at('08:55'), service: { durationMinutes: 30 } }),
      );
      const mockDb = db({ serviceSession: { findFirst: findFirstMock } });
      const result = await service.isStaffFreeForInterval(mockDb, SALON, RAMESH, at('09:00'), at('09:15'), {
        excludeQueueEntryId: 'entry-1',
      });
      expect(result.free).toBe(true);
    });
  });

  describe('countPoolReservations', () => {
    const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000Z`);

    it('CASE G — counts a reserving booking regardless of which staff (or Any Staff) holds it', async () => {
      const mockDb = db({ booking: { count: jest.fn().mockResolvedValue(1) } });
      const count = await service.countPoolReservations(mockDb, SALON, at('09:00'), at('09:30'));
      expect(count).toBe(1);
    });

    it('CASE I — a genuine walk-in ACTIVE session (no linked booking) consumes exactly one pool unit', async () => {
      const mockDb = db({
        booking: { count: jest.fn().mockResolvedValue(0) },
        serviceSession: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ startedAt: at('08:55'), service: { durationMinutes: 30 }, queueEntry: { bookingId: null } }]),
        },
      });
      const count = await service.countPoolReservations(mockDb, SALON, at('09:00'), at('09:15'));
      expect(count).toBe(1);
    });

    it('does not double-count an appointment session whose booking is already counted — the ACTIVE-session query itself excludes any session with a linked booking (queueEntry.bookingId: null), so only a genuine walk-in can ever reach the in-memory overlap filter', async () => {
      const findManyMock = jest.fn().mockResolvedValue([]);
      const mockDb = db({
        booking: { count: jest.fn().mockResolvedValue(1) }, // the appointment's own booking row
        serviceSession: { findMany: findManyMock },
      });
      const count = await service.countPoolReservations(mockDb, SALON, at('09:00'), at('09:15'));
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ queueEntry: { bookingId: null } }) }),
      );
      expect(count).toBe(1); // the booking's own row only, never doubled by its own session
    });

    it('CASE Q — excludeBookingId omits the booking being rescheduled from its own new-interval check', async () => {
      const countMock = jest.fn();
      const mockDb = db({ booking: { count: countMock.mockResolvedValue(0) } });
      await service.countPoolReservations(mockDb, SALON, at('10:00'), at('10:30'), { excludeBookingId: 'booking-1' });
      expect(countMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { not: 'booking-1' } }) }),
      );
    });
  });

  describe('nextReservationForStaff', () => {
    it('returns the soonest reservation strictly after the given instant', async () => {
      const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000Z`);
      const mockDb = db({
        booking: {
          findFirst: jest.fn().mockResolvedValue({ slotStart: at('11:00'), slotEnd: at('11:30') }),
        },
      });
      const next = await service.nextReservationForStaff(mockDb, SALON, RAMESH, at('09:30'));
      expect(next).toEqual({ slotStart: at('11:00'), slotEnd: at('11:30') });
    });

    it('returns null when there is nothing upcoming', async () => {
      const mockDb = db();
      const next = await service.nextReservationForStaff(mockDb, SALON, RAMESH, new Date());
      expect(next).toBeNull();
    });
  });

  describe('getStaffAvailabilityState — Part 9', () => {
    const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000Z`);
    const now = at('09:15');

    it('CASE M — a currently-reserved barber reads RESERVED, never AVAILABLE', async () => {
      const mockDb = db({ booking: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ slotEnd: at('09:30') }) } });
      const state = await service.getStaffAvailabilityState(mockDb, SALON, RAMESH, true, now);
      expect(state.availabilityState).toBe('RESERVED');
      expect(state.busyUntil).toEqual(at('09:30'));
    });

    it('while RESERVED, nextBookingStart is the reservation AFTER the current one, never the current one\'s own start reported back as "next"', async () => {
      const countMock = jest.fn().mockResolvedValue(1);
      const findFirstMock = jest
        .fn()
        // First call: the conflict-detail lookup inside isStaffFreeForInterval for the CURRENT
        // reservation (09:00-09:30). Second call: nextReservationForStaff, queried starting from
        // that reservation's own busyUntil (09:30), which must find the LATER one (11:00-11:30).
        .mockResolvedValueOnce({ slotEnd: at('09:30') })
        .mockResolvedValueOnce({ slotStart: at('11:00'), slotEnd: at('11:30') });
      const mockDb = db({ booking: { count: countMock, findFirst: findFirstMock } });
      const state = await service.getStaffAvailabilityState(mockDb, SALON, RAMESH, true, now);
      expect(state.availabilityState).toBe('RESERVED');
      expect(state.busyUntil).toEqual(at('09:30'));
      expect(state.nextBookingStart).toEqual(at('11:00')); // not at('09:00') — the current one's own start
      expect(findFirstMock.mock.calls[1][0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ slotEnd: { gt: at('09:30') } }) }),
      );
    });

    it('an ACTIVE session (not a future reservation) reads IN_SERVICE', async () => {
      const mockDb = db({
        serviceSession: { findFirst: jest.fn().mockResolvedValue({ startedAt: at('09:00'), service: { durationMinutes: 30 } }) },
      });
      const state = await service.getStaffAvailabilityState(mockDb, SALON, RAMESH, true, now);
      expect(state.availabilityState).toBe('IN_SERVICE');
    });

    it('TEST 7 — free of both reservation and session reads AVAILABLE', async () => {
      const mockDb = db();
      const state = await service.getStaffAvailabilityState(mockDb, SALON, RAMESH, true, at('09:30'));
      expect(state.availabilityState).toBe('AVAILABLE');
      expect(state.busyUntil).toBeNull();
    });

    it('a non-working (INACTIVE) staff member reads OFF_DUTY without any DB query', async () => {
      const mockDb = db();
      const state = await service.getStaffAvailabilityState(mockDb, SALON, RAMESH, false, now);
      expect(state.availabilityState).toBe('OFF_DUTY');
      expect(mockDb.booking.count).not.toHaveBeenCalled();
    });

    it('surfaces nextBookingStart even while AVAILABLE', async () => {
      const mockDb = db({
        booking: { findFirst: jest.fn().mockResolvedValue({ slotStart: at('11:00'), slotEnd: at('11:30') }) },
      });
      const state = await service.getStaffAvailabilityState(mockDb, SALON, RAMESH, true, at('09:30'));
      expect(state.availabilityState).toBe('AVAILABLE');
      expect(state.nextBookingStart).toEqual(at('11:00'));
    });
  });

  it('reservingBookingWhere includes CONFIRMED, PENDING_PAYMENT and COMPLETED, and nothing else', () => {
    const where = service.reservingBookingWhere();
    expect(where).toEqual({
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT, BookingStatus.COMPLETED] },
    });
  });
});

// Sanity import check — ensures ServiceSessionStatus stays part of this file's compiled output
// (used implicitly via the shared enum in fixtures above) so a future refactor that drops it from
// @barbercue/shared surfaces here as a type error, not a silent runtime drift.
void ServiceSessionStatus.ACTIVE;
