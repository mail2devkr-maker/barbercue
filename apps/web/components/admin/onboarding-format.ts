import type { AdminOnboardingStage } from "@barbercue/shared";

/** New Shop Onboarding helpers (pure, unit-tested). */
export const ONBOARDING_STEPS: AdminOnboardingStage[] = [
  "REGISTERED",
  "VERIFIED",
  "CONFIGURED",
  "LIVE",
  "FIRST_CUSTOMER",
];

const LABEL: Record<AdminOnboardingStage, string> = {
  REGISTERED: "Registered",
  VERIFIED: "Verified",
  CONFIGURED: "Set up",
  LIVE: "Open",
  FIRST_CUSTOMER: "First customer",
};

export function stageLabel(stage: AdminOnboardingStage): string {
  return LABEL[stage];
}

/** Share of registered shops that reached a step, as a whole percent ("—" when none registered). */
export function conversion(reached: number, registered: number): string {
  if (registered <= 0) return "—";
  return `${Math.round((reached / registered) * 100)}%`;
}
