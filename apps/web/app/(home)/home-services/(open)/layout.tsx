import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { homeServicesLinksEnabled } from "../../../../lib/dashboard-flags";

// Pages that start new business are a real 404 while the switch is off. Tracking, shared status and the
// professional dashboard live outside this folder, so bookings already made can always be finished.
export default function OpenLayout({ children }: { children: ReactNode }) {
  if (!homeServicesLinksEnabled()) notFound();
  return children;
}
