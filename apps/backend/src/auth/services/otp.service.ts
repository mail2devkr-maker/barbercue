import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type OtpPurpose } from '@prisma/client';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'crypto';
import {
  AuthErrorCode,
  OtpPurpose as SharedOtpPurpose,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { OTP_SENDER, type OtpSender } from './otp-sender';
import { isOtpPhoneAllowed, otpHashSecret } from './otp-config';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MINUTES = 10;
const MAX_REQUESTS_PER_DAY = 10;
const HMAC_HASH_VERSION = 'HMAC_SHA256_V1';
const LEGACY_HASH_VERSION = 'LEGACY_SHA256';

function legacyHash(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

function hmacHash(code: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(code).digest();
}

function matchesHash(
  code: string,
  storedHash: string,
  version: string,
): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== 32) return false;

  const actual =
    version === LEGACY_HASH_VERSION
      ? legacyHash(code)
      : version === HMAC_HASH_VERSION && otpHashSecret()
        ? hmacHash(code, otpHashSecret()!)
        : null;
  return Boolean(actual && timingSafeEqual(actual, expected));
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
  ) {}

  async requestOtp(
    phone: string,
    purpose: OtpPurpose = SharedOtpPurpose.LOGIN,
    subjectUserId?: string,
  ): Promise<{ expiresInSeconds: number }> {
    const secret = otpHashSecret();
    if (!secret) throw this.deliveryUnavailable();
    if (!isOtpPhoneAllowed(phone)) {
      throw new AppException(
        AuthErrorCode.OTP_DELIVERY_FAILED,
        'Phone verification is not available for this country.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const now = new Date();
    const windowStart = new Date(
      now.getTime() - REQUEST_WINDOW_MINUTES * 60_000,
    );
    const dayStart = new Date(now.getTime() - 24 * 60 * 60_000);
    const code = randomInt(0, 1_000_000).toString().padStart(OTP_LENGTH, '0');
    const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);

    let row: { id: string };
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          const [recentCount, dayCount] = await Promise.all([
            tx.otpRequest.count({
              where: { phone, createdAt: { gte: windowStart } },
            }),
            tx.otpRequest.count({
              where: { phone, createdAt: { gte: dayStart } },
            }),
          ]);
          if (
            recentCount >= MAX_REQUESTS_PER_WINDOW ||
            dayCount >= MAX_REQUESTS_PER_DAY
          ) {
            throw this.rateLimited();
          }
          // A resend supersedes every still-pending challenge in this authentication scope. Mark
          // them consumed in the same serializable transaction as the new insert, so consuming
          // the newest code can never make an older code valid again.
          await tx.otpRequest.updateMany({
            where: {
              phone,
              purpose,
              subjectUserId: subjectUserId ?? null,
              verifiedAt: null,
            },
            data: { verifiedAt: now },
          });
          return tx.otpRequest.create({
            data: {
              phone,
              codeHash: hmacHash(code, secret).toString('hex'),
              hashVersion: HMAC_HASH_VERSION,
              purpose,
              subjectUserId: subjectUserId ?? null,
              expiresAt,
            },
            select: { id: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Concurrent count/create transactions can conflict under SERIALIZABLE isolation. Fail
      // closed as a rate-limit response rather than retrying and sending duplicate SMS messages.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw this.rateLimited();
      }
      throw error;
    }

    try {
      await this.otpSender.sendOtp(phone, code);
    } catch {
      // A provider failure must not leave a valid challenge whose code was never accepted by the
      // transport. The row remains as a rate-limit/audit fact but is no longer verifiable.
      await this.prisma.otpRequest.updateMany({
        where: { id: row.id, verifiedAt: null },
        data: { verifiedAt: new Date() },
      });
      throw this.deliveryUnavailable();
    }

    return { expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  /**
   * Consume one matching challenge. The conditional update is the one-time-use boundary: two
   * concurrent verifiers may both read the row, but only one can transition verifiedAt from NULL.
   */
  async verifyOtp(
    phone: string,
    code: string,
    purpose: OtpPurpose = SharedOtpPurpose.LOGIN,
    subjectUserId?: string,
  ): Promise<void> {
    const request = await this.prisma.otpRequest.findFirst({
      where: {
        phone,
        purpose,
        subjectUserId: subjectUserId ?? null,
        verifiedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!request) throw this.invalidOtp('No pending OTP for this number.');

    const now = new Date();
    if (request.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.otpRequest.updateMany({
        where: { id: request.id, verifiedAt: null, expiresAt: { lte: now } },
        data: { verifiedAt: now },
      });
      throw new AppException(
        AuthErrorCode.OTP_EXPIRED,
        'This OTP has expired. Please request a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (request.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new AppException(
        AuthErrorCode.OTP_MAX_ATTEMPTS,
        'Too many incorrect attempts. Please request a new OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!matchesHash(code, request.codeHash, request.hashVersion)) {
      const failedAttempt = await this.prisma.otpRequest.updateMany({
        where: {
          id: request.id,
          verifiedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: MAX_VERIFY_ATTEMPTS },
        },
        data: { attempts: { increment: 1 } },
      });
      if (failedAttempt.count === 0) await this.throwCurrentState(request.id);
      throw this.invalidOtp('Incorrect OTP.');
    }

    const consumed = await this.prisma.otpRequest.updateMany({
      where: {
        id: request.id,
        verifiedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_VERIFY_ATTEMPTS },
      },
      data: { verifiedAt: now },
    });
    if (consumed.count !== 1) await this.throwCurrentState(request.id);
  }

  private async throwCurrentState(id: string): Promise<never> {
    const current = await this.prisma.otpRequest.findUnique({ where: { id } });
    if (current?.expiresAt && current.expiresAt.getTime() <= Date.now()) {
      throw new AppException(
        AuthErrorCode.OTP_EXPIRED,
        'This OTP has expired. Please request a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (current && current.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new AppException(
        AuthErrorCode.OTP_MAX_ATTEMPTS,
        'Too many incorrect attempts. Please request a new OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw this.invalidOtp('This OTP is no longer valid. Request a new one.');
  }

  private invalidOtp(message: string): AppException {
    return new AppException(
      AuthErrorCode.OTP_INVALID,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  private rateLimited(): AppException {
    return new AppException(
      AuthErrorCode.OTP_RATE_LIMITED,
      'Too many OTP requests for this number. Please wait before trying again.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private deliveryUnavailable(): AppException {
    return new AppException(
      AuthErrorCode.OTP_DELIVERY_FAILED,
      'Could not send the verification code. Please try again in a moment.',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
