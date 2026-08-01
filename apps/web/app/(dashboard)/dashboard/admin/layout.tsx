"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.PLATFORM_ADMIN]} redirectTo="/admin/login">
      {children}
    </RequireRole>
  );
}
