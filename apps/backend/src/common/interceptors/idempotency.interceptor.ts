import { createHash } from 'crypto';
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { BookingErrorCode } from '@barbercue/shared';
import { from, type Observable } from 'rxjs';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../exceptions/app.exception';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';

const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * First real use of the IdempotencyKey table (defined since Phase 1, unused until Phase 3B's
 * booking endpoints). No-ops entirely for any route not marked @Idempotent() — see roles.guard.ts
 * for the same getAllAndOverride() reflector pattern this mirrors.
 *
 * A retried request with the same key+body replays the cached response verbatim. The same key
 * with a different body is a client bug (IDEMPOTENCY_KEY_REUSED). A concurrent second request
 * still racing the first (no snapshot yet) is told to back off (REQUEST_IN_PROGRESS) rather than
 * double-executing a money/booking-affecting handler.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean | undefined>(
      IDEMPOTENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isIdempotent) return next.handle();

    return from(this.handleIdempotent(context, next));
  }

  private async handleIdempotent(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.header('Idempotency-Key');
    if (!key) {
      throw new AppException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'An Idempotency-Key header is required for this request.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const requestHash = createHash('sha256')
      .update(
        `${request.method}:${request.originalUrl}:${JSON.stringify(request.body ?? {})}`,
      )
      .digest('hex');

    try {
      // Claims the key atomically — a unique-constraint failure means someone (this request,
      // retried, or a genuine concurrent duplicate) already holds it.
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          endpoint: `${request.method} ${request.originalUrl}`,
          requestHash,
          expiresAt: new Date(Date.now() + RESPONSE_TTL_MS),
        },
      });
    } catch (err) {
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      )
        throw err;
      return this.resolveExistingClaim(key, requestHash);
    }

    try {
      const result: unknown = await new Promise((resolve, reject) => {
        next.handle().subscribe({ next: resolve, error: reject });
      });
      await this.prisma.idempotencyKey.update({
        where: { key },
        data: { responseSnapshot: result as Prisma.InputJsonValue },
      });
      return result;
    } catch (err) {
      // Release the claim so a legitimate retry after a failed attempt can proceed.
      await this.prisma.idempotencyKey
        .delete({ where: { key } })
        .catch(() => undefined);
      throw err;
    }
  }

  private async resolveExistingClaim(
    key: string,
    requestHash: string,
  ): Promise<unknown> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });
    if (!existing) {
      // Deleted between our failed create and this lookup (e.g. the in-flight request just
      // failed) — safe to treat as "in progress," a retry shortly after will succeed normally.
      throw new AppException(
        BookingErrorCode.REQUEST_IN_PROGRESS,
        'This request is already being processed. Please try again shortly.',
        HttpStatus.CONFLICT,
      );
    }
    if (existing.requestHash !== requestHash) {
      throw new AppException(
        BookingErrorCode.IDEMPOTENCY_KEY_REUSED,
        'This Idempotency-Key was already used for a different request.',
        HttpStatus.CONFLICT,
      );
    }
    if (existing.responseSnapshot === null) {
      throw new AppException(
        BookingErrorCode.REQUEST_IN_PROGRESS,
        'This request is already being processed. Please try again shortly.',
        HttpStatus.CONFLICT,
      );
    }
    return existing.responseSnapshot;
  }
}
