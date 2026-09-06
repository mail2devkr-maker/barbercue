import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  AuthErrorCode,
  AuthProvider,
  Role,
  SessionAudience,
  UserStatus,
  type AuthSession,
  type AuthTokens,
  type Language,
  type MeResponse,
  type PasswordAudience,
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
import {
  buildPasswordLink,
  passwordWebBaseUrl,
} from './services/password-link';

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
    // Security fix: customer OTP login is a CUSTOMER-audience session — this User row may also
    // hold PLATFORM_ADMIN/staff roles (same real person, different login surface), but this login
    // path must never assert them. scopeRolesToAudience is the single choke point that enforces
    // that, so the value used here and the value actually signed into the token can never diverge.
    const roles = this.tokenService.scopeRolesToAudience(
      user.roles.map((r) => r.role),
      SessionAudience.CUSTOMER,
    );
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      roles,
      SessionAudience.CUSTOMER,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(
        user.id,
        roles,
        SessionAudience.CUSTOMER,
        user.phone,
        user.email,
        user.preferredLanguage,
        user.passwordHash,
      ),
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
    // never removes or alters any role the user already has. `roles` here is deliberately the
    // FULL, unscoped set (needed to correctly decide whether a CUSTOMER row must be created) — it
    // is never what gets issued into the token; see sessionRoles below for that.
    let roles = user.roles.map((r) => r.role);
    if (!roles.includes(Role.CUSTOMER)) {
      await this.prisma.userRole.create({
        data: { userId: user.id, role: Role.CUSTOMER },
      });
      roles = [...roles, Role.CUSTOMER];
    }

    // Security fix: "sign in with Google as a customer" is a CUSTOMER-audience session — it must
    // never assert PLATFORM_ADMIN/staff roles even when this exact User row also holds them (the
    // whole point of the method doc above: this path only ever GUARANTEES customer access, never
    // grants anything more).
    const sessionRoles = this.tokenService.scopeRolesToAudience(
      roles,
      SessionAudience.CUSTOMER,
    );
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      sessionRoles,
      SessionAudience.CUSTOMER,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(
        user.id,
        sessionRoles,
        SessionAudience.CUSTOMER,
        user.phone,
        user.email,
        user.preferredLanguage,
        user.passwordHash,
      ),
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

    // Security fix: staff/owner password login is a STAFF-audience session — it must never assert
    // PLATFORM_ADMIN even if this same User row also holds it.
    const sessionRoles = this.tokenService.scopeRolesToAudience(
      roles,
      SessionAudience.STAFF,
    );
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      sessionRoles,
      SessionAudience.STAFF,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(
        user.id,
        sessionRoles,
        SessionAudience.STAFF,
        user.phone,
        user.email,
        user.preferredLanguage,
        user.passwordHash,
      ),
      tokens,
      // Always false in V1 — no staff/owner account can have 2FA enabled yet (only the admin
      // seed script provisions a TOTP secret, and only for PLATFORM_ADMIN). Reserved per API.md
      // so a future POST /auth/staff/2fa/verify step slots in without a response-shape change.
      twoFactorRequired: false,
    };
  }

  // ---------- Staff / Owner: Google Sign-In ----------

  /**
   * Google Sign-In restricted to accounts that already hold SALON_OWNER and/or SALON_STAFF.
   * Deliberately NOT the customer googleLogin's create-or-link-then-ensure-CUSTOMER flow — that
   * method exists specifically to be permissive (anyone can become a customer via Google), while
   * this one exists specifically to be restrictive:
   *
   *   1. An AuthIdentity already links this exact Google account (`sub`) — use its user.
   *   2. No link yet, but the (Google-verified, never client-asserted) email matches an existing
   *      User who ALREADY holds SALON_OWNER or SALON_STAFF — link this Google account to that
   *      user. The role check happens BEFORE linking, not after: an existing customer-only
   *      account with the same email is never linked or elevated by this method.
   *   3. Anything else (no identity, no matching user, or a matching user with neither role) —
   *      reject. Never creates a User. Never creates a UserRole. Never adds CUSTOMER.
   *
   * Roles are re-checked on the FINAL resolved user right before issuing tokens, not only at
   * link time — an account that loses its OWNER/STAFF role after a Google identity was already
   * linked must not keep signing in here, same as staffLogin re-checks on every call rather than
   * trusting a one-time check.
   */
  async staffGoogleLogin(
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

      if (!identity.email) return null;

      const existingUser = await tx.user.findUnique({
        where: { email: identity.email },
        include: { roles: true },
      });
      if (!existingUser) return null;

      const candidateRoles = existingUser.roles.map((r) => r.role);
      const candidateIsStaffOrOwner = candidateRoles.some(
        (r) => r === Role.SALON_STAFF || r === Role.SALON_OWNER,
      );
      // The role check gates the link itself — an existing customer-only user with this email
      // is left completely untouched (no identity created, no role granted).
      if (!candidateIsStaffOrOwner) return null;

      await tx.authIdentity.create({
        data: {
          userId: existingUser.id,
          provider: AuthProvider.GOOGLE,
          providerSub: identity.sub,
          email: identity.email,
        },
      });
      return existingUser;
    });

    const roles = user?.roles.map((r) => r.role) ?? [];
    const isStaffOrOwner = roles.some(
      (r) => r === Role.SALON_STAFF || r === Role.SALON_OWNER,
    );
    if (!user || !isStaffOrOwner) {
      throw new AppException(
        AuthErrorCode.GOOGLE_ACCOUNT_NOT_STAFF,
        'This Google account is not registered as a shop owner or staff member.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user.status);

    // Security fix: staff/owner Google login is a STAFF-audience session — never PLATFORM_ADMIN,
    // even if this same User row also holds it.
    const sessionRoles = this.tokenService.scopeRolesToAudience(
      roles,
      SessionAudience.STAFF,
    );
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      sessionRoles,
      SessionAudience.STAFF,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(
        user.id,
        sessionRoles,
        SessionAudience.STAFF,
        user.phone,
        user.email,
        user.preferredLanguage,
        user.passwordHash,
      ),
      tokens,
    };
  }

  // ---------- Platform admin: Google + mandatory TOTP ----------

  async adminGoogleLogin(
    idToken: string,
    totpCode: string | undefined,
    deviceInfo?: string,
  ): Promise<{ user: MeResponse; tokens: AuthTokens }> {
    const identity = await this.googleAuthService.verifyIdToken(idToken);
    const user = await this.prisma.$transaction(async (tx) => {
      const linked = await tx.authIdentity.findUnique({
        where: {
          provider_providerSub: {
            provider: AuthProvider.GOOGLE,
            providerSub: identity.sub,
          },
        },
        include: { user: { include: { roles: true } } },
      });
      if (linked) return linked.user;
      if (!identity.email) return null;

      const candidate = await tx.user.findUnique({
        where: { email: identity.email },
        include: { roles: true },
      });
      // Global-admin-scope fix: PLATFORM_ADMIN is only ever a global role (salonId: null — see
      // UserRole's own doc comment); a salon-scoped PLATFORM_ADMIN row (which should never exist —
      // enforced by a DB CHECK constraint as of this fix — but must never be trusted regardless)
      // must not grant admin-login eligibility here.
      if (
        !candidate ||
        !candidate.roles.some(
          (role) => role.role === Role.PLATFORM_ADMIN && role.salonId === null,
        )
      ) {
        return null;
      }
      await tx.authIdentity.create({
        data: {
          userId: candidate.id,
          provider: AuthProvider.GOOGLE,
          providerSub: identity.sub,
          email: identity.email,
        },
      });
      return candidate;
    });

    const isGlobalAdmin =
      !!user &&
      user.roles.some(
        (role) => role.role === Role.PLATFORM_ADMIN && role.salonId === null,
      );
    if (!user || !isGlobalAdmin) {
      throw new AppException(
        AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN,
        'This Google account is not registered as a platform administrator.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user.status);
    await this.assertAdminTotp(user, totpCode);

    // Security fix: admin Google login is an ADMIN-audience session — the only login surface
    // allowed to ever assert PLATFORM_ADMIN, and only after the TOTP check just above succeeded.
    const sessionRoles = this.tokenService.scopeRolesToAudience(
      user.roles.map((role) => role.role),
      SessionAudience.ADMIN,
    );
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      sessionRoles,
      SessionAudience.ADMIN,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(
        user.id,
        sessionRoles,
        SessionAudience.ADMIN,
        user.phone,
        user.email,
        user.preferredLanguage,
        user.passwordHash,
      ),
      tokens,
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
    // Global-admin-scope fix: PLATFORM_ADMIN is only ever a global role (salonId: null) — a
    // salon-scoped PLATFORM_ADMIN row must never grant admin-login eligibility.
    const isAdmin =
      !!user &&
      user.roles.some(
        (r) => r.role === Role.PLATFORM_ADMIN && r.salonId === null,
      );

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

    await this.assertAdminTotp(user, totpCode);

    // Security fix: admin password login is an ADMIN-audience session — the only login surface
    // allowed to ever assert PLATFORM_ADMIN, and only after the TOTP check just above succeeded.
    const sessionRoles = this.tokenService.scopeRolesToAudience(
      user.roles.map((r) => r.role),
      SessionAudience.ADMIN,
    );
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      sessionRoles,
      SessionAudience.ADMIN,
      deviceInfo,
    );
    return {
      user: this.toMeResponse(
        user.id,
        sessionRoles,
        SessionAudience.ADMIN,
        user.phone,
        user.email,
        user.preferredLanguage,
        user.passwordHash,
      ),
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

  async me(
    userId: string,
    tokenRoles: Role[],
    tokenAudience: SessionAudience,
  ): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException(
        AuthErrorCode.UNAUTHENTICATED,
        'User not found.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.toMeResponse(
      user.id,
      tokenRoles,
      tokenAudience,
      user.phone,
      user.email,
      user.preferredLanguage,
      user.passwordHash,
    );
  }

  /** PATCH auth/language (Phase 14) — the caller's own tokenRoles/audience are reused as-is;
   * changing language never affects role or audience membership. */
  async setLanguage(
    userId: string,
    tokenRoles: Role[],
    tokenAudience: SessionAudience,
    language: Language,
  ): Promise<MeResponse> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredLanguage: language },
    });
    return this.toMeResponse(
      user.id,
      tokenRoles,
      tokenAudience,
      user.phone,
      user.email,
      user.preferredLanguage,
      user.passwordHash,
    );
  }

  async setInitialPassword(
    userId: string,
    tokenAudience: SessionAudience,
    password: string,
  ): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) {
      throw new AppException(
        AuthErrorCode.UNAUTHENTICATED,
        'User not found.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user.status);
    if (!user.email || !user.emailVerifiedAt) {
      throw new AppException(
        AuthErrorCode.INVALID_CREDENTIALS,
        'A verified email address is required before creating a password.',
        HttpStatus.CONFLICT,
      );
    }
    if (user.passwordHash) {
      throw new AppException(
        AuthErrorCode.PASSWORD_ALREADY_CONFIGURED,
        'A password is already configured. Use password recovery to change it.',
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await this.passwordService.hash(password);
    const updated = await this.prisma.user.updateMany({
      where: { id: user.id, passwordHash: null },
      data: { passwordHash },
    });
    if (updated.count !== 1) {
      throw new AppException(
        AuthErrorCode.PASSWORD_ALREADY_CONFIGURED,
        'A password is already configured. Use password recovery to change it.',
        HttpStatus.CONFLICT,
      );
    }
    // Scoped to the caller's own session audience — this response must never show a role the
    // caller's actual JWT doesn't carry, even if the underlying User row holds more.
    const roles = this.tokenService.scopeRolesToAudience(
      user.roles.map((role) => role.role),
      tokenAudience,
    );
    return this.toMeResponse(
      user.id,
      roles,
      tokenAudience,
      user.phone,
      user.email,
      user.preferredLanguage,
      passwordHash,
    );
  }

  // ---------- Forgot / reset password (staff/owner/admin only — customers have no password) ----------

  async forgotPassword(
    email: string,
    audience?: PasswordAudience,
  ): Promise<{ devResetUrl?: string }> {
    // Availability is checked before account lookup so configuration failures cannot become an
    // account-enumeration oracle. Production never claims a message was sent via console.
    this.emailSender.assertAvailable();
    const webBaseUrl = passwordWebBaseUrl();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
    // Always behave identically whether or not the email exists, so responses can't be used to
    // enumerate registered accounts.
    const eligible = user?.roles.some(
      ({ role }) =>
        role === Role.SALON_OWNER ||
        role === Role.SALON_STAFF ||
        role === Role.PLATFORM_ADMIN,
    );
    if (!user || !eligible) {
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

    const resetUrl = buildPasswordLink(webBaseUrl, rawToken, audience);
    await this.emailSender.sendPasswordReset(
      email,
      resetUrl,
      PASSWORD_RESET_TTL_MINUTES,
    );

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
    if (resetToken.expiresAt.getTime() <= Date.now()) {
      throw new AppException(
        AuthErrorCode.RESET_TOKEN_EXPIRED,
        'This reset link has expired.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new AppException(
          AuthErrorCode.RESET_TOKEN_INVALID,
          'This reset link is invalid.',
          HttpStatus.BAD_REQUEST,
        );
      }
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  private async assertAdminTotp(
    user: { twoFactorEnabled: boolean; totpSecret: string | null },
    totpCode: string | undefined,
  ): Promise<void> {
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
    const valid = await this.totpService.verifyToken(secret, totpCode);
    if (!valid) {
      throw new AppException(
        AuthErrorCode.TOTP_INVALID,
        'Incorrect authenticator code.',
        HttpStatus.UNAUTHORIZED,
      );
    }
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
    audience: SessionAudience,
    phone: string | null,
    email: string | null,
    preferredLanguage: Language,
    passwordHash: string | null | undefined,
  ): MeResponse {
    return {
      id,
      roles,
      audience,
      phone,
      email,
      preferredLanguage,
      passwordConfigured: Boolean(passwordHash),
    };
  }
}
