"use client";

import type { ReactNode } from "react";
import { Role } from "@barbercue/shared";
import { RequireRole } from "../auth/RequireRole";

/**
 * Wraps a page that only the shop owner (or a platform administrator) may use, so a barber who types its address is sent back to
 * their shops instead of seeing a page full of refused requests. This is a convenience only: the server refuses every one of those
 * requests for a barber, which is what actually protects the data.
 */
export function OwnerOnly({ children }: { children: ReactNode }) {
  return (
    <RequireRole roles={[Role.SALON_OWNER, Role.PLATFORM_ADMIN]} redirectTo="/dashboard/salons">
      {children}
    </RequireRole>
  );
}
