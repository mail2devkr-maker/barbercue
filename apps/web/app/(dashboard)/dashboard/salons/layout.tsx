"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";

export default function SalonsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.SALON_STAFF, Role.SALON_OWNER]} redirectTo="/staff/login">
      {children}
    </RequireRole>
  );
}
