import { HttpStatus } from '@nestjs/common';
import { AuthErrorCode, type PasswordAudience } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';

export function passwordWebBaseUrl(): URL {
  const configured = process.env.WEB_BASE_URL?.trim();
  const value =
    configured ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');
  try {
    const url = new URL(value);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('HTTPS required');
    }
    return url;
  } catch {
    throw new AppException(
      AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE,
      'Email delivery is temporarily unavailable. Please try again later.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export function buildPasswordLink(
  base: URL,
  token: string,
  audience?: PasswordAudience,
  intent?: 'invite',
): string {
  const url = new URL('/reset-password', base);
  url.searchParams.set('token', token);
  if (audience) url.searchParams.set('audience', audience);
  if (intent) url.searchParams.set('intent', intent);
  return url.toString();
}
