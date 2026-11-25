import { CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import { HomeErrorCode } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { homeFlag } from './home-config';

type Details = Record<string, unknown>;
export const homeError = (
  code: HomeErrorCode,
  message: string,
  status: HttpStatus,
  details?: Details,
) => new AppException(code, message, status, details);
export const homeNotFound = (m = 'Not found.') =>
  homeError(HomeErrorCode.NOT_FOUND, m, HttpStatus.NOT_FOUND);
export const homeForbidden = (m = 'You do not have permission to do this.') =>
  homeError(HomeErrorCode.FORBIDDEN, m, HttpStatus.FORBIDDEN);
export const homeState = (m: string, details?: Details) =>
  homeError(HomeErrorCode.INVALID_STATE, m, HttpStatus.CONFLICT, details);
export const homeInvalid = (m: string, details?: Details) =>
  homeError(
    HomeErrorCode.VALIDATION,
    m,
    HttpStatus.UNPROCESSABLE_ENTITY,
    details,
  );
export const homeUnavailable = (
  m = 'That time is no longer available. Please choose another.',
  details?: Details,
) => homeError(HomeErrorCode.UNAVAILABLE, m, HttpStatus.CONFLICT, details);
export const homeDisabled = (m = 'FastQue Home is not available yet.') =>
  homeError(HomeErrorCode.DISABLED, m, HttpStatus.NOT_FOUND);

/** Postgres exclusion violation (two live commitments of one person overlapping). */
export function isOverlapViolation(err: unknown): boolean {
  const text = err instanceof Error ? err.message : '';
  return (
    text.includes('23P01') ||
    text.includes('professional_commitments_no_overlap')
  );
}

/** On routes that start NEW business. Never on routes that operate existing bookings. */
@Injectable()
export class HomeEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!homeFlag('FASTQUE_HOME_ENABLED')) throw homeDisabled();
    return true;
  }
}
