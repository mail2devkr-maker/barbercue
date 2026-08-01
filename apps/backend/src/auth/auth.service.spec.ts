import { Test } from '@nestjs/testing';
import { AuthErrorCode, Role, UserStatus } from '@barbercue/shared';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import { TotpService } from './services/totp.service';
import { CryptoService } from './services/crypto.service';
import { EMAIL_SENDER } from './services/email-sender';
import { AppException } from '../common/exceptions/app.exception';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    passwordResetToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let passwordService: { hash: jest.Mock; compare: jest.Mock };
  let tokenService: {
    issueTokenPair: jest.Mock;
    rotateRefreshToken: jest.Mock;
    revokeRefreshToken: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let otpService: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let totpService: { verifyToken: jest.Mock };
  let cryptoService: { decrypt: jest.Mock };
  let emailSender: { sendPasswordReset: jest.Mock };

  const fakeTokens = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    passwordService = { hash: jest.fn(), compare: jest.fn() };
    tokenService = {
      issueTokenPair: jest.fn().mockResolvedValue(fakeTokens),
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    otpService = { requestOtp: jest.fn(), verifyOtp: jest.fn() };
    totpService = { verifyToken: jest.fn() };
    cryptoService = { decrypt: jest.fn() };
    emailSender = { sendPasswordReset: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
        { provide: OtpService, useValue: otpService },
        { provide: TotpService, useValue: totpService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: EMAIL_SENDER, useValue: emailSender },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('verifyCustomerOtp', () => {
    it('creates a new CUSTOMER user on first-ever OTP verification for a phone number', async () => {
      otpService.verifyOtp.mockResolvedValue(undefined);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        phone: '+919876543210',
        email: null,
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });

      const result = await service.verifyCustomerOtp('+919876543210', '123456');

      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.user.roles).toEqual([Role.CUSTOMER]);
      expect(result.tokens).toBe(fakeTokens);
    });

    it('reuses the existing user on a returning customer and does not create a duplicate', async () => {
      otpService.verifyOtp.mockResolvedValue(undefined);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        phone: '+919876543210',
        email: null,
        phoneVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });

      await service.verifyCustomerOtp('+919876543210', '123456');

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('propagates OTP failures without issuing tokens', async () => {
      otpService.verifyOtp.mockRejectedValue(
        new AppException(AuthErrorCode.OTP_INVALID, 'bad', 400),
      );
      await expect(
        service.verifyCustomerOtp('+919876543210', '000000'),
      ).rejects.toThrow(AppException);
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects a suspended customer even with a correct OTP', async () => {
      otpService.verifyOtp.mockResolvedValue(undefined);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        phone: '+919876543210',
        email: null,
        phoneVerifiedAt: new Date(),
        status: UserStatus.SUSPENDED,
        roles: [{ role: Role.CUSTOMER }],
      });
      await expect(
        service.verifyCustomerOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.ACCOUNT_SUSPENDED,
      });
    });
  });

  describe('staffLogin', () => {
    it('logs in a valid staff member', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u2',
        email: 'staff@salon.com',
        phone: null,
        passwordHash: 'hash',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.SALON_STAFF }],
      });
      passwordService.compare.mockResolvedValue(true);

      const result = await service.staffLogin(
        'staff@salon.com',
        'correct-password',
      );
      expect(result.user.roles).toEqual([Role.SALON_STAFF]);
    });

    it('rejects an unknown email with the same error as a wrong password (no user enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      passwordService.compare.mockResolvedValue(false);
      await expect(
        service.staffLogin('nobody@nowhere.com', 'whatever'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
      // Still compares against a hash even for a nonexistent user — constant-shape failure path.
      expect(passwordService.compare).toHaveBeenCalled();
    });

    it('rejects a correct password for a user who is not staff/owner (e.g. a customer)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u3',
        email: 'customer@example.com',
        passwordHash: 'hash',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });
      passwordService.compare.mockResolvedValue(true);
      await expect(
        service.staffLogin('customer@example.com', 'correct-password'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    });

    it('rejects a suspended staff account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u4',
        email: 'staff@salon.com',
        passwordHash: 'hash',
        status: UserStatus.SUSPENDED,
        roles: [{ role: Role.SALON_STAFF }],
      });
      passwordService.compare.mockResolvedValue(true);
      await expect(
        service.staffLogin('staff@salon.com', 'correct-password'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.ACCOUNT_SUSPENDED,
      });
    });
  });

  describe('adminLogin', () => {
    const adminUser = {
      id: 'admin1',
      email: 'admin@barbercue.app',
      passwordHash: 'hash',
      status: UserStatus.ACTIVE,
      twoFactorEnabled: true,
      totpSecret: 'encrypted-secret',
      roles: [{ role: Role.PLATFORM_ADMIN }],
    };

    it('requires a TOTP code even with a correct password', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      passwordService.compare.mockResolvedValue(true);
      await expect(
        service.adminLogin(
          'admin@barbercue.app',
          'correct-password',
          undefined,
        ),
      ).rejects.toMatchObject({
        code: AuthErrorCode.TOTP_REQUIRED,
      });
    });

    it('rejects an incorrect TOTP code', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      passwordService.compare.mockResolvedValue(true);
      cryptoService.decrypt.mockReturnValue('plain-secret');
      totpService.verifyToken.mockResolvedValue(false);
      await expect(
        service.adminLogin('admin@barbercue.app', 'correct-password', '000000'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.TOTP_INVALID,
      });
    });

    it('logs in with a correct password and correct TOTP code', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUser);
      passwordService.compare.mockResolvedValue(true);
      cryptoService.decrypt.mockReturnValue('plain-secret');
      totpService.verifyToken.mockResolvedValue(true);
      const result = await service.adminLogin(
        'admin@barbercue.app',
        'correct-password',
        '123456',
      );
      expect(result.user.roles).toEqual([Role.PLATFORM_ADMIN]);
    });

    it('refuses to bypass 2FA even if somehow disabled on an admin account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...adminUser,
        twoFactorEnabled: false,
        totpSecret: null,
      });
      passwordService.compare.mockResolvedValue(true);
      await expect(
        service.adminLogin(
          'admin@barbercue.app',
          'correct-password',
          undefined,
        ),
      ).rejects.toMatchObject({
        code: AuthErrorCode.TOTP_SETUP_REQUIRED,
      });
    });
  });

  describe('forgotPassword / resetPassword', () => {
    it('returns no dev URL and sends no email for an email that has no password (e.g. customer or nonexistent)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('nobody@nowhere.com');
      expect(result).toEqual({});
      expect(emailSender.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('creates a reset token and emails it for a real staff/owner/admin account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'owner@salon.com',
        passwordHash: 'hash',
      });
      prisma.passwordResetToken.create.mockResolvedValue({});
      const result = await service.forgotPassword('owner@salon.com');
      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(emailSender.sendPasswordReset).toHaveBeenCalled();
      expect(result.devResetUrl).toContain('/reset-password?token=');
    });

    it('rejects an unknown or already-used reset token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPassword('bad-token', 'newpassword123'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.RESET_TOKEN_INVALID,
      });
    });

    it('rejects an expired reset token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword('expired-token', 'newpassword123'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.RESET_TOKEN_EXPIRED,
      });
    });

    it('updates the password and revokes all sessions on a valid reset', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      passwordService.hash.mockResolvedValue('new-hash');
      await service.resetPassword('good-token', 'newpassword123');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
  });
});
