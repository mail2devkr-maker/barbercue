"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../components/auth/RequireRole";
import { CustomerShell } from "../../../components/layout/CustomerShell";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.CUSTOMER]} redirectTo="/login">
      <CustomerShell>{children}</CustomerShell>
    </RequireRole>
  );
}
