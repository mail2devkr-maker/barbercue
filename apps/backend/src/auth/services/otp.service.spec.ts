import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { AuthErrorCode } from '@barbercue/shared';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_SENDER } from './otp-sender';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function makeOtpRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req1',
    phone: '+919876543210',
    codeHash: hashCode('123456'),
    attempts: 0,
    verifiedAt: null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    ...overrides,
  };
}

interface PrismaMock {
  otpRequest: {
    count: jest.Mock<Promise<number>, [unknown]>;
    create: jest.Mock<Promise<unknown>, [unknown]>;
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
}

describe('OtpService', () => {
  let service: OtpService;
  let prisma: PrismaMock;
  let otpSender: { sendOtp: jest.Mock<Promise<void>, [string, string]> };

  beforeEach(async () => {
    prisma = {
      otpRequest: {
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
        create: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue({ id: 'created' }),
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [unknown]>(),
      },
    };
    otpSender = {
      sendOtp: jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OTP_SENDER, useValue: otpSender },
      ],
    }).compile();
    service = moduleRef.get(OtpService);
  });

  // requestOtp is the single endpoint behind both the initial "Send OTP" and every "Resend OTP"
  // click — there is no separate resend code path, so these cases exercise resend directly.
  describe('requestOtp (also the resend code path — same method, no server-side distinction)', () => {
    it('creates a new OtpRequest row and dispatches the code via the configured OtpSender', async () => {
      const result = await service.requestOtp('+919876543210');

      expect(prisma.otpRequest.create).toHaveBeenCalledTimes(1);
      expect(otpSender.sendOtp).toHaveBeenCalledWith(
        '+919876543210',
        expect.stringMatching(/^\d{6}$/),
      );
      expect(result).toEqual({ expiresInSeconds: 300 });
    });

    it('allows a resend for the same phone number while still under the 10-minute window limit', async () => {
      prisma.otpRequest.count.mockResolvedValue(1); // one prior request already in the window
      await service.requestOtp('+919876543210');
      expect(prisma.otpRequest.create).toHaveBeenCalledTimes(1);
      expect(otpSender.sendOtp).toHaveBeenCalledTimes(1);
    });

    it('throws OTP_RATE_LIMITED and sends nothing once 3 requests already exist in the window', async () => {
      prisma.otpRequest.count.mockResolvedValue(3);

      await expect(service.requestOtp('+919876543210')).rejects.toMatchObject({
        code: AuthErrorCode.OTP_RATE_LIMITED,
      });
      expect(prisma.otpRequest.create).not.toHaveBeenCalled();
      expect(otpSender.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp after a resend', () => {
    it('validates against only the most recently created unverified OtpRequest for that phone', async () => {
      const newest = makeOtpRequestRow({ id: 'req2', codeHash: hashCode('654321') });
      prisma.otpRequest.findFirst.mockResolvedValue(newest);

      await service.verifyOtp('+919876543210', '654321');

      expect(prisma.otpRequest.findFirst).toHaveBeenCalledWith({
        where: { phone: '+919876543210', verifiedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: 'req2' },
        data: { verifiedAt: expect.any(Date) },
      });
    });

    it('rejects a pre-resend code once a newer OtpRequest is the latest pending one for that phone', async () => {
      // The query is always orderBy createdAt desc, so a resent code's row is what verifyOtp
      // checks against — an old code's hash won't match it, so the stale code is correctly dead.
      const newest = makeOtpRequestRow({ id: 'req2', codeHash: hashCode('654321') });
      prisma.otpRequest.findFirst.mockResolvedValue(newest);

      await expect(
        service.verifyOtp('+919876543210', '111111'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_INVALID });
      expect(prisma.otpRequest.update).toHaveBeenCalledWith({
        where: { id: 'req2' },
        data: { attempts: { increment: 1 } },
      });
    });
  });
});
