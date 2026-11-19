import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FinanceErrorCode,
  Role,
  hasFinancePermission,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

/** The signed-in user's finance powers, resolved once per request from their session roles. */
export interface FinanceActor {
  userId: string;
  isPlatformAdmin: boolean;
  viewCompany: boolean;
  manage: boolean;
  approve: boolean;
  configure: boolean;
  bankDetails: boolean;
}

export function financeActor(user: AuthenticatedUser): FinanceActor {
  return {
    userId: user.id,
    isPlatformAdmin: user.roles.includes(Role.PLATFORM_ADMIN),
    viewCompany: hasFinancePermission(user.roles, 'viewCompanyFinance'),
    manage: hasFinancePermission(user.roles, 'manageFinance'),
    approve: hasFinancePermission(user.roles, 'approveFinance'),
    configure: hasFinancePermission(user.roles, 'configureFinance'),
    bankDetails: hasFinancePermission(user.roles, 'viewBankDetails'),
  };
}

export const notFound = (what: string) =>
  new AppException(
    FinanceErrorCode.NOT_FOUND,
    `${what} was not found.`,
    HttpStatus.NOT_FOUND,
  );

export const forbidden = (message = 'You do not have access to this.') =>
  new AppException(FinanceErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);

export const invalidState = (message: string) =>
  new AppException(
    FinanceErrorCode.INVALID_STATE,
    message,
    HttpStatus.CONFLICT,
  );

export const invalid = (message: string) =>
  new AppException(FinanceErrorCode.INVALID, message, HttpStatus.BAD_REQUEST);

/** Prisma Decimal → exact 2-decimal string. */
export const money = (value: Prisma.Decimal | null | undefined): string =>
  (value ?? new Prisma.Decimal(0)).toFixed(2);

/** "YYYY-MM-DD" → the Date Prisma stores in a DATE column. */
export const dateOnly = (value: string): Date =>
  new Date(`${value}T00:00:00.000Z`);

/** A DATE column value → "YYYY-MM-DD". */
export const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

/** Today's date in India (FastQue's reporting calendar). */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isUniqueViolation(error: unknown, target?: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return false;
  if (!target) return true;
  const fields = (error.meta?.target ?? []) as string[] | string;
  return Array.isArray(fields)
    ? fields.some((f) => f.includes(target))
    : String(fields).includes(target);
}
