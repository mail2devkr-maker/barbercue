import { BookingStatus } from '@barbercue/shared';

// Guidance only makes sense for a booking that's still an open, unresolved future appointment —
// same set BookingsService/DashboardBookingsService already treat as "active" elsewhere (see
// CANCELLABLE_STATUSES/UPCOMING_STATUSES on the client side). CANCELLED/COMPLETED/NO_SHOW have
// already been resolved one way or another; showing "please arrive by" for any of them would be
// stale, meaningless text.
const ARRIVAL_GUIDANCE_STATUSES: ReadonlySet<BookingStatus> = new Set([
  BookingStatus.CONFIRMED,
  BookingStatus.PENDING_PAYMENT,
]);

export interface ArrivalGuidanceInput {
  status: BookingStatus;
  slotStart: Date;
  // Booking.checkInOpensMinutesBefore / checkInDueGraceMinutes — the snapshot captured at
  // creation time (see schema.prisma's own doc comment on those columns). Null on any booking
  // created before this feature existed.
  checkInOpensMinutesBefore: number | null;
  checkInDueGraceMinutes: number | null;
  // Whether a QueueEntry already exists for this booking (checked in). Once true, the customer has
  // moved into the live-queue experience (QueueStatusPanel) — arrival guidance for a slot they've
  // already arrived for is exactly the "meaningless arrive-by text" this must avoid showing.
  hasCheckedIn: boolean;
}

export interface ArrivalGuidance {
  checkInOpensAt: string | null;
  checkInDueBy: string | null;
}

/**
 * Derives BookingDetailDto's checkInOpensAt/checkInDueBy from the booking's own snapshotted
 * minutes, never from the salon's current live CancellationPolicy — see the schema.prisma comment
 * on Booking.checkInOpensMinutesBefore/checkInDueGraceMinutes for why. Pure millisecond arithmetic
 * on an absolute instant: DST correctness is the display layer's job (formatZonedDateTime/
 * Intl.DateTimeFormat against the salon's IANA zone), not this function's — adding N minutes to an
 * instant is timezone-agnostic by construction.
 */
export function computeArrivalGuidance(input: ArrivalGuidanceInput): ArrivalGuidance {
  if (
    !ARRIVAL_GUIDANCE_STATUSES.has(input.status) ||
    input.hasCheckedIn ||
    // Loose "missing" check deliberately covers both null (a real, recorded absence — see the
    // schema.prisma doc comment) and undefined (a caller/test fixture that never set the field at
    // all) — either way there is no snapshot to derive guidance from, so this must never fall
    // through into NaN-producing arithmetic (`undefined * 60_000` -> `NaN` -> an Invalid Date whose
    // toISOString() throws) instead of a clean "no guidance" result.
    typeof input.checkInOpensMinutesBefore !== 'number' ||
    typeof input.checkInDueGraceMinutes !== 'number'
  ) {
    return { checkInOpensAt: null, checkInDueBy: null };
  }
  const slotStartMs = input.slotStart.getTime();
  return {
    checkInOpensAt: new Date(slotStartMs - input.checkInOpensMinutesBefore * 60_000).toISOString(),
    checkInDueBy: new Date(slotStartMs + input.checkInDueGraceMinutes * 60_000).toISOString(),
  };
}
