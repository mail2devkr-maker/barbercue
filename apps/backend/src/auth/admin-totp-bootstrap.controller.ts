import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthErrorCode, AuthProvider, Role, UserStatus } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from './decorators/public.decorator';
import { CryptoService } from './services/crypto.service';
import { GoogleAuthService } from './services/google-auth.service';
import { TotpService } from './services/totp.service';

const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const setupSchema = z.object({ idToken: z.string().min(1) });
const confirmSchema = z.object({
  idToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
});

type SetupInput = z.infer<typeof setupSchema>;
type ConfirmInput = z.infer<typeof confirmSchema>;

@Controller('auth/admin/totp')
export class AdminTotpBootstrapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly totpService: TotpService,
    private readonly cryptoService: CryptoService,
  ) {}

  private async resolveVerifiedAdmin(idToken: string) {
    const identity = await this.googleAuthService.verifyIdToken(idToken);

    const linked = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSub: {
          provider: AuthProvider.GOOGLE,
          providerSub: identity.sub,
        },
      },
      include: { user: { include: { roles: true } } },
    });

    const user =
      linked?.user ??
      (identity.email
        ? await this.prisma.user.findUnique({
            where: { email: identity.email },
            include: { roles: true },
          })
        : null);

    if (!user || !user.roles.some(({ role }) => role === Role.PLATFORM_ADMIN)) {
      throw new AppException(
        AuthErrorCode.GOOGLE_ACCOUNT_NOT_ADMIN,
        'This Google account is not registered as a platform administrator.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        AuthErrorCode.ACCOUNT_SUSPENDED,
        'This account is no longer active.',
        HttpStatus.FORBIDDEN,
      );
    }

    return user;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('setup')
  async setup(@Body(new ZodValidationPipe(setupSchema)) body: SetupInput) {
    let user = await this.resolveVerifiedAdmin(body.idToken);

    if (user.twoFactorEnabled) {
      throw new AppException(
        AuthErrorCode.TOTP_REQUIRED,
        'Two-factor authentication is already configured for this account.',
        HttpStatus.CONFLICT,
      );
    }

    let secret: string;
    if (user.totpSecret) {
      secret = this.cryptoService.decrypt(user.totpSecret);
    } else {
      const generated = this.totpService.generateSecret();
      const encrypted = this.cryptoService.encrypt(generated);
      const claimed = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          twoFactorEnabled: false,
          totpSecret: null,
        },
        data: { totpSecret: encrypted },
      });

      if (claimed.count === 1) {
        secret = generated;
      } else {
        const refreshed = await this.prisma.user.findUnique({
          where: { id: user.id },
          include: { roles: true },
        });
        if (!refreshed) {
          throw new AppException(
            AuthErrorCode.UNAUTHENTICATED,
            'User not found.',
            HttpStatus.UNAUTHORIZED,
          );
        }
        user = refreshed;
        if (user.twoFactorEnabled) {
          throw new AppException(
            AuthErrorCode.TOTP_REQUIRED,
            'Two-factor authentication is already configured for this account.',
            HttpStatus.CONFLICT,
          );
        }
        if (!user.totpSecret) {
          throw new AppException(
            AuthErrorCode.TOTP_SETUP_REQUIRED,
            'Unable to start authenticator setup. Please try again.',
            HttpStatus.CONFLICT,
          );
        }
        secret = this.cryptoService.decrypt(user.totpSecret);
      }
    }

    return {
      otpAuthUri: this.totpService.buildOtpAuthUri(
        user.email ?? 'platform-admin',
        secret,
      ),
      manualKey: secret,
    };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('confirm')
  async confirm(@Body(new ZodValidationPipe(confirmSchema)) body: ConfirmInput) {
    const user = await this.resolveVerifiedAdmin(body.idToken);

    if (user.twoFactorEnabled) {
      return { success: true };
    }

    if (!user.totpSecret) {
      throw new AppException(
        AuthErrorCode.TOTP_SETUP_REQUIRED,
        'Start authenticator setup before confirming a code.',
        HttpStatus.CONFLICT,
      );
    }

    const secret = this.cryptoService.decrypt(user.totpSecret);
    const valid = await this.totpService.verifyToken(secret, body.code);
    if (!valid) {
      throw new AppException(
        AuthErrorCode.TOTP_INVALID,
        'Incorrect authenticator code.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.prisma.user.updateMany({
      where: {
        id: user.id,
        twoFactorEnabled: false,
        totpSecret: user.totpSecret,
      },
      data: { twoFactorEnabled: true },
    });

    return { success: true };
  }
}
