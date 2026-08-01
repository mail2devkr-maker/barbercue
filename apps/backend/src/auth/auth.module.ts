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
import { JwtStrategy } from './strategies/jwt.strategy';
import { OTP_SENDER, ConsoleOtpSender } from './services/otp-sender';
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
    JwtStrategy,
    // DI-token seams (ARCHITECTURE.md §4): swap these two providers for real SMS/email vendor
    // adapters later without touching AuthService/OtpService/AuthController at all.
    { provide: OTP_SENDER, useClass: ConsoleOtpSender },
    { provide: EMAIL_SENDER, useClass: ConsoleEmailSender },
  ],
  exports: [TokenService],
})
export class AuthModule {}
