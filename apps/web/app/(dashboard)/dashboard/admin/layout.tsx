"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { useAuth } from "../../../../lib/auth-context";

function canOpenAdminPath(roles: Role[], pathname: string): boolean {
  const superAdmin = roles.includes(Role.PLATFORM_ADMIN);
  const coFounder = roles.includes(Role.CO_FOUNDER);
  const hr = roles.includes(Role.HR_ADMIN);
  const sales = roles.includes(Role.SALES_ADMIN);

  if (pathname === "/dashboard/admin") return true;
  if (pathname.startsWith("/dashboard/admin/access")) return superAdmin;
  if (pathname.startsWith("/dashboard/admin/crm")) return superAdmin || coFounder || hr || sales;
  if (pathname.startsWith("/dashboard/admin/employees")) return superAdmin || coFounder || hr;
  if (pathname.startsWith("/dashboard/admin/verification")) return superAdmin || coFounder;
  return superAdmin || coFounder;
}

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
      <AdminRouteBoundary>{children}</AdminRouteBoundary>
    </RequireRole>
  );
}
