import {
  allowedOtpCallingCodes,
  isOtpPhoneAllowed,
  isPhoneOtpConfigured,
  otpHashSecret,
} from './otp-config';

describe('OTP configuration', () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.OTP_PROVIDER_API_KEY,
    template: process.env.OTP_PROVIDER_TEMPLATE_NAME,
    hashSecret: process.env.OTP_HASH_SECRET,
    callingCodes: process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES,
    testSender: process.env.OTP_TEST_SENDER_ENABLED,
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_PROVIDER_API_KEY;
    delete process.env.OTP_PROVIDER_TEMPLATE_NAME;
    delete process.env.OTP_HASH_SECRET;
    delete process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES;
    delete process.env.OTP_TEST_SENDER_ENABLED;
  });

  afterAll(() => {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
    if (original.apiKey === undefined) delete process.env.OTP_PROVIDER_API_KEY;
    else process.env.OTP_PROVIDER_API_KEY = original.apiKey;
    if (original.template === undefined)
      delete process.env.OTP_PROVIDER_TEMPLATE_NAME;
    else process.env.OTP_PROVIDER_TEMPLATE_NAME = original.template;
    if (original.hashSecret === undefined) delete process.env.OTP_HASH_SECRET;
    else process.env.OTP_HASH_SECRET = original.hashSecret;
    if (original.callingCodes === undefined)
      delete process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES;
    else process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = original.callingCodes;
    if (original.testSender === undefined)
      delete process.env.OTP_TEST_SENDER_ENABLED;
    else process.env.OTP_TEST_SENDER_ENABLED = original.testSender;
  });

  it('requires all production provider, template, HMAC, and country-allowlist settings', () => {
    expect(isPhoneOtpConfigured()).toBe(false);
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'FASTQUE_LOGIN';
    process.env.OTP_HASH_SECRET =
      'synthetic-secret-at-least-thirty-two-bytes-long';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    expect(isPhoneOtpConfigured()).toBe(true);
  });

  it('rejects malformed provider templates and weak hash secrets', () => {
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'template name with spaces';
    process.env.OTP_HASH_SECRET = 'short';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    expect(otpHashSecret()).toBeNull();
    expect(isPhoneOtpConfigured()).toBe(false);
  });

  it('permits only the explicit test sender capability in NODE_ENV=test, never from production test flags', () => {
    process.env.OTP_HASH_SECRET =
      'synthetic-secret-at-least-thirty-two-bytes-long';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    process.env.OTP_TEST_SENDER_ENABLED = 'true';
    expect(isPhoneOtpConfigured()).toBe(false);
    process.env.NODE_ENV = 'test';
    expect(isPhoneOtpConfigured()).toBe(true);
  });

  it('parses explicit calling-code allowlists and matches E.164 prefixes', () => {
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = ' +91,1,garbage,0123, 44 ';
    expect(allowedOtpCallingCodes()).toEqual(['91', '1', '44']);
    expect(isOtpPhoneAllowed('+919876543210')).toBe(true);
    expect(isOtpPhoneAllowed('+14155552671')).toBe(true);
    expect(isOtpPhoneAllowed('+81312345678')).toBe(false);
  });
});
