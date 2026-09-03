"use client";

import { CustomerShell } from "../../../components/layout/CustomerShell";

// Issue #13 Mission E: service/barber/date/slot selection must be visible and usable with no
// login wall at all (BookingInfoController's staff/availability/cancellation-policy routes are now
// @Public() for exactly this reason) — only the actual "Confirm booking" action requires a
// signed-in customer. BookingFlow now handles that itself, the same delayed-auth pattern
// WalkInJoinFlow and PublicQueueJoinFlow already use for the queue side.
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
