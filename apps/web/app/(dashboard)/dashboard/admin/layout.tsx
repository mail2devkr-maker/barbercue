"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { useAuth } from "../../../../lib/auth-context";
import { canOpenAdminPath } from "../../../../lib/admin-route-access";
import { AdminShell } from "../../../../components/admin/shell/AdminShell";

function AdminRouteBoundary({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const restricted = !!user && !canOpenAdminPath(user.roles, pathname);

  useEffect(() => {
    if (restricted) router.replace("/dashboard/admin");
  }, [restricted, router]);

  if (restricted) return null;
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole
      roles={[
        Role.PLATFORM_ADMIN,
        Role.CO_FOUNDER,
        Role.HR_ADMIN,
        Role.SALES_ADMIN,
        Role.PLATFORM_VIEWER,
      ]}
      redirectTo="/admin/login"
    >
      {/* The admin app frame (sidebar, toolbar, shared reporting period) wraps every admin page. */}
      <AdminShell>
        <AdminRouteBoundary>{children}</AdminRouteBoundary>
      </AdminShell>
    </RequireRole>
  );
}
