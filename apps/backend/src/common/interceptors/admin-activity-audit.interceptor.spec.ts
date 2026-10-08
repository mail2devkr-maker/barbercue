import { lastValueFrom, of, throwError } from 'rxjs';
import { SessionAudience } from '@barbercue/shared';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { AdminActivityAuditInterceptor } from './admin-activity-audit.interceptor';

describe('AdminActivityAuditInterceptor', () => {
  function build(
    route = '/api/v1/admin/employees/employee-1/password?token=must-not-leak',
    audience: SessionAudience = SessionAudience.ADMIN,
  ) {
    const prisma = {
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const interceptor = new AdminActivityAuditInterceptor(prisma as never);
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'actor-1', audience, roles: [] },
          method: 'POST',
          originalUrl: route,
          path: route,
          body: { password: 'must-not-leak', totpCode: '123456' },
          headers: { authorization: 'Bearer must-not-leak' },
        }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;
    return { prisma, interceptor, context };
  }

  it('logs authenticated admin requests, never request body/query/credentials', async () => {
    const { prisma, interceptor, context } = build();
    const next = { handle: () => of({ success: true }) } as CallHandler;
    const response = await lastValueFrom(interceptor.intercept(context, next));
    expect(response).toEqual({ success: true });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const item = prisma.auditLog.create.mock.calls[0][0].data;
    expect(item.action).toBe('ADMIN_HTTP_ACTIVITY');
    expect(item.actorUserId).toBe('actor-1');
    expect(item.entityId).not.toContain('?');
    expect(JSON.stringify(item)).not.toMatch(/must-not-leak|123456|Bearer/);
  });

  it('does not audit its own audit-history GET route', async () => {
    const { prisma, interceptor, context } = build('/api/v1/admin/security/audit?actorEmail=someone');
    await lastValueFrom(interceptor.intercept(
      context, { handle: () => of({ items: [] }) } as CallHandler,
    ));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not audit customer sessions', async () => {
    const { prisma, interceptor, context } = build(
      '/api/v1/dashboard/admin', SessionAudience.CUSTOMER,
    );
    await lastValueFrom(interceptor.intercept(
      context, { handle: () => of({}) } as CallHandler,
    ));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails open for metrics-only audit write failures but preserves HTTP response', async () => {
    const { prisma, interceptor, context } = build();
    prisma.auditLog.create.mockRejectedValue(new Error('db temporarily unavailable'));
    await expect(lastValueFrom(interceptor.intercept(
      context, { handle: () => of({ success: true }) } as CallHandler,
    ))).resolves.toEqual({ success: true });
  });

  it('preserves original application errors when logging denied actions', async () => {
    const { interceptor, context } = build();
    const error = new Error('Action denied');
    const next = { handle: () => throwError(() => error) } as CallHandler;
    await expect(lastValueFrom(interceptor.intercept(context, next)))
      .rejects.toBe(error);
  });
});
