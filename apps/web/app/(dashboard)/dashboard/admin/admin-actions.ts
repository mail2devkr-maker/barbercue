import { SalonStatus } from "@barbercue/shared";

/** Testable admin action helper kept outside Next.js page.tsx's restricted route exports. */
export function getNextShopStatus(status: SalonStatus): { status: SalonStatus; label: string } | null {
  if (status === SalonStatus.PENDING) return { status: SalonStatus.ACTIVE, label: "Open shop" };
  if (status === SalonStatus.ACTIVE) return { status: SalonStatus.SUSPENDED, label: "Suspend" };
  if (status === SalonStatus.SUSPENDED) return { status: SalonStatus.ACTIVE, label: "Re-open" };
  return null;
}
