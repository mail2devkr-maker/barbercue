import { AuthErrorCode, Role, UserStatus } from '@barbercue/shared';
import { AdminTotpBootstrapController } from './admin-totp-bootstrap.controller';

describe('AdminTotpBootstrapController recovery', () => {
  const adminUser = {
    id: 'admin-1',
    email: 'admin@example.com',
    status: UserStatus.ACTIVE,
    twoFactorEnabled: true,
    totpSecret: 'restored-ciphertext',
    roles: [{ role: Role.PLATFORM_ADMIN, salonId: null }],
  };

  function build() {
    const prisma = {
      authIdentity: {
        findUnique: jest.fn().mockResolvedValue({ user: adminUser }),
      },
      user: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const googleAuth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        sub: 'google-admin',
        email: 'admin@example.com',
      }),
    };
    const totp = {
      generateSecret: jest.fn().mockReturnValue('NEW-TOTP-SECRET'),
      buildOtpAuthUri: jest.fn().mockReturnValue('otpauth://new'),
    };
    const crypto = {
      decrypt: jest.fn(),
      encrypt: jest.fn().mockReturnValue('new-encrypted-secret'),
    };
    const controller = new AdminTotpBootstrapController(
      prisma as never,
      googleAuth as never,
      totp as never,
      crypto as never,
    );
    return { controller, prisma, googleAuth, totp, crypto };
  }

  it('atomically replaces only an undecryptable restored secret and starts fresh enrollment', async () => {
    const { controller, prisma, crypto } = build();
    crypto.decrypt.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await controller.setup({ idToken: 'valid-google-token' });

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'admin-1',
        twoFactorEnabled: true,
        totpSecret: 'restored-ciphertext',
      },
      data: {
        twoFactorEnabled: false,
        totpSecret: 'new-encrypted-secret',
      },
    });
    expect(result).toEqual({
      otpAuthUri: 'otpauth://new',
      manualKey: 'NEW-TOTP-SECRET',
    });
  });

  it('does not reset a healthy configured authenticator', async () => {
    const { controller, prisma, crypto } = build();
    crypto.decrypt.mockReturnValue('working-secret');

    await expect(
      controller.setup({ idToken: 'valid-google-token' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.TOTP_REQUIRED });

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });


  it('allows an approved global PLATFORM_VIEWER to enroll TOTP', async () => {
    const { controller, prisma, crypto } = build();
    prisma.authIdentity.findUnique.mockResolvedValue({
      user: {
        ...adminUser,
        id: 'viewer-1',
        email: 'viewer@example.com',
        twoFactorEnabled: false,
        totpSecret: null,
        roles: [{ role: Role.PLATFORM_VIEWER, salonId: null }],
      },
    });
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    crypto.encrypt.mockReturnValue('viewer-encrypted-secret');

    await expect(
      controller.setup({ idToken: 'valid-google-token' }),
    ).resolves.toEqual({
      otpAuthUri: 'otpauth://new',
      manualKey: 'NEW-TOTP-SECRET',
    });
  });

  it.each([Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN])(
    'allows a global %s to bootstrap mandatory TOTP',
    async (role) => {
      const { controller, prisma } = build();
      prisma.authIdentity.findUnique.mockResolvedValue({
        user: {
          ...adminUser,
          id: `${role.toLowerCase()}-1`,
          twoFactorEnabled: false,
          totpSecret: null,
          roles: [{ role, salonId: null }],
        },
      });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await expect(controller.setup({ idToken: 'valid-google-token' })).resolves.toMatchObject({
        otpAuthUri: 'otpauth://new',
        manualKey: 'NEW-TOTP-SECRET',
      });
    },
  );

  it('still resolves only an already-authorized global platform admin', async () => {
    const { controller, prisma, crypto } = build();
    prisma.authIdentity.findUnique.mockResolvedValue({
      user: {
        ...adminUser,
        roles: [{ role: Role.CUSTOMER, salonId: null }],
      },
    });
    crypto.decrypt.mockReturnValue('working-secret');

    await expect(
      controller.setup({ idToken: 'valid-google-token' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN });

    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it.each([Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN, Role.PLATFORM_VIEWER])(
    'fails closed for malformed salon-scoped %s role rows',
    async (role) => {
      const { controller, prisma, crypto } = build();
      prisma.authIdentity.findUnique.mockResolvedValue({
        user: { ...adminUser, roles: [{ role, salonId: 'salon-1' }] },
      });
      crypto.decrypt.mockReturnValue('working-secret');

      await expect(controller.setup({ idToken: 'valid-google-token' })).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    },
  );
});
