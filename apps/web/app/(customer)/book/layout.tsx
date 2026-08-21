"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../components/auth/RequireRole";
import { CustomerShell } from "../../../components/layout/CustomerShell";

// The entire booking flow — availability, staff list, and creation — is authenticated per
// API.md's "Booking (customer, authenticated)" grouping, so the whole book/* subtree is gated
// here rather than per-page, same pattern as account/layout.tsx.
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.CUSTOMER]} redirectTo="/login">
      <CustomerShell>{children}</CustomerShell>
    </RequireRole>
  );
}
