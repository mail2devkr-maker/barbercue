import { SessionAudience, type MeResponse } from "@barbercue/shared";

export type BookingAuthStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * Customer booking APIs intentionally require a CUSTOMER-audience session. A person may also be a
 * shop owner/staff member, but a STAFF-audience token deliberately excludes Role.CUSTOMER. Keep the
 * UI gate aligned with the backend instead of treating every authenticated session as bookable.
 */
export function hasCustomerBookingSession(
  status: BookingAuthStatus,
  user: MeResponse | null,
): boolean {
  return status === "authenticated" && user?.audience === SessionAudience.CUSTOMER;
}
