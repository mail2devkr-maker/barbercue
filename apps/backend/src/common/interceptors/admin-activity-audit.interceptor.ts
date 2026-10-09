import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { SessionAudience, type AuthenticatedUser } from '@barbercue/shared';
import { Observable, catchError, mergeMap, throwError } from 'rxjs';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Secondary HTTP activity trail for authenticated internal admins, including
 * CO_FOUNDER. Business-event audit entries remain authoritative and
 * transaction-coupled for destructive operations.
 *
 * Strictly NO request body, query, cookies, Authorization header, password,
 * OTP, token, secret or raw IP is ever persisted. Failed action logging is
 * best-effort; it never masks the underlying HTTP error.
 */
@Injectable()
export class AdminActivityAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminActivityAuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthenticatedUser }>();
    const response = http.getResponse<{ statusCode: number }>();
    const startedAt = Date.now();
    const actor = request.user;
    const method = request.method.toUpperCase();
    const routePath = request.originalUrl?.split('?')[0] ?? request.path ?? '';

    // Never recursively record reads of the audit feed itself.
    if (routePath.includes('/admin/security/audit')) return next.handle();

    // Admin logins are public endpoints, so the authenticated identity arrives
    // only as the *successful response* of the Admin login handler.
    const adminLogin =
      method === 'POST' &&
      (routePath.endsWith('/auth/admin/login') ||
        routePath.endsWith('/auth/admin/google'));
    const isAdmin = actor?.audience === SessionAudience.ADMIN;
    if (!isAdmin && !adminLogin) return next.handle();

    const write = async (
      eventActorId: string | null,
      event:
        | 'ADMIN_HTTP_ACTIVITY'
        | 'ADMIN_LOGIN_SUCCEEDED'
        | 'ADMIN_LOGIN_REJECTED',
      result: 'SUCCESS' | 'REJECTED',
      status: number,
    ) => {
      try {
        await this.prisma.auditLog.create({
          data: {
            actorUserId: eventActorId,
            action: event,
            entityType: 'HttpRoute',
            entityId: (routePath || '/').slice(0, 220),
            metadata: {
              method,
              status,
              result,
              durationMs: Math.min(Date.now() - startedAt, 60 * 60 * 1000),
            },
          },
        });
      } catch (error) {
        // Audit failures must be visible to operations without exposing
        // request credentials or metadata or masking the original exception.
        this.logger.error(
          'Admin activity audit write failed',
          error instanceof Error ? error.name : undefined,
        );
      }
    };

    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        const v = value as {
          user?: { id?: string; audience?: SessionAudience };
        } | null;
        const loginActorId =
          adminLogin && v?.user?.audience === SessionAudience.ADMIN
            ? (v.user.id ?? null)
            : null;
        if (isAdmin) {
          await write(
            actor.id,
            'ADMIN_HTTP_ACTIVITY',
            'SUCCESS',
            response.statusCode,
          );
        } else if (adminLogin && loginActorId) {
          await write(
            loginActorId,
            'ADMIN_LOGIN_SUCCEEDED',
            'SUCCESS',
            response.statusCode,
          );
        }
        return value;
      }),
      catchError((error: unknown) => {
        if (isAdmin) {
          void write(
            actor.id,
            'ADMIN_HTTP_ACTIVITY',
            'REJECTED',
            typeof (error as { status?: number })?.status === 'number'
              ? (error as { status: number }).status
              : 500,
          );
        } else if (adminLogin) {
          void write(
            null,
            'ADMIN_LOGIN_REJECTED',
            'REJECTED',
            typeof (error as { status?: number })?.status === 'number'
              ? (error as { status: number }).status
              : 500,
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
