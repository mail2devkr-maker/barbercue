import { AuthErrorCode, Role, UserStatus } from '@barbercue/shared';
import { AdminAccessManagementService } from './admin-access-management.service';

describe('AdminAccessManagementService', () => {
  const actorUserId = 'platform-admin-1';
  const targetUserId = 'target-1';
  const createdAt = new Date('2026-10-01T00:00:00.000Z');

  function build() {
    const targetUser = {
      id: targetUserId,
      email: 'new.admin@example.com',
      status: UserStatus.ACTIVE,
      createdAt,
      passwordHash: 'must-not-leak',
      totpSecret: 'must-not-leak',
      roles: [
        { role: Role.HR_ADMIN, salonId: null },
        // Malformed rows are excluded from the management projection even before the DB check
        // constraint is relied upon.
        { role: Role.CO_FOUNDER, salonId: 'salon-1' },
      ],
    };
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: targetUserId }),
      },
      userRole: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([targetUser]) },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    return {
      service: new AdminAccessManagementService(prisma as never),
      prisma,
      tx,
    };
  }

  it('grants only a managed global role, audits the real actor, and revokes the target sessions', async () => {
    const { service, prisma, tx } = build();

    const result = await service.grant(
      actorUserId,
      ' New.Admin@Example.com ',
      Role.HR_ADMIN,
    );

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'new.admin@example.com' },
    });
    expect(tx.userRole.create).toHaveBeenCalledWith({
      data: { userId: targetUserId, role: Role.HR_ADMIN, salonId: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId,
        action: 'ADMIN_ACCESS_GRANTED',
        entityType: 'User',
        entityId: targetUserId,
        metadata: { email: 'new.admin@example.com', role: Role.HR_ADMIN },
      },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(result[0].roles).toEqual([Role.HR_ADMIN]);
    expect(result[0]).not.toHaveProperty('passwordHash');
    expect(result[0]).not.toHaveProperty('totpSecret');
  });

  it('revokes only the selected managed role, audits it, and invalidates target refresh sessions', async () => {
    const { service, tx } = build();

    await service.revoke(actorUserId, targetUserId, Role.SALES_ADMIN);

    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: targetUserId, role: Role.SALES_ADMIN, salonId: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId,
        action: 'ADMIN_ACCESS_REVOKED',
        entityType: 'User',
        entityId: targetUserId,
        metadata: { role: Role.SALES_ADMIN },
      },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
  });

  it.each(['grant', 'revoke'] as const)(
    'does not allow PLATFORM_ADMIN to be removed or changed through %s',
    async (operation) => {
      const { service, prisma } = build();
      const platformAdmin = Role.PLATFORM_ADMIN as never;

      const result =
        operation === 'grant'
          ? service.grant(actorUserId, 'target@example.com', platformAdmin)
          : service.revoke(actorUserId, targetUserId, platformAdmin);

      await expect(result).rejects.toMatchObject({
        code: AuthErrorCode.FORBIDDEN_ROLE,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
