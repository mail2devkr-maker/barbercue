import { HttpStatus } from '@nestjs/common';
import { WorkErrorCode } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

export const workNotFound = (what = 'Not found.') =>
  new AppException(WorkErrorCode.NOT_FOUND, what, HttpStatus.NOT_FOUND);

export const workForbidden = (
  message = 'You do not have permission to do this.',
) => new AppException(WorkErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);

export const workInvalidState = (
  message: string,
  details?: Record<string, unknown>,
) =>
  new AppException(
    WorkErrorCode.INVALID_STATE,
    message,
    HttpStatus.CONFLICT,
    details,
  );

export const workValidation = (
  message: string,
  details?: Record<string, unknown>,
) =>
  new AppException(
    WorkErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    details,
  );

export const workError = (
  code: WorkErrorCode,
  message: string,
  status: HttpStatus,
  details?: Record<string, unknown>,
) => new AppException(code, message, status, details);
