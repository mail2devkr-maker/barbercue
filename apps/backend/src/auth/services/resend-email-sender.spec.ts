import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthErrorCode } from '@barbercue/shared';
import { ResendEmailSender } from './resend-email-sender';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('ResendEmailSender', () => {
  let service: ResendEmailSender;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let loggerErrorSpy: jest.SpyInstance;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM_ADDRESS;

  beforeEach(async () => {
    process.env.RESEND_API_KEY = 'test-secret-key-do-not-log-me';
    process.env.EMAIL_FROM_ADDRESS = 'BarberCue <no-reply@barbercue.app>';
    fetchSpy = jest.spyOn(global, 'fetch');
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [ResendEmailSender],
    }).compile();
    service = moduleRef.get(ResendEmailSender);
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.EMAIL_FROM_ADDRESS = originalFrom;
    jest.restoreAllMocks();
  });

  describe('assertAvailable', () => {
    it('does not throw when both RESEND_API_KEY and EMAIL_FROM_ADDRESS are set', () => {
      expect(() => service.assertAvailable()).not.toThrow();
    });

    it('throws EMAIL_DELIVERY_UNAVAILABLE (503) when RESEND_API_KEY is missing', () => {
      delete process.env.RESEND_API_KEY;
      expect(() => service.assertAvailable()).toThrow(
        expect.objectContaining({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE, status: 503 }),
      );
    });

    it('throws EMAIL_DELIVERY_UNAVAILABLE when EMAIL_FROM_ADDRESS is missing', () => {
      delete process.env.EMAIL_FROM_ADDRESS;
      expect(() => service.assertAvailable()).toThrow(
        expect.objectContaining({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE }),
      );
    });
  });

  describe('sendPasswordReset', () => {
    it('POSTs to Resend with the reset URL, expiry, and configured from-address', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { id: 'email-1' }));
      await service.sendPasswordReset('owner@example.com', 'https://fastque.com/reset-password?token=abc', 15);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe('https://api.resend.com/emails');
      expect(options?.method).toBe('POST');
      expect((options?.headers as Record<string, string>).Authorization).toBe(
        'Bearer test-secret-key-do-not-log-me',
      );
      const body = JSON.parse(options?.body as string);
      expect(body.from).toBe('BarberCue <no-reply@barbercue.app>');
      expect(body.to).toBe('owner@example.com');
      expect(body.html).toContain('https://fastque.com/reset-password?token=abc');
      expect(body.html).toContain('15 minutes');
    });
  });

  describe('sendStaffInvitation', () => {
    it('POSTs to Resend with the setup URL and day-based expiry', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { id: 'email-2' }));
      await service.sendStaffInvitation('staff@example.com', 'https://fastque.com/staff/setup?token=xyz', 7);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.to).toBe('staff@example.com');
      expect(body.html).toContain('https://fastque.com/staff/setup?token=xyz');
      expect(body.html).toContain('7 days');
    });
  });

  describe('provider failure', () => {
    it('throws EMAIL_DELIVERY_UNAVAILABLE when Resend returns a non-2xx status', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(422, { message: 'domain not verified' }));
      await expect(
        service.sendPasswordReset('owner@example.com', 'https://fastque.com/reset', 15),
      ).rejects.toMatchObject({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE, status: 503 });
    });

    it('throws EMAIL_DELIVERY_UNAVAILABLE on a network-level failure', async () => {
      fetchSpy.mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(
        service.sendPasswordReset('owner@example.com', 'https://fastque.com/reset', 15),
      ).rejects.toMatchObject({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE });
    });

    it('throws without calling fetch at all when not configured', async () => {
      delete process.env.RESEND_API_KEY;
      await expect(
        service.sendPasswordReset('owner@example.com', 'https://fastque.com/reset', 15),
      ).rejects.toMatchObject({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('security: the API key, recipient, and reset URL are never logged', () => {
    it('never logs the API key on failure', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(401, { message: 'invalid key' }));
      await expect(
        service.sendPasswordReset('owner@example.com', 'https://fastque.com/reset?token=live-secret', 15),
      ).rejects.toBeDefined();
      const loggedText = loggerErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toContain('test-secret-key-do-not-log-me');
    });

    it('never logs the live reset URL (it embeds a single-use token)', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(401, { message: 'invalid key' }));
      await expect(
        service.sendPasswordReset('owner@example.com', 'https://fastque.com/reset?token=live-secret', 15),
      ).rejects.toBeDefined();
      const loggedText = loggerErrorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toContain('live-secret');
    });
  });
});
