import { BookingStatus } from '@barbercue/shared';
import { computeArrivalGuidance } from './arrival-guidance';

describe('computeArrivalGuidance', () => {
  const baseInput = {
    status: BookingStatus.CONFIRMED,
    slotStart: new Date('2026-06-15T16:00:00.000Z'), // 4:00 PM UTC
    checkInOpensMinutesBefore: 15,
    checkInDueGraceMinutes: 10,
    hasCheckedIn: false,
  };

  it('derives checkInOpensAt/checkInDueBy from the snapshotted minutes around slotStart', () => {
    const result = computeArrivalGuidance(baseInput);
    expect(result.checkInOpensAt).toBe('2026-06-15T15:45:00.000Z');
    expect(result.checkInDueBy).toBe('2026-06-15T16:10:00.000Z');
  });

  it.each([BookingStatus.CANCELLED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW])(
    'returns no guidance for a resolved %s booking',
    (status) => {
      expect(computeArrivalGuidance({ ...baseInput, status })).toEqual({
        checkInOpensAt: null,
        checkInDueBy: null,
      });
    },
  );

  it('returns no guidance once the customer has already checked in', () => {
    expect(computeArrivalGuidance({ ...baseInput, hasCheckedIn: true })).toEqual({
      checkInOpensAt: null,
      checkInDueBy: null,
    });
  });

  it('returns no guidance (never fabricates one) when no policy snapshot was recorded', () => {
    expect(
      computeArrivalGuidance({
        ...baseInput,
        checkInOpensMinutesBefore: null,
        checkInDueGraceMinutes: null,
      }),
    ).toEqual({ checkInOpensAt: null, checkInDueBy: null });
  });

  it('returns no guidance when only one snapshot field is missing', () => {
    expect(
      computeArrivalGuidance({ ...baseInput, checkInDueGraceMinutes: null }),
    ).toEqual({ checkInOpensAt: null, checkInDueBy: null });
    expect(
      computeArrivalGuidance({ ...baseInput, checkInOpensMinutesBefore: null }),
    ).toEqual({ checkInOpensAt: null, checkInDueBy: null });
  });

  it('still derives guidance for a PENDING_PAYMENT booking', () => {
    const result = computeArrivalGuidance({ ...baseInput, status: BookingStatus.PENDING_PAYMENT });
    expect(result.checkInOpensAt).not.toBeNull();
    expect(result.checkInDueBy).not.toBeNull();
  });

  // DST-capable timezone: the arithmetic itself is plain millisecond math on an absolute instant
  // (timezone-agnostic), but this confirms the resulting instant is correct across a real US
  // spring-forward transition (2026-03-08 02:00 America/Chicago -> 03:00 CDT) rather than
  // accidentally doing wall-clock arithmetic that could land an hour off.
  it('computes correctly across a DST transition instant', () => {
    const slotStart = new Date('2026-03-08T08:30:00.000Z'); // 2:30 AM CST, just before spring-forward
    const result = computeArrivalGuidance({ ...baseInput, slotStart, checkInOpensMinutesBefore: 15, checkInDueGraceMinutes: 10 });
    expect(result.checkInOpensAt).toBe('2026-03-08T08:15:00.000Z');
    expect(result.checkInDueBy).toBe('2026-03-08T08:40:00.000Z');
  });
});
