// Pure step-sequencing logic for OwnerOnboardingScreen (Mobile Shop Owner Onboarding mission) —
// kept out of the screen file so it's testable without pulling in React Native components.

export const ONBOARDING_TOTAL_STEPS = 7;

// Advisory-only steps per the backend's actual activation gate (SalonActivationService
// .assertReadyToOpen requires a service, a chair and a staff member — never hours, photos or a
// payment QR) — mirrors apps/web's SetupChecklist.tsx distinction between required and advisory.
export const ONBOARDING_SKIPPABLE_STEPS = new Set([2, 3, 6]);

export interface OnboardingProgressFlags {
  hasService: boolean;
  hasOpenDay: boolean;
  hasPhoto: boolean;
  hasChair: boolean;
  hasStaff: boolean;
  hasPaymentQr: boolean;
}

/**
 * The step order is fixed by the mission spec: Services, Hours, Photos, Chairs, Staff, Payment QR,
 * Go Live. Returns the first step whose requirement isn't met yet, or 7 (Go Live) once every step
 * has something saved — used both to resume an interrupted registration and to pick the very first
 * step right after a brand-new registration.
 */
export function computeFirstIncompleteStep(flags: OnboardingProgressFlags): number {
  if (!flags.hasService) return 1;
  if (!flags.hasOpenDay) return 2;
  if (!flags.hasPhoto) return 3;
  if (!flags.hasChair) return 4;
  if (!flags.hasStaff) return 5;
  if (!flags.hasPaymentQr) return 6;
  return 7;
}
