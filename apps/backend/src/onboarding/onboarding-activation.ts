import { HttpStatus } from '@nestjs/common';
import { OnboardingErrorCode } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

/**
 * Approval creates a real owner account and salon, the invitation sends real email, and publishing
 * makes a salon public. All stay off until an invitation has been accepted end to end, so the safe
 * part of the workflow (drafts, review, change requests, rejection) can run on its own.
 */
export function assertOnboardingActivationEnabled(): void {
  if (process.env.ONBOARDING_ACTIVATION_ENABLED === 'true') return;
  throw new AppException(
    OnboardingErrorCode.ACTIVATION_DISABLED,
    'Salon approval and publishing are not switched on yet. The application stays in review.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
