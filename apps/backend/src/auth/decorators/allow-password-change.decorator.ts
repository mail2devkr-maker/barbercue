import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowWhilePasswordChangeRequired';

/**
 * Marks the few routes a user may still call while an administrator-issued temporary password has not been replaced
 * (see JwtAuthGuard). Everything else is refused by the backend with PASSWORD_CHANGE_REQUIRED.
 */
export const AllowWhilePasswordChangeRequired = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
