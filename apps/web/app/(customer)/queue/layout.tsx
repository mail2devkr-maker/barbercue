"use client";

import { CustomerShell } from "../../../components/layout/CustomerShell";

// Issue #13 Mission E: no longer gated behind RequireRole — service selection must be visible and
// usable with no login wall at all. WalkInJoinFlow (the only page under this route) now handles
// authentication itself, requiring sign-in only for the actual "Join the queue" action, exactly
// like PublicQueueJoinFlow (the QR entry point) already did.
export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
