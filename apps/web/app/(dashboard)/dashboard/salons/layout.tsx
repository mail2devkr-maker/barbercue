"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";

// PLATFORM_ADMIN (Part 2) added so a delegated-management link into these pages doesn't bounce an
// admin straight back to /staff/login before the backend ever gets a chance to decide whether the
// specific shop/action is actually allowed — this is UX only (see RequireRole's own doc comment),
// the real authorization is SalonAccessService.assertOwnerOrAdminAccess on the API side.
export default function SalonsLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.SALON_STAFF, Role.SALON_OWNER, Role.PLATFORM_ADMIN]} redirectTo="/staff/login">
      {children}
    </RequireRole>
  );
}
