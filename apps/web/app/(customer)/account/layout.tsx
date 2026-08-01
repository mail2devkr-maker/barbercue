"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../components/auth/RequireRole";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.CUSTOMER]} redirectTo="/login">
      {children}
    </RequireRole>
  );
}
