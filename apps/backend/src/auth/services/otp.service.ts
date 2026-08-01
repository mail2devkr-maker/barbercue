import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { AuthErrorCode, OtpPurpose } from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { OTP_SENDER, type OtpSender } from './otp-sender';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;
// Per-phone request throttle, independent of the IP-based ThrottlerGuard on the controller route
// — this one can't be bypassed by rotating IPs against a fixed target phone number.
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MINUTES = 10;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
  ) {}

  async requestOtp(phone: string): Promise<{ expiresInSeconds: number }> {
    const windowStart = new Date(Date.now() - REQUEST_WINDOW_MINUTES * 60_000);
    const recentCount = await this.prisma.otpRequest.count({
      where: { phone, createdAt: { gte: windowStart } },
    });
    if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
      throw new AppException(
        AuthErrorCode.OTP_RATE_LIMITED,
        'Too many OTP requests for this number. Please wait before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(OTP_LENGTH, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

    await this.prisma.otpRequest.create({
      data: {
        phone,
        codeHash: hashCode(code),
        purpose: OtpPurpose.LOGIN,
        expiresAt,
      },
    });

    await this.otpSender.sendOtp(phone, code);

    return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  /** Throws on any invalid/expired/exhausted case; resolves (no return value) only on success. */
  async verifyOtp(phone: string, code: string): Promise<void> {
    const otpRequest = await this.prisma.otpRequest.findFirst({
      where: { phone, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRequest) {
      throw new AppException(
        AuthErrorCode.OTP_INVALID,
        'No pending OTP for this number.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (otpRequest.expiresAt.getTime() < Date.now()) {
      throw new AppException(
        AuthErrorCode.OTP_EXPIRED,
        'This OTP has expired. Please request a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (otpRequest.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new AppException(
        AuthErrorCode.OTP_MAX_ATTEMPTS,
        'Too many incorrect attempts. Please request a new OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (otpRequest.codeHash !== hashCode(code)) {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException(
        AuthErrorCode.OTP_INVALID,
        'Incorrect OTP.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.otpRequest.update({
      where: { id: otpRequest.id },
      data: { verifiedAt: new Date() },
    });
  }
}
