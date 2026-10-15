import { createHash, createHmac } from 'crypto';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuthErrorCode, OtpPurpose } from '@barbercue/shared';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_SENDER } from './otp-sender';

const TEST_HASH_SECRET = 'synthetic-otp-hash-secret-for-unit-tests-only';
const PHONE = '+919876543210';
const CODE = '123456';

function hmacHash(code: string): string {
  return createHmac('sha256', TEST_HASH_SECRET).update(code).digest('hex');
}

function legacyHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function makeOtpRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    phone: PHONE,
    codeHash: hmacHash(CODE),
    hashVersion: 'HMAC_SHA256_V1',
    purpose: OtpPurpose.LOGIN,
    subjectUserId: null,
    attempts: 0,
    verifiedAt: null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    ...overrides,
  };
}

describe('OtpService', () => {
  let service: OtpService;
  let prisma: {
    otpRequest: {
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let otpSender: { sendOtp: jest.Mock };
  const originalHashSecret = process.env.OTP_HASH_SECRET;
  const originalAllowedCodes = process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES;

  beforeEach(async () => {
    process.env.OTP_HASH_SECRET = TEST_HASH_SECRET;
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    prisma = {
      otpRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'created-request' }),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) =>
        work(prisma),
      ),
    };
    otpSender = { sendOtp: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OTP_SENDER, useValue: otpSender },
      ],
    }).compile();
    service = moduleRef.get(OtpService);
  });

  afterEach(() => {
    if (originalHashSecret === undefined) delete process.env.OTP_HASH_SECRET;
    else process.env.OTP_HASH_SECRET = originalHashSecret;
    if (originalAllowedCodes === undefined)
      delete process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES;
    else process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = originalAllowedCodes;
  });

  describe('requestOtp', () => {
    it('stores a keyed digest and dispatches one six-digit code', async () => {
      await expect(service.requestOtp(PHONE)).resolves.toEqual({
        expiresInSeconds: 300,
      });

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(otpSender.sendOtp).toHaveBeenCalledWith(
        PHONE,
        expect.stringMatching(/^\d{6}$/),
      );
      const sentCode = otpSender.sendOtp.mock.calls[0][1] as string;
      const created = prisma.otpRequest.create.mock.calls[0][0] as {
        data: {
          codeHash: string;
          hashVersion: string;
          purpose: string;
          subjectUserId: null;
          phone: string;
        };
      };
      expect(created.data).toMatchObject({
        phone: PHONE,
        purpose: OtpPurpose.LOGIN,
        subjectUserId: null,
        hashVersion: 'HMAC_SHA256_V1',
      });
      expect(created.data.codeHash).toBe(hmacHash(sentCode));
      expect(created.data.codeHash).not.toBe(legacyHash(sentCode));
    });

    it('supersedes all pending challenges in the same purpose and owner scope before creating a resend', async () => {
      await service.requestOtp(PHONE, OtpPurpose.PHONE_LINK, 'owner-1');

      expect(prisma.otpRequest.updateMany).toHaveBeenCalledWith({
        where: {
          phone: PHONE,
          purpose: OtpPurpose.PHONE_LINK,
          subjectUserId: 'owner-1',
          verifiedAt: null,
        },
        data: { verifiedAt: expect.any(Date) },
      });
      expect(prisma.otpRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            purpose: OtpPurpose.PHONE_LINK,
            subjectUserId: 'owner-1',
          }),
        }),
      );
    });

    it('enforces the per-phone resend window and daily cap before sending', async () => {
      prisma.otpRequest.count.mockResolvedValueOnce(3).mockResolvedValueOnce(3);

      await expect(service.requestOtp(PHONE)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_RATE_LIMITED,
      });
      expect(prisma.otpRequest.create).not.toHaveBeenCalled();
      expect(otpSender.sendOtp).not.toHaveBeenCalled();
    });

    it('fails closed if the HMAC secret is missing or weak', async () => {
      process.env.OTP_HASH_SECRET = 'short';

      await expect(service.requestOtp(PHONE)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_DELIVERY_FAILED,
      });
      expect(prisma.otpRequest.create).not.toHaveBeenCalled();
      expect(otpSender.sendOtp).not.toHaveBeenCalled();
    });

    it('rejects country calling codes outside the configured allowlist', async () => {
      await expect(service.requestOtp('+14155552671')).rejects.toMatchObject({
        code: AuthErrorCode.OTP_DELIVERY_FAILED,
      });
      expect(otpSender.sendOtp).not.toHaveBeenCalled();
    });

    it('consumes the challenge when the provider fails so an undelivered code cannot be used', async () => {
      otpSender.sendOtp.mockRejectedValue(
        new Error('synthetic transport failure'),
      );

      await expect(service.requestOtp(PHONE)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_DELIVERY_FAILED,
      });
      expect(prisma.otpRequest.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'created-request', verifiedAt: null },
        data: { verifiedAt: expect.any(Date) },
      });
    });
  });

  describe('verifyOtp', () => {
    it('validates HMAC challenges against the requested purpose and account scope, then consumes atomically', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(
        makeOtpRequestRow({
          purpose: OtpPurpose.OWNER_LOGIN,
          subjectUserId: 'owner-1',
        }),
      );

      await service.verifyOtp(PHONE, CODE, OtpPurpose.OWNER_LOGIN, 'owner-1');

      expect(prisma.otpRequest.findFirst).toHaveBeenCalledWith({
        where: {
          phone: PHONE,
          purpose: OtpPurpose.OWNER_LOGIN,
          subjectUserId: 'owner-1',
          verifiedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.otpRequest.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: 'request-1',
          verifiedAt: null,
          expiresAt: { gt: expect.any(Date) },
          attempts: { lt: 5 },
        },
        data: { verifiedAt: expect.any(Date) },
      });
    });

    it('temporarily accepts an unexpired legacy hash for a challenge created before deployment', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(
        makeOtpRequestRow({
          codeHash: legacyHash(CODE),
          hashVersion: 'LEGACY_SHA256',
        }),
      );

      await expect(service.verifyOtp(PHONE, CODE)).resolves.toBeUndefined();
    });

    it('increments failed attempts conditionally and returns a generic invalid-code error', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(makeOtpRequestRow());

      await expect(service.verifyOtp(PHONE, '000000')).rejects.toMatchObject({
        code: AuthErrorCode.OTP_INVALID,
      });
      expect(prisma.otpRequest.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'request-1',
          verifiedAt: null,
          expiresAt: { gt: expect.any(Date) },
          attempts: { lt: 5 },
        },
        data: { attempts: { increment: 1 } },
      });
    });

    it('marks an expired request unusable', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(
        makeOtpRequestRow({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.verifyOtp(PHONE, CODE)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_EXPIRED,
      });
      expect(prisma.otpRequest.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'request-1',
          verifiedAt: null,
          expiresAt: { lte: expect.any(Date) },
        },
        data: { verifiedAt: expect.any(Date) },
      });
    });

    it('rejects exhausted challenges without accepting a matching code', async () => {
      prisma.otpRequest.findFirst.mockResolvedValue(
        makeOtpRequestRow({ attempts: 5 }),
      );

      await expect(service.verifyOtp(PHONE, CODE)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_MAX_ATTEMPTS,
      });
      expect(prisma.otpRequest.updateMany).not.toHaveBeenCalled();
    });

    it('allows only one of two concurrent verifications to consume the same request', async () => {
      const row = makeOtpRequestRow();
      prisma.otpRequest.findFirst.mockResolvedValue(row);
      prisma.otpRequest.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.otpRequest.findUnique.mockResolvedValue({
        ...row,
        verifiedAt: new Date(),
      });

      const results = await Promise.allSettled([
        service.verifyOtp(PHONE, CODE),
        service.verifyOtp(PHONE, CODE),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    });
  });
});
