"use client";

import { Role } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { ActionAssistant } from "./ActionAssistant";

/**
 * The Action Assistant on customer screens (issue #362). Shown only to a signed-in customer; the
 * server still decides every action from the session. On a salon's booking page `salonId` lets
 * "kal 5 baje haircut book karo" book at that salon.
 */
export function CustomerActionAssistant({ salonId }: { salonId?: string }) {
  const { user } = useAuth();
  if (!user || !user.roles.includes(Role.CUSTOMER)) return null;
  return <ActionAssistant surface="customer" salonId={salonId} />;
}
