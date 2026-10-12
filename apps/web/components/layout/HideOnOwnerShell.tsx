"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// The owner/staff dashboard (/dashboard/salons/:id/...) is a full application shell with its own
// header, navigation and search, so the marketing site's header/footer step aside there. Every other
// route (landing, customer pages, the salon list, admin) is untouched.
export const OWNER_SHELL_PATH = /^\/dashboard\/salons\/[^/]+(\/.*)?$/;

export function HideOnOwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (OWNER_SHELL_PATH.test(pathname)) return null;
  return <>{children}</>;
}
