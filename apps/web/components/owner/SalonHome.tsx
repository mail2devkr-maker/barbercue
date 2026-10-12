"use client";

import { OwnerOverview } from "./OwnerOverview";
import { useOwnerShell } from "./OwnerShell";
import { StaffHome } from "./StaffHome";

export function SalonHome({ salonId }: { salonId: string }) {
  const { kind } = useOwnerShell();
  return kind === "owner" ? <OwnerOverview salonId={salonId} /> : <StaffHome salonId={salonId} />;
}
