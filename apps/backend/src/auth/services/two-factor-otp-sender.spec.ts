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
  const originalTemplate = process.env.OTP_PROVIDER_TEMPLATE_NAME;

  beforeEach(async () => {
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-provider-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'FASTQUE_LOGIN_TEST';
    fetchSpy = jest.spyOn(global, 'fetch');
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const moduleRef = await Test.createTestingModule({
      providers: [TwoFactorOtpSender],
    }).compile();
    service = moduleRef.get(TwoFactorOtpSender);
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.OTP_PROVIDER_API_KEY;
    else process.env.OTP_PROVIDER_API_KEY = originalApiKey;
    if (originalTemplate === undefined)
      delete process.env.OTP_PROVIDER_TEMPLATE_NAME;
    else process.env.OTP_PROVIDER_TEMPLATE_NAME = originalTemplate;
    jest.restoreAllMocks();
  });

  it('uses the documented template send API over POST with key in header and OTP in the JSON body', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { status: 'sent', session_id: 'synthetic-session' }),
    );

    await service.sendOtp('+919876543210', '123456');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://2factor.in/API/V1/OTP/SEND');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'synthetic-test-provider-key',
      },
      body: JSON.stringify({
        to: '+919876543210',
        template_name: 'FASTQUE_LOGIN_TEST',
        var1: '123456',
      }),
    });
    expect(String(url)).not.toContain('synthetic-test-provider-key');
    expect(String(url)).not.toContain('123456');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a provider-accepted status as accepted transport, not as proof of handset delivery', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { status: 'SENT' }));
    await expect(
      service.sendOtp('+919876543210', '654321'),
    ).resolves.toBeUndefined();
  });

  it('fails safely when either provider credential or template configuration is missing', async () => {
    delete process.env.OTP_PROVIDER_API_KEY;
    await expect(
      service.sendOtp('+919876543210', '123456'),
    ).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-provider-key';
    delete process.env.OTP_PROVIDER_TEMPLATE_NAME;
    await expect(
      service.sendOtp('+919876543210', '123456'),
    ).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-2xx, non-sent, malformed, timeout and network errors with a generic error', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(401, {
        status: 'error',
        details: 'private provider detail',
      }),
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { status: 'queued' }));
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('synthetic parse error')),
    } as Response);
    fetchSpy.mockRejectedValueOnce(
      new Error('synthetic network error with request metadata'),
    );

    for (let i = 0; i < 4; i += 1) {
      await expect(
        service.sendOtp('+919876543210', '123456'),
      ).rejects.toMatchObject({
        code: AuthErrorCode.OTP_DELIVERY_FAILED,
        message:
          'Could not send the verification code. Please try again in a moment.',
      });
    }
    const logs = loggerErrorSpy.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(logs).not.toContain('synthetic-test-provider-key');
    expect(logs).not.toContain('+919876543210');
    expect(logs).not.toContain('123456');
    expect(logs).not.toContain('private provider detail');
    expect(logs).not.toContain('synthetic network error');
  });
});
