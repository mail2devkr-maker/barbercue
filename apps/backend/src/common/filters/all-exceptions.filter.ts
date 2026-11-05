import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppException } from '../exceptions/app.exception';

/**
 * Centralized error handling (Phase 2 requirement): every thrown error, expected or not, is
 * normalized to `{ error: { code, message, details? } }` per API.md — so clients never have to
 * branch on framework-specific error shapes.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppException) {
      response.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);
      response.status(status).json({
        error: {
          code: HttpStatus[status] ?? 'HTTP_ERROR',
          message: Array.isArray(message) ? message.join('; ') : message,
        },
      });
      return;
    }

    // Issue #381: database guards (migration 20261105100000) raise these exact messages. They are an
    // expected refusal — the shop is in recovery Trash, has open obligations, or a hard delete was
    // attempted — so answer 409 with a stable code instead of a generic 500.
    const guard = databaseGuardRefusal(exception);
    if (guard) {
      response.status(HttpStatus.CONFLICT).json({ error: guard });
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
      },
    });
  }
}

const DATABASE_GUARD_MESSAGES: Record<string, string> = {
  SHOP_QUARANTINED: 'This shop is in recovery Trash. Only a Super Admin can restore it.',
  SHOP_HAS_OPEN_OBLIGATIONS:
    'Resolve current bookings, queue work and unsettled amounts before this shop can move to Trash.',
  SALON_HARD_DELETE_DISABLED:
    'Shops are never hard deleted. Use the Co-Founder request and Super Admin approval flow.',
};

/** Prisma surfaces a PL/pgSQL RAISE as an error whose message contains the raised text. */
export function databaseGuardRefusal(
  exception: unknown,
): { code: string; message: string } | null {
  if (!(exception instanceof Error)) return null;
  const name = exception.constructor?.name ?? '';
  if (!name.startsWith('PrismaClient')) return null;
  for (const code of Object.keys(DATABASE_GUARD_MESSAGES)) {
    if (exception.message.includes(code)) {
      return { code, message: DATABASE_GUARD_MESSAGES[code] };
    }
  }
  return null;
}
