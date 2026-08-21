import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  AuthErrorCode,
  AuthProvider,
  Role,
  UserStatus,
  type AuthSession,
  type AuthTokens,
  type MeResponse,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import { TotpService } from './services/totp.service';
import { CryptoService } from './services/crypto.service';
import { GoogleAuthService } from './services/google-auth.service';
import { EMAIL_SENDER, type EmailSender } from './services/email-sender';

const PASSWORD_RESET_TTL_MINUTES = 15;

function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    private readonly totpService: TotpService,
    private readonly cryptoService: CryptoService,
    private readonly googleAuthService: GoogleAuthService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  // ---------- Customer: phone OTP ----------

  requestCustomerOtp(phone: string) {
    return this.otpService.requestOtp(phone);
  }

  async verifyCustomerOtp(
    phone: string,
    code: string,
    deviceInfo?: string,
  ): Promise<{ user: MeResponse; tokens: AuthTokens }> {
    await this.otpService.verifyOtp(phone, code);

    let user = await this.prisma.user.findUnique({
      where: { phone },
      include: { roles: true },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          phoneVerifiedAt: new Date(),
          roles: { create: { role: Role.CUSTOMER } },
        },
        include: { roles: true },
      });
    } else if (!user.phoneVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    this.assertActive(user.status);
    const roles = user.roles.map((r) => r.role);
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      roles,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(user.id, roles, user.phone, user.email),
      tokens,
    };
  }

  // ---------- Customer: Google Sign-In ----------

  /**
   * Sign-in-or-create for Google, in three steps, in this exact priority order:
   *   1. An AuthIdentity already links this exact Google account (`sub`) — log in as its user.
   *   2. No link yet, but the (Google-verified, never client-asserted) email matches an existing
   *      User — link this Google account to that user rather than creating a duplicate. This is
   *      intentionally role-agnostic: if that user happens to already be staff/owner/admin (same
   *      real person, different login path), Google sign-in never touches or removes their
   *      existing roles — it only guarantees they *also* have CUSTOMER access, since that's what
   *      "sign in with Google as a customer" means. Staff/owner/admin authentication itself is
   *      untouched by this method entirely.
   *   3. Neither matched — create a brand-new CUSTOMER user + its AuthIdentity, atomically.
   */
  async googleLogin(
    idToken: string,
    deviceInfo?: string,
  ): Promise<{ user: MeResponse; tokens: AuthTokens }> {
    const identity = await this.googleAuthService.verifyIdToken(idToken);

    const user = await this.prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.authIdentity.findUnique({
        where: {
          provider_providerSub: {
            provider: AuthProvider.GOOGLE,
            providerSub: identity.sub,
          },
        },
        include: { user: { include: { roles: true } } },
      });
      if (existingIdentity) return existingIdentity.user;

      if (identity.email) {
        const existingUser = await tx.user.findUnique({
          where: { email: identity.email },
          include: { roles: true },
        });
        if (existingUser) {
          await tx.authIdentity.create({
            data: {
              userId: existingUser.id,
              provider: AuthProvider.GOOGLE,
              providerSub: identity.sub,
              email: identity.email,
            },
          });
          return existingUser;
        }
      }

      return tx.user.create({
        data: {
          email: identity.email,
          emailVerifiedAt: identity.email ? new Date() : null,
          status: UserStatus.ACTIVE,
          roles: { create: { role: Role.CUSTOMER } },
          authIdentities: {
            create: {
              provider: AuthProvider.GOOGLE,
              providerSub: identity.sub,
              email: identity.email,
            },
          },
        },
        include: { roles: true },
      });
    });

    this.assertActive(user.status);

    // Ensure CUSTOMER access exists even for a linked staff/owner/admin account (see the method
    // doc above) — a no-op for the common case (brand-new user or an existing customer), and
    // never removes or alters any role the user already has.
    let roles = user.roles.map((r) => r.role);
    if (!roles.includes(Role.CUSTOMER)) {
      await this.prisma.userRole.create({
        data: { userId: user.id, role: Role.CUSTOMER },
      });
      roles = [...roles, Role.CUSTOMER];
    }

    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      roles,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(user.id, roles, user.phone, user.email),
      tokens,
    };
  }

  // ---------- Staff / Owner: email + password ----------

  async staffLogin(
    email: string,
    password: string,
    deviceInfo?: string,
  ): Promise<{
    user: MeResponse;
    tokens: AuthTokens;
    twoFactorRequired: boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    const roles = user?.roles.map((r) => r.role) ?? [];
    const isStaffOrOwner = roles.some(
      (r) => r === Role.SALON_STAFF || r === Role.SALON_OWNER,
    );

    // Constant-shape failure path: compare against a hash even when the user doesn't exist (or
    // isn't staff/owner), so response timing doesn't leak which emails are registered.
    const passwordHash =
      user?.passwordHash ??
      '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const passwordMatches = await this.passwordService.compare(
      password,
      passwordHash,
    );

    if (!user || !isStaffOrOwner || !passwordMatches) {
      throw new AppException(
        AuthErrorCode.INVALID_CREDENTIALS,
        'Incorrect email or password.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user.status);

    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      roles,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(user.id, roles, user.phone, user.email),
      tokens,
      // Always false in V1 — no staff/owner account can have 2FA enabled yet (only the admin
      // seed script provisions a TOTP secret, and only for PLATFORM_ADMIN). Reserved per API.md
      // so a future POST /auth/staff/2fa/verify step slots in without a response-shape change.
      twoFactorRequired: false,
    };
  }

  // ---------- Platform admin: email + password + mandatory TOTP ----------

  async adminLogin(
    email: string,
    password: string,
    totpCode: string | undefined,
    deviceInfo?: string,
  ): Promise<{ user: MeResponse; tokens: AuthTokens }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    const roles = user?.roles.map((r) => r.role) ?? [];
    const isAdmin = roles.includes(Role.PLATFORM_ADMIN);

    const passwordHash =
      user?.passwordHash ??
      '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const passwordMatches = await this.passwordService.compare(
      password,
      passwordHash,
    );

    if (!user || !isAdmin || !passwordMatches) {
      throw new AppException(
        AuthErrorCode.INVALID_CREDENTIALS,
        'Incorrect email or password.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user.status);

    // Mandatory 2FA for admin per ARCHITECTURE.md §4 — never bypassable, and a clean, honest
    // failure mode if an admin account was somehow created without a TOTP secret provisioned
    // (the seed script always provisions one; see prisma/seed.ts).
    if (!user.twoFactorEnabled || !user.totpSecret) {
      throw new AppException(
        AuthErrorCode.TOTP_SETUP_REQUIRED,
        'Two-factor authentication is not set up for this account.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!totpCode) {
      throw new AppException(
        AuthErrorCode.TOTP_REQUIRED,
        'A 6-digit authenticator code is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const secret = this.cryptoService.decrypt(user.totpSecret);
    const totpValid = await this.totpService.verifyToken(secret, totpCode);
    if (!totpValid) {
      throw new AppException(
        AuthErrorCode.TOTP_INVALID,
        'Incorrect authenticator code.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      roles,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(user.id, roles, user.phone, user.email),
      tokens,
    };
  }

  // ---------- Session lifecycle ----------

  refresh(rawRefreshToken: string, deviceInfo?: string): Promise<AuthTokens> {
    return this.tokenService.rotateRefreshToken(rawRefreshToken, deviceInfo);
  }

  logout(rawRefreshToken: string): Promise<void> {
    return this.tokenService.revokeRefreshToken(rawRefreshToken);
  }

  logoutAll(userId: string): Promise<void> {
    return this.tokenService.revokeAllForUser(userId);
  }

  listSessions(
    userId: string,
    currentRawRefreshToken?: string,
  ): Promise<AuthSession[]> {
    return this.tokenService.listSessions(userId, currentRawRefreshToken);
  }

  revokeSession(userId: string, sessionId: string): Promise<void> {
    return this.tokenService.revokeSession(userId, sessionId);
  }

  async me(userId: string, tokenRoles: Role[]): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException(
        AuthErrorCode.UNAUTHENTICATED,
        'User not found.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.toMeResponse(user.id, tokenRoles, user.phone, user.email);
  }

  // ---------- Forgot / reset password (staff/owner/admin only — customers have no password) ----------

  async forgotPassword(email: string): Promise<{ devResetUrl?: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always behave identically whether or not the email exists, so responses can't be used to
    // enumerate registered accounts.
    if (!user || !user.passwordHash) {
      return {};
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });

    const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3001';
    const resetUrl = `${webBaseUrl}/reset-password?token=${rawToken}`;
    await this.emailSender.sendPasswordReset(email, resetUrl);

    // Dev-only convenience so the flow is testable with no email provider connected — never
    // included outside development (see PAYMENTS.md-style "external dependency" documentation
    // pattern: the abstraction is real, only the transport is stubbed).
    return process.env.NODE_ENV === 'production'
      ? {}
      : { devResetUrl: resetUrl };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashResetToken(rawToken);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt) {
      throw new AppException(
        AuthErrorCode.RESET_TOKEN_INVALID,
        'This reset link is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (resetToken.expiresAt.getTime() < Date.now()) {
      throw new AppException(
        AuthErrorCode.RESET_TOKEN_EXPIRED,
        'This reset link has expired.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Force re-login everywhere — a password reset is exactly the moment an attacker's existing
    // sessions (if any) should stop working.
    await this.tokenService.revokeAllForUser(resetToken.userId);
  }

  private assertActive(status: UserStatus): void {
    if (status !== UserStatus.ACTIVE) {
      throw new AppException(
        AuthErrorCode.ACCOUNT_SUSPENDED,
        'This account is no longer active.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private toMeResponse(
    id: string,
    roles: Role[],
    phone: string | null,
    email: string | null,
  ): MeResponse {
    return { id, roles, phone, email };
  }
}
