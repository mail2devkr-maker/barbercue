import { AdminSecurityAuditService } from './admin-security-audit.service';

describe('AdminSecurityAuditService', () => {
  const prisma = {
    auditLog: {
      findMany: jest.fn(),
    },
  } as any;
  let service: AdminSecurityAuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminSecurityAuditService(prisma);
  });

  it('omits free-form deletion text and nested non-primitive values from the audit feed', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'event-1',
        createdAt: new Date('2026-10-08T00:00:00.000Z'),
        actorUserId: 'actor-1',
        actor: { id: 'actor-1', email: 'admin@example.test' },
        action: 'SHOP_DELETE_REQUESTED',
        entityType: 'Salon',
        entityId: 'salon-1',
        metadata: {
          requestId: 'request-1',
          shopPublicId: 'BC-SHOP-000001',
          reason: 'customer email owner@example.test; token=secret-value',
          note: 'password=secret-value',
          totpCode: '123456',
          authorization: 'Bearer secret-value',
        },
      },
      {
        id: 'event-2',
        createdAt: new Date('2026-10-07T00:00:00.000Z'),
        actorUserId: 'actor-1',
        actor: { id: 'actor-1', email: 'admin@example.test' },
        action: 'EMPLOYEE_UPDATED',
        entityType: 'Employee',
        entityId: 'employee-1',
        metadata: {
          before: {
            fullName: 'A. Person',
            territory: { token: 'secret-value' },
          },
          requested: { status: 'ACTIVE', fullName: ['not', 'a', 'string'] },
        },
      },
    ]);

    const result = await service.list({});

    expect(result.items[0].details).toEqual({
      requestId: 'request-1',
      shopPublicId: 'BC-SHOP-000001',
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(JSON.stringify(result)).not.toContain('owner@example.test');
    expect(result.items[1].details).toEqual({
      before: { fullName: 'A. Person' },
      requested: { status: 'ACTIVE' },
    });
  });
});
