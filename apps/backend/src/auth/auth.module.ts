import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { OtpService } from './services/otp.service';
import { TotpService } from './services/totp.service';
import { CryptoService } from './services/crypto.service';
import { GoogleAuthService } from './services/google-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OTP_SENDER, ConsoleOtpSender } from './services/otp-sender';
import { TwoFactorOtpSender } from './services/two-factor-otp-sender';
import { EMAIL_SENDER, ConsoleEmailSender } from './services/email-sender';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      // Per-call expiresIn (TokenService) always wins; this is just a safe fallback.
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    OtpService,
    TotpService,
    CryptoService,
    GoogleAuthService,
    JwtStrategy,
    // Both concrete senders are always registered so Nest's DI container can construct either
    // one; the factory below is the single, obvious place that decides which one is actually
    // wired to OTP_SENDER. Same process.env.NODE_ENV === 'production' check already used
    // elsewhere in this module (auth.controller.ts's cookie `secure` flag), not a new
    // configuration mechanism.
    ConsoleOtpSender,
    TwoFactorOtpSender,
    {
      provide: OTP_SENDER,
      useFactory: (
        consoleSender: ConsoleOtpSender,
        twoFactorSender: TwoFactorOtpSender,
      ) =>
        process.env.NODE_ENV === 'production' ? twoFactorSender : consoleSender,
      inject: [ConsoleOtpSender, TwoFactorOtpSender],
    },
    { provide: EMAIL_SENDER, useClass: ConsoleEmailSender },
  ],
  // EMAIL_SENDER is exported (Phase 11) so SalonSetupModule can deliver barber invitations
  // through the same transport the forgot-password flow already uses, rather than binding a
  // second EmailSender of its own. No auth behavior changes — this is an export-list addition.
  exports: [TokenService, EMAIL_SENDER],
})
export class AuthModule {}
