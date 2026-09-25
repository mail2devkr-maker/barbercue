"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { useAuth } from "../../../../lib/auth-context";

function ViewerRouteBoundary({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const viewerOnly =
    !!user &&
    user.roles.includes(Role.PLATFORM_VIEWER) &&
    !user.roles.includes(Role.PLATFORM_ADMIN);
  const viewerOnRestrictedSubpage = viewerOnly && pathname !== "/dashboard/admin";

  useEffect(() => {
    if (viewerOnRestrictedSubpage) router.replace("/dashboard/admin");
  }, [viewerOnRestrictedSubpage, router]);

  if (viewerOnRestrictedSubpage) return null;
  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole
      roles={[Role.PLATFORM_ADMIN, Role.PLATFORM_VIEWER]}
      redirectTo="/admin/login"
    >
      <ViewerRouteBoundary>{children}</ViewerRouteBoundary>
    </RequireRole>
  );
}
