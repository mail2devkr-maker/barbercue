import { Role, UserStatus } from '@barbercue/shared';
import { AdminEmployeeManagementService } from './admin-employee-management.service';

describe('AdminEmployeeManagementService', () => {
  let service: AdminEmployeeManagementService;
  let prisma: any;
  let passwords: any;

  const row = {
    id: 'ep1',
    userId: 'u1',
    employeeCode: 'FQ-FE-00001',
    fullName: 'Field Executive',
    territory: 'Patna',
    joinedAt: new Date('2026-09-20T00:00:00Z'),
    createdAt: new Date('2026-09-20T00:00:00Z'),
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    user: {
      id: 'u1',
      status: UserStatus.ACTIVE,
      passwordHash: 'hash',
    },
  };

  beforeEach(() => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      employeeProfile: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(row),
        create: jest.fn().mockResolvedValue({ id: 'ep1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        create: jest.fn().mockResolvedValue({ id: 'u1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      userRole: { create: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      ...tx,
      employeeProfile: {
        ...tx.employeeProfile,
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(row),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
      __tx: tx,
    };
    passwords = {
      hash: jest.fn().mockResolvedValue('secure-hash'),
    };
    service = new AdminEmployeeManagementService(prisma, passwords);
  });

  it('creates a global FIELD_EXECUTIVE with an auto-generated employee code', async () => {
    const created = await service.create('admin1', {
      fullName: 'Field Executive',
      territory: 'Patna',
      password: 'TempPass123',
      confirmPassword: 'TempPass123',
    });

    expect(passwords.hash).toHaveBeenCalledWith('TempPass123');
    expect(prisma.__tx.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        role: Role.FIELD_EXECUTIVE,
        salonId: null,
      },
    });
    expect(prisma.__tx.employeeProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeCode: 'FQ-FE-00001',
        fullName: 'Field Executive',
        territory: 'Patna',
      }),
    });
    expect(created.employeeCode).toBe('FQ-FE-00001');
  });

  it('suspends an employee and revokes active sessions', async () => {
    await service.update('admin1', 'ep1', { status: UserStatus.SUSPENDED });

    expect(prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: UserStatus.SUSPENDED },
    });
    expect(prisma.__tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('resets the password and revokes active sessions', async () => {
    await service.resetPassword('admin1', 'ep1', {
      password: 'NewPass123',
      confirmPassword: 'NewPass123',
    });

    expect(passwords.hash).toHaveBeenCalledWith('NewPass123');
    expect(prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'secure-hash' },
    });
    expect(prisma.__tx.refreshToken.updateMany).toHaveBeenCalled();
  });
});
