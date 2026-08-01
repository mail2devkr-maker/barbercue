"use client";

import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../components/auth/RequireRole";

// Walk-in queue join is authenticated per API.md's "Queue (customer, authenticated)" grouping —
// same whole-subtree gating pattern as book/layout.tsx.
export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={[Role.CUSTOMER]} redirectTo="/login">
      {children}
    </RequireRole>
  );
}
