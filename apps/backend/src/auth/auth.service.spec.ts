import { Test } from '@nestjs/testing';
import { AuthErrorCode, Language, Role, UserStatus } from '@barbercue/shared';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import { TotpService } from './services/totp.service';
import { CryptoService } from './services/crypto.service';
import { GoogleAuthService } from './services/google-auth.service';
import { EMAIL_SENDER } from './services/email-sender';
import { AppException } from '../common/exceptions/app.exception';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    authIdentity: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    userRole: {
      create: jest.Mock;
    };
    passwordResetToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    refreshToken: { updateMany: jest.Mock };
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
  let googleAuthService: { verifyIdToken: jest.Mock };
  let emailSender: {
    assertAvailable: jest.Mock;
    sendPasswordReset: jest.Mock;
    sendStaffInvitation: jest.Mock;
  };

  const fakeTokens = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 900,
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      authIdentity: { findUnique: jest.fn(), create: jest.fn() },
      userRole: { create: jest.fn() },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      // Supports both call shapes AuthService actually uses: the array form
      // (resetPassword's batch of writes) and the interactive-callback form (googleLogin's
      // find-or-create) — same dual-mode mock pattern as the rest of this backend's test suite.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
          : Promise.all(arg as unknown[]),
      ),
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
    googleAuthService = { verifyIdToken: jest.fn() };
    emailSender = {
      assertAvailable: jest.fn(),
      sendPasswordReset: jest.fn(),
      sendStaffInvitation: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
        { provide: OtpService, useValue: otpService },
        { provide: TotpService, useValue: totpService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: GoogleAuthService, useValue: googleAuthService },
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

  describe('googleLogin', () => {
    const verifiedIdentity = {
      sub: 'google-sub-123',
      email: 'alex@example.com',
      name: 'Alex',
    };

    it('creates a new CUSTOMER user + AuthIdentity when neither the sub nor the email matches anything existing', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        phone: null,
        email: 'alex@example.com',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });

      const result = await service.googleLogin('id-token');

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'alex@example.com',
            roles: { create: { role: Role.CUSTOMER } },
            authIdentities: {
              create: {
                provider: 'GOOGLE',
                providerSub: 'google-sub-123',
                email: 'alex@example.com',
              },
            },
          }),
        }),
      );
      expect(result.user.roles).toEqual([Role.CUSTOMER]);
      expect(result.tokens).toBe(fakeTokens);
      // No redundant extra role grant — the just-created user already has CUSTOMER.
      expect(prisma.userRole.create).not.toHaveBeenCalled();
    });

    it('logs in as the existing linked user on a repeat Google login — never creates a duplicate', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'ai1',
        user: {
          id: 'u1',
          phone: null,
          email: 'alex@example.com',
          status: UserStatus.ACTIVE,
          roles: [{ role: Role.CUSTOMER }],
        },
      });

      const result = await service.googleLogin('id-token');

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(result.user.roles).toEqual([Role.CUSTOMER]);
    });

    it('links a new Google identity to an existing user matched by verified email, without creating a duplicate customer', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-customer',
        phone: '+919876543210',
        email: 'alex@example.com',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });

      const result = await service.googleLogin('id-token');

      expect(prisma.authIdentity.create).toHaveBeenCalledWith({
        data: {
          userId: 'existing-customer',
          provider: 'GOOGLE',
          providerSub: 'google-sub-123',
          email: 'alex@example.com',
        },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.user.roles).toEqual([Role.CUSTOMER]);
      expect(prisma.userRole.create).not.toHaveBeenCalled();
    });

    it('links to an existing staff account by verified email and grants CUSTOMER too, without touching the staff role', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-staff',
        phone: null,
        email: 'alex@example.com',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.SALON_STAFF }],
      });

      const result = await service.googleLogin('id-token');

      expect(prisma.authIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'existing-staff' }) }),
      );
      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'existing-staff', role: Role.CUSTOMER },
      });
      expect(result.user.roles).toEqual(
        expect.arrayContaining([Role.SALON_STAFF, Role.CUSTOMER]),
      );
    });

    it('propagates an invalid Google token without touching the database or issuing tokens', async () => {
      googleAuthService.verifyIdToken.mockRejectedValue(
        new AppException(AuthErrorCode.GOOGLE_TOKEN_INVALID, 'bad token', 401),
      );
      await expect(service.googleLogin('bad-token')).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_TOKEN_INVALID,
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects a suspended account matched via Google, even with a fully valid token', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'ai1',
        user: {
          id: 'u1',
          email: 'alex@example.com',
          status: UserStatus.SUSPENDED,
          roles: [{ role: Role.CUSTOMER }],
        },
      });
      await expect(service.googleLogin('id-token')).rejects.toMatchObject({
        code: AuthErrorCode.ACCOUNT_SUSPENDED,
      });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });
  });

  describe('staffGoogleLogin', () => {
    const verifiedIdentity = {
      sub: 'google-sub-999',
      email: 'owner@example.com',
      name: 'Priya',
    };

    it('authenticates an existing OWNER account matched by verified email, and links the identity', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner-1',
        phone: null,
        email: 'owner@example.com',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.SALON_OWNER }],
      });

      const result = await service.staffGoogleLogin('id-token');

      expect(prisma.authIdentity.create).toHaveBeenCalledWith({
        data: {
          userId: 'owner-1',
          provider: 'GOOGLE',
          providerSub: 'google-sub-999',
          email: 'owner@example.com',
        },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userRole.create).not.toHaveBeenCalled();
      expect(result.user.roles).toEqual([Role.SALON_OWNER]);
      expect(result.tokens).toBe(fakeTokens);
    });

    it('authenticates an existing STAFF account the same way', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'staff-1',
        phone: null,
        email: 'owner@example.com',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.SALON_STAFF }],
      });

      const result = await service.staffGoogleLogin('id-token');

      expect(result.user.roles).toEqual([Role.SALON_STAFF]);
      expect(prisma.userRole.create).not.toHaveBeenCalled();
    });

    it('logs in via an already-linked identity on a repeat login — never re-queries by email or creates a duplicate', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'ai1',
        user: {
          id: 'owner-1',
          email: 'owner@example.com',
          status: UserStatus.ACTIVE,
          roles: [{ role: Role.SALON_OWNER }],
        },
      });

      const result = await service.staffGoogleLogin('id-token');

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.user.roles).toEqual([Role.SALON_OWNER]);
    });

    it('rejects a customer-only account matched by email — never links the identity, never elevates the account', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'customer-1',
        phone: '+919876543210',
        email: 'owner@example.com',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });

      await expect(service.staffGoogleLogin('id-token')).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_STAFF,
      });
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(prisma.userRole.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects a Google account with no matching user at all — creates nothing', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.staffGoogleLogin('id-token')).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_STAFF,
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects a verified Google token with no email claim and no existing linked identity', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue({ sub: 'google-sub-no-email', email: null, name: null });
      prisma.authIdentity.findUnique.mockResolvedValue(null);

      await expect(service.staffGoogleLogin('id-token')).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_STAFF,
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('re-checks roles on the linked user even on a repeat login — rejects if the role was since removed', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'ai1',
        user: {
          id: 'former-owner',
          email: 'owner@example.com',
          status: UserStatus.ACTIVE,
          roles: [{ role: Role.CUSTOMER }],
        },
      });

      await expect(service.staffGoogleLogin('id-token')).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_STAFF,
      });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('propagates an invalid Google token without touching the database or issuing tokens', async () => {
      googleAuthService.verifyIdToken.mockRejectedValue(
        new AppException(AuthErrorCode.GOOGLE_TOKEN_INVALID, 'bad token', 401),
      );
      await expect(service.staffGoogleLogin('bad-token')).rejects.toMatchObject({
        code: AuthErrorCode.GOOGLE_TOKEN_INVALID,
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects a suspended owner account, even with a fully valid token and a linked identity', async () => {
      googleAuthService.verifyIdToken.mockResolvedValue(verifiedIdentity);
      prisma.authIdentity.findUnique.mockResolvedValue({
        id: 'ai1',
        user: {
          id: 'owner-1',
          email: 'owner@example.com',
          status: UserStatus.SUSPENDED,
          roles: [{ role: Role.SALON_OWNER }],
        },
      });
      await expect(service.staffGoogleLogin('id-token')).rejects.toMatchObject({
        code: AuthErrorCode.ACCOUNT_SUSPENDED,
      });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
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

  describe('adminGoogleLogin', () => {
    const verified = { sub: 'google-admin', email: 'admin@barbercue.app' };
    const admin = {
      id: 'admin1',
      email: 'admin@barbercue.app',
      phone: null,
      passwordHash: 'hash',
      preferredLanguage: Language.EN,
      status: UserStatus.ACTIVE,
      twoFactorEnabled: true,
      totpSecret: 'encrypted-secret',
      roles: [{ role: Role.PLATFORM_ADMIN }],
    };

    beforeEach(() => {
      googleAuthService.verifyIdToken.mockResolvedValue(verified);
      cryptoService.decrypt.mockReturnValue('plain-secret');
    });

    it('never issues a session before the mandatory authenticator code', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue({ user: admin });
      await expect(
        service.adminGoogleLogin('id-token', undefined),
      ).rejects.toMatchObject({ code: AuthErrorCode.TOTP_REQUIRED });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects an invalid authenticator code', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue({ user: admin });
      totpService.verifyToken.mockResolvedValue(false);
      await expect(
        service.adminGoogleLogin('id-token', '000000'),
      ).rejects.toMatchObject({ code: AuthErrorCode.TOTP_INVALID });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('signs in a linked active admin only after valid TOTP', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue({ user: admin });
      totpService.verifyToken.mockResolvedValue(true);
      const result = await service.adminGoogleLogin('id-token', '123456');
      expect(result.user.roles).toEqual([Role.PLATFORM_ADMIN]);
      expect(tokenService.issueTokenPair).toHaveBeenCalledWith(
        'admin1',
        [Role.PLATFORM_ADMIN],
        undefined,
      );
    });

    it.each([
      ['customer', Role.CUSTOMER],
      ['owner', Role.SALON_OWNER],
      ['staff', Role.SALON_STAFF],
    ])('rejects a linked %s-only account after re-checking current roles', async (_label, role) => {
      prisma.authIdentity.findUnique.mockResolvedValue({
        user: { ...admin, roles: [{ role }] },
      });
      await expect(
        service.adminGoogleLogin('id-token', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects an unknown Google user without creating a User or role', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.adminGoogleLogin('id-token', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.userRole.create).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
    });

    it('does not link or elevate an unlinked customer whose verified email matches', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        ...admin,
        id: 'customer1',
        roles: [{ role: Role.CUSTOMER }],
      });
      await expect(
        service.adminGoogleLogin('id-token', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN });
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(prisma.userRole.create).not.toHaveBeenCalled();
    });

    it('links a verified matching email only when the existing user is already an admin', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(admin);
      totpService.verifyToken.mockResolvedValue(true);
      await service.adminGoogleLogin('id-token', '123456');
      expect(prisma.authIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'admin1' }),
      });
      expect(prisma.userRole.create).not.toHaveBeenCalled();
    });

    it('rejects a suspended admin even when Google and TOTP are valid', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue({
        user: { ...admin, status: UserStatus.SUSPENDED },
      });
      await expect(
        service.adminGoogleLogin('id-token', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.ACCOUNT_SUSPENDED });
      expect(tokenService.issueTokenPair).not.toHaveBeenCalled();
    });

    it('rejects an admin without configured TOTP rather than bypassing MFA', async () => {
      prisma.authIdentity.findUnique.mockResolvedValue({
        user: { ...admin, twoFactorEnabled: false, totpSecret: null },
      });
      await expect(
        service.adminGoogleLogin('id-token', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.TOTP_SETUP_REQUIRED });
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
        roles: [{ role: Role.SALON_OWNER }],
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
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('allows only one concurrent consumer to claim a reset token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.passwordResetToken.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      passwordService.hash.mockResolvedValue('new-hash');
      const results = await Promise.allSettled([
        service.resetPassword('good-token', 'newpassword123'),
        service.resetPassword('good-token', 'newpassword123'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });
  });

  describe('setInitialPassword', () => {
    it('sets the first password on the authenticated verified-email user only', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'google-owner',
        email: 'owner@example.com',
        emailVerifiedAt: new Date(),
        phone: null,
        passwordHash: null,
        preferredLanguage: Language.EN,
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.CUSTOMER }],
      });
      passwordService.hash.mockResolvedValue('new-hash');
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.setInitialPassword('google-owner', 'longenough');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'google-owner', passwordHash: null },
        data: { passwordHash: 'new-hash' },
      });
      expect(result.passwordConfigured).toBe(true);
    });

    it('does not overwrite an existing password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'owner',
        email: 'owner@example.com',
        emailVerifiedAt: new Date(),
        passwordHash: 'existing',
        status: UserStatus.ACTIVE,
        roles: [{ role: Role.SALON_OWNER }],
      });
      await expect(
        service.setInitialPassword('owner', 'newpassword'),
      ).rejects.toMatchObject({ code: AuthErrorCode.PASSWORD_ALREADY_CONFIGURED });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('me / setLanguage (Phase 14)', () => {
    it('includes preferredLanguage in the me() response', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        phone: '+919876543210',
        email: null,
        preferredLanguage: 'HI',
      });
      const result = await service.me('u1', [Role.CUSTOMER]);
      expect(result.preferredLanguage).toBe('HI');
    });

    it('updates preferredLanguage and returns it in the response, without touching roles', async () => {
      prisma.user.update.mockResolvedValue({
        id: 'u1',
        phone: '+919876543210',
        email: null,
        preferredLanguage: 'HI',
      });
      const result = await service.setLanguage('u1', [Role.SALON_OWNER], Language.HI);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { preferredLanguage: 'HI' },
      });
      expect(result).toEqual({
        id: 'u1',
        roles: [Role.SALON_OWNER],
        phone: '+919876543210',
        email: null,
        preferredLanguage: 'HI',
        passwordConfigured: false,
      });
    });
  });
});
