import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthErrorCode } from '@barbercue/shared';
import { TwoFactorOtpSender } from './two-factor-otp-sender';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('TwoFactorOtpSender', () => {
  let service: TwoFactorOtpSender;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let loggerErrorSpy: jest.SpyInstance;
  const originalApiKey = process.env.OTP_PROVIDER_API_KEY;

  beforeEach(async () => {
    process.env.OTP_PROVIDER_API_KEY = 'test-secret-key-do-not-log-me';
    fetchSpy = jest.spyOn(global, 'fetch');
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [TwoFactorOtpSender],
    }).compile();
    service = moduleRef.get(TwoFactorOtpSender);
  });

  afterEach(() => {
    process.env.OTP_PROVIDER_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  describe('success', () => {
    it('sends the exact phone + OTP that OtpService already generated, via a GET request', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, { Status: 'Success', Details: 'SMS SENT' }),
      );

      await service.sendOtp('+919876543210', '123456');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe(
        'https://2factor.in/API/V1/test-secret-key-do-not-log-me/SMS/919876543210/123456',
      );
      expect(options).toMatchObject({ method: 'GET' });
    });

    it('does not throw and does not generate a second OTP — it only transports the one it was given', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { Status: 'Success' }));
      await expect(
        service.sendOtp('+919876543210', '654321'),
      ).resolves.toBeUndefined();
      // Called exactly once — no separate 2Factor AUTOGEN/VERIFY round trip.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('strips the leading "+" for the provider request without touching the caller-provided value', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { Status: 'Success' }));
      await service.sendOtp('+911234567890', '000000');
      const [url] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('/SMS/911234567890/');
      expect(String(url)).not.toContain('+');
    });
  });

  describe('provider failure', () => {
    it('throws OTP_DELIVERY_FAILED (502) when the provider returns a non-2xx HTTP status', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(401, { Status: 'Error', Details: 'Invalid API Key' }),
      );
      await expect(
        service.sendOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_DELIVERY_FAILED, status: 502 });
    });

    it('throws OTP_DELIVERY_FAILED when the provider responds 200 but Status is not "Success"', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, { Status: 'Error', Details: 'Insufficient balance' }),
      );
      await expect(
        service.sendOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_DELIVERY_FAILED });
    });

    it('throws OTP_DELIVERY_FAILED on a malformed (non-JSON) provider response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Unexpected token < in JSON')),
      } as Response);
      await expect(
        service.sendOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_DELIVERY_FAILED });
    });

    it('throws OTP_DELIVERY_FAILED on a network-level failure (fetch itself rejects)', async () => {
      fetchSpy.mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(
        service.sendOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_DELIVERY_FAILED });
    });

    it('throws OTP_DELIVERY_FAILED without calling fetch at all when OTP_PROVIDER_API_KEY is unset', async () => {
      delete process.env.OTP_PROVIDER_API_KEY;
      await expect(
        service.sendOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_DELIVERY_FAILED });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('security: the API key and full OTP are never logged', () => {
    it('never logs the API key value, even when delivery fails', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(401, { Status: 'Error', Details: 'Invalid API Key' }),
      );
      await expect(service.sendOtp('+919876543210', '123456')).rejects.toBeDefined();

      const loggedText = loggerErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toContain('test-secret-key-do-not-log-me');
    });

    it('never logs the API key value when it is missing entirely', async () => {
      delete process.env.OTP_PROVIDER_API_KEY;
      await expect(service.sendOtp('+919876543210', '123456')).rejects.toBeDefined();
      const loggedText = loggerErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toMatch(/test-secret-key/);
    });

    it('propagates only a generic, user-safe message — never the raw provider Details/stack', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(500, { Status: 'Error', Details: 'internal provider stack trace xyz' }),
      );
      await expect(service.sendOtp('+919876543210', '123456')).rejects.toMatchObject({
        message: 'Could not send the verification code. Please try again in a moment.',
      });
    });
  });
});
