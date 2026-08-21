"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../components/auth/RequireRole";
import { CustomerShell } from "../../../components/layout/CustomerShell";

// Extracted from the page itself (was previously inline here) so this route follows the same
// layout-level gating pattern as account/book/queue — matches the backend's
// @Roles(Role.CUSTOMER) on POST style-advisor/generate.
export default function StyleAdvisorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.CUSTOMER]} redirectTo="/login">
      <CustomerShell>{children}</CustomerShell>
    </RequireRole>
  );
}
