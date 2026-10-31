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
  const originalMode = process.env.OTP_PROVIDER_API_MODE;

  beforeEach(async () => {
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-provider-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'FASTQUE_LOGIN_TEST';
    delete process.env.OTP_PROVIDER_API_MODE;
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
    if (originalMode === undefined) delete process.env.OTP_PROVIDER_API_MODE;
    else process.env.OTP_PROVIDER_API_MODE = originalMode;
    jest.useRealTimers();
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

  it('rejects non-2xx, non-sent, malformed and network errors with a generic error', async () => {
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

  it('aborts a stalled provider request at the configured eight-second timeout without leaking request data', async () => {
    jest.useFakeTimers();
    fetchSpy.mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () =>
            reject(new DOMException('synthetic abort detail', 'AbortError')),
          { once: true },
        );
      });
    });

    const pending = service.sendOtp('+919876543210', '123456');
    const rejected = expect(pending).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
      message:
        'Could not send the verification code. Please try again in a moment.',
    });
    const signal = fetchSpy.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(7_999);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signal?.aborted).toBe(true);

    const logs = loggerErrorSpy.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(logs).toContain('timed out');
    expect(logs).not.toContain('synthetic-test-provider-key');
    expect(logs).not.toContain('+919876543210');
    expect(logs).not.toContain('123456');
    expect(logs).not.toContain('synthetic abort detail');
  });

  it('keeps the timeout active while reading provider response body', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchSpy.mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () =>
                reject(
                  new DOMException('synthetic abort detail', 'AbortError'),
                ),
              { once: true },
            );
          }),
      } as Response);
    });

    const pending = service.sendOtp('+919876543210', '123456');
    const rejected = expect(pending).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(8_000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      '2Factor OTP request timed out.',
    );
  });

  it('sends FastQue-generated six-digit OTP through the manual-v1 URL with OTP1', async () => {
    process.env.OTP_PROVIDER_API_MODE = 'manual-v1';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'OTP1';
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { Status: 'Success', Details: 'synthetic-session-id' }),
    );

    await service.sendOtp('+919876543210', '012345');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://2factor.in/API/V1/synthetic-test-provider-key/SMS/919876543210/012345/OTP1',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    const request = fetchSpy.mock.calls[0][1];
    expect(request?.headers).toBeUndefined();
    expect(request?.body).toBeUndefined();
  });

  it('accepts only legacy Success with a nonempty session and never treats errors as delivery', async () => {
    process.env.OTP_PROVIDER_API_MODE = 'manual-v1';
    for (const providerResponse of [
      { Status: 'Error', Details: 'invalid template' },
      { Status: 'Success', Details: '' },
      { Status: 'sent', Details: 'synthetic-session-id' },
      { status: 'sent', session_id: 'post-format' },
      {},
    ]) {
      fetchSpy.mockResolvedValueOnce(jsonResponse(200, providerResponse));
      await expect(
        service.sendOtp('+919876543210', '654321'),
      ).rejects.toMatchObject({ code: AuthErrorCode.OTP_DELIVERY_FAILED });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('fails closed on malformed OTP, phone, template or unknown mode before calling provider', async () => {
    process.env.OTP_PROVIDER_API_MODE = 'manual-v1';
    await expect(service.sendOtp('+919876543210', '1234')).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    await expect(service.sendOtp('9876543210', '123456')).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'template with spaces';
    await expect(service.sendOtp('+919876543210', '123456')).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'OTP1';
    process.env.OTP_PROVIDER_API_MODE = 'unsupported-provider-mode';
    await expect(service.sendOtp('+919876543210', '123456')).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never logs the sensitive legacy URL, OTP, provider error body, phone or API key', async () => {
    process.env.OTP_PROVIDER_API_MODE = 'manual-v1';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'OTP1';
    fetchSpy.mockRejectedValueOnce(
      new Error('https://2factor.in/API/V1/synthetic-test-provider-key/SMS/919876543210/987654/OTP1'),
    );
    await expect(service.sendOtp('+919876543210', '987654')).rejects.toMatchObject({
      code: AuthErrorCode.OTP_DELIVERY_FAILED,
    });
    const logs = loggerErrorSpy.mock.calls.map((call) => String(call[0])).join('\\n');
    expect(logs).not.toContain('synthetic-test-provider-key');
    expect(logs).not.toContain('919876543210');
    expect(logs).not.toContain('987654');
    expect(logs).not.toContain('https://');
  });
});
