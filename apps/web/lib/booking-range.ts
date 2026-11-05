import {
  OWNER_BOOKING_FILTERS,
  type OwnerBookingFilter,
} from "@barbercue/shared";

/** A period the Assistant opened on the Bookings page: ?from=<ISO>&to=<ISO>&period=<label>&filter=<f>. */
export interface BookingRange {
  from: string;
  to: string;
  label: string;
  filter: OwnerBookingFilter;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function bookingRangeFromQuery(
  params: { get(name: string): string | null } | null,
): BookingRange | null {
  if (!params) return null;
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to || !ISO.test(from) || !ISO.test(to) || from > to)
    return null;
  const f = params.get("filter");
  const filter = (OWNER_BOOKING_FILTERS as readonly string[]).includes(f ?? "")
    ? (f as OwnerBookingFilter)
    : "all";
  const label =
    (params.get("period") ?? "").slice(0, 80) || "the selected dates";
  return { from, to, label, filter };
}
