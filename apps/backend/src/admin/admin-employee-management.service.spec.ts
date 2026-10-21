import { Role, UserStatus } from '@barbercue/shared';
import { AdminEmployeeManagementService } from './admin-employee-management.service';

describe('AdminEmployeeManagementService', () => {
  let service: AdminEmployeeManagementService;
  let prisma: any;
  let passwords: any;
  let totp: any;
  let crypto: any;

  const standardRow = {
    id: 'ep1',
    userId: 'u1',
    employeeCode: 'FQ-FE-00101',
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

  const specialRow = {
    ...standardRow,
    id: 'ep-special',
    userId: 'u-special',
    employeeCode: 'FQ-FE-00007',
    fullName: 'Special Executive',
    user: {
      ...standardRow.user,
      id: 'u-special',
    },
  };

  beforeEach(() => {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      employeeProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: data.employeeCode === 'FQ-FE-00007' ? 'ep-special' : 'ep1',
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      employeeIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'identity-special' }),
      },
      employeeEmploymentEpisode: {
        create: jest.fn().mockResolvedValue({ id: 'episode-special' }),
      },
      employeeHrEvent: { create: jest.fn().mockResolvedValue({}) },
      user: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: data.passwordHash === 'secure-hash' ? 'u1' : 'u-special',
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      userRole: { create: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      ...tx,
      employeeProfile: {
        findMany: jest.fn().mockResolvedValue([standardRow]),
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve(
              where.id === 'ep-special' ? specialRow : standardRow,
            ),
          ),
      },
      user: {
        ...tx.user,
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin1',
          status: UserStatus.ACTIVE,
          twoFactorEnabled: true,
          totpSecret: 'encrypted-secret',
          roles: [{ role: Role.PLATFORM_ADMIN, salonId: null }],
        }),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
      __tx: tx,
    };

    passwords = {
      hash: jest.fn().mockResolvedValue('secure-hash'),
    };
    totp = {
      verifyToken: jest.fn().mockResolvedValue(true),
    };
    crypto = {
      decrypt: jest.fn().mockReturnValue('totp-secret'),
    };

    service = new AdminEmployeeManagementService(
      prisma,
      passwords,
      totp,
      crypto,
    );
  });

  it('does not expose the registry until the server-side feature flag is enabled', async () => {
    const original = process.env.HR_EMPLOYEE_REGISTRY_ENABLED;
    delete process.env.HR_EMPLOYEE_REGISTRY_ENABLED;
    const { AdminEmployeeRegistryService } =
      await import('./admin-employee-registry.service');
    const registry = new AdminEmployeeRegistryService(
      prisma,
      crypto,
      passwords,
    );
    try {
      await expect(
        registry.search({ q: 'candidate', limit: 10 }),
      ).rejects.toMatchObject({
        code: 'HR_EMPLOYEE_REGISTRY_DISABLED',
      });
    } finally {
      if (original === undefined)
        delete process.env.HR_EMPLOYEE_REGISTRY_ENABLED;
      else process.env.HR_EMPLOYEE_REGISTRY_ENABLED = original;
    }
  });

  it('blocks legacy direct creation until an official offer is issued and joining is confirmed', async () => {
    await expect(
      service.create('admin1', {
        fullName: 'Field Executive',
        territory: 'Patna',
        password: 'TempPass123',
        confirmPassword: 'TempPass123',
      }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_HR_REGISTRY_REQUIRED' });
    expect(prisma.__tx.employeeProfile.create).not.toHaveBeenCalled();
    expect(prisma.__tx.user.create).not.toHaveBeenCalled();
  });

  it('creates an exact reserved ID only after fresh admin TOTP verification', async () => {
    const created = await service.createSpecial('admin1', {
      employeeNumber: 7,
      fullName: 'Special Executive',
      territory: 'Patna',
      password: 'TempPass123',
      confirmPassword: 'TempPass123',
      totpCode: '123456',
    });

    expect(crypto.decrypt).toHaveBeenCalledWith('encrypted-secret');
    expect(totp.verifyToken).toHaveBeenCalledWith('totp-secret', '123456');
    expect(prisma.__tx.employeeProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeCode: 'FQ-FE-00007',
        fullName: 'Special Executive',
      }),
    });
    expect(prisma.__tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin1',
        action: 'SPECIAL_EMPLOYEE_CREATED',
        metadata: expect.objectContaining({
          employeeCode: 'FQ-FE-00007',
          reservedNumber: 7,
          totpReauthenticated: true,
        }),
      }),
    });
    expect(created.employeeCode).toBe('FQ-FE-00007');
  });

  it('refuses a reserved ID when the fresh authenticator code is invalid', async () => {
    totp.verifyToken.mockResolvedValueOnce(false);

    await expect(
      service.createSpecial('admin1', {
        employeeNumber: 7,
        fullName: 'Special Executive',
        territory: 'Patna',
        password: 'TempPass123',
        confirmPassword: 'TempPass123',
        totpCode: '000000',
      }),
    ).rejects.toMatchObject({ code: 'TOTP_INVALID' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
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

  it('blocks reactivation outside the HR joining flow', async () => {
    prisma.employeeProfile.findUnique.mockResolvedValueOnce({
      ...standardRow,
      user: { ...standardRow.user, status: UserStatus.SUSPENDED },
    });
    await expect(
      service.update('admin1', 'ep1', { status: UserStatus.ACTIVE }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_REJOIN_ACTION_REQUIRED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
