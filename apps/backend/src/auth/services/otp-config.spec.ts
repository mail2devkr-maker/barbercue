import {
  allowedOtpCallingCodes,
  isOtpPhoneAllowed,
  isPhoneOtpConfigured,
  otpDeliveryLimits,
  otpHashSecret,
  otpPhoneCallingCode,
  otpPilotRestriction,
  otpProviderApiMode,
} from './otp-config';

describe('OTP configuration', () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.OTP_PROVIDER_API_KEY,
    providerMode: process.env.OTP_PROVIDER_API_MODE,
    template: process.env.OTP_PROVIDER_TEMPLATE_NAME,
    hashSecret: process.env.OTP_HASH_SECRET,
    callingCodes: process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES,
    globalDaily: process.env.OTP_MAX_DAILY_GLOBAL_SENDS,
    globalRolling: process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS,
    countryDaily: process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS,
    testSender: process.env.OTP_TEST_SENDER_ENABLED,
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_PROVIDER_API_KEY;
    delete process.env.OTP_PROVIDER_API_MODE;
    delete process.env.OTP_PROVIDER_TEMPLATE_NAME;
    delete process.env.OTP_HASH_SECRET;
    delete process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES;
    delete process.env.OTP_MAX_DAILY_GLOBAL_SENDS;
    delete process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS;
    delete process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS;
    delete process.env.OTP_TEST_SENDER_ENABLED;
  });

  afterAll(() => {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original.nodeEnv;
    if (original.apiKey === undefined) delete process.env.OTP_PROVIDER_API_KEY;
    else process.env.OTP_PROVIDER_API_KEY = original.apiKey;
    if (original.providerMode === undefined)
      delete process.env.OTP_PROVIDER_API_MODE;
    else process.env.OTP_PROVIDER_API_MODE = original.providerMode;
    if (original.template === undefined)
      delete process.env.OTP_PROVIDER_TEMPLATE_NAME;
    else process.env.OTP_PROVIDER_TEMPLATE_NAME = original.template;
    if (original.hashSecret === undefined) delete process.env.OTP_HASH_SECRET;
    else process.env.OTP_HASH_SECRET = original.hashSecret;
    if (original.callingCodes === undefined)
      delete process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES;
    else process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = original.callingCodes;
    if (original.globalDaily === undefined)
      delete process.env.OTP_MAX_DAILY_GLOBAL_SENDS;
    else process.env.OTP_MAX_DAILY_GLOBAL_SENDS = original.globalDaily;
    if (original.globalRolling === undefined)
      delete process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS;
    else process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = original.globalRolling;
    if (original.countryDaily === undefined)
      delete process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS;
    else process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = original.countryDaily;
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
    process.env.OTP_MAX_DAILY_GLOBAL_SENDS = '100';
    process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = '50';
    process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '100';
    expect(isPhoneOtpConfigured()).toBe(true);
  });

  it('rejects malformed provider templates and weak hash secrets', () => {
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'template name with spaces';
    process.env.OTP_HASH_SECRET = 'short';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    process.env.OTP_MAX_DAILY_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '10';
    expect(otpHashSecret()).toBeNull();
    expect(isPhoneOtpConfigured()).toBe(false);
  });

  it('permits only the explicit test sender capability in NODE_ENV=test, never from production test flags', () => {
    process.env.OTP_HASH_SECRET =
      'synthetic-secret-at-least-thirty-two-bytes-long';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    process.env.OTP_MAX_DAILY_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '10';
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
    expect(otpPhoneCallingCode('+919876543210')).toBe('91');
    expect(otpPhoneCallingCode('+14155552671')).toBe('1');
  });

  describe('owner-only pilot restriction', () => {
    const PILOT = '+919876500001';
    const OTHER = '+919876500002';

    function configureProduction() {
      process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-key';
      process.env.OTP_PROVIDER_TEMPLATE_NAME = 'OTP1';
      process.env.OTP_HASH_SECRET =
        'synthetic-secret-at-least-thirty-two-bytes-long';
      process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
      process.env.OTP_MAX_DAILY_GLOBAL_SENDS = '5';
      process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = '5';
      process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '5';
    }

    afterEach(() => {
      delete process.env.OTP_PILOT_ALLOWED_PHONES;
    });

    it('is off by default: any number in an allowed country is accepted', () => {
      configureProduction();
      expect(otpPilotRestriction().restricted).toBe(false);
      expect(isOtpPhoneAllowed(OTHER)).toBe(true);
    });

    it('allows only the listed numbers, with or without +, and still honours the country list', () => {
      configureProduction();
      process.env.OTP_PILOT_ALLOWED_PHONES = ` ${PILOT.slice(1)} `;
      expect(isPhoneOtpConfigured()).toBe(true);
      expect(isOtpPhoneAllowed(PILOT)).toBe(true);
      expect(isOtpPhoneAllowed(PILOT.slice(1))).toBe(true);
      expect(isOtpPhoneAllowed(OTHER)).toBe(false);
      expect(isOtpPhoneAllowed('+14155552671')).toBe(false);
      process.env.OTP_PILOT_ALLOWED_PHONES = '+14155552671';
      expect(isOtpPhoneAllowed('+14155552671')).toBe(false); // country 1 not allowed
    });

    it('supports a small comma-separated list', () => {
      configureProduction();
      process.env.OTP_PILOT_ALLOWED_PHONES = `${PILOT}, ${OTHER}`;
      expect(isOtpPhoneAllowed(PILOT)).toBe(true);
      expect(isOtpPhoneAllowed(OTHER)).toBe(true);
      expect(isOtpPhoneAllowed('+919876500003')).toBe(false);
    });

    it.each([
      ['garbage', 'not-a-number'],
      ['one bad entry', `${PILOT},abc`],
      [
        'too many entries',
        '+919876500001,+919876500002,+919876500003,+919876500004',
      ],
      ['a leading zero', '+0919876500001'],
      ['an empty entry', `${PILOT},`],
    ])(
      'fails closed on %s: nobody is allowed and phone OTP is unavailable',
      (_n, value) => {
        configureProduction();
        process.env.OTP_PILOT_ALLOWED_PHONES = value;
        expect(otpPilotRestriction()).toEqual({
          restricted: true,
          phones: new Set(),
        });
        expect(isOtpPhoneAllowed(PILOT)).toBe(false);
        expect(isPhoneOtpConfigured()).toBe(false);
      },
    );
  });

  it('keeps SMS disabled when any global or per-country hard ceiling is missing or invalid', () => {
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'FASTQUE_LOGIN';
    process.env.OTP_HASH_SECRET =
      'synthetic-secret-at-least-thirty-two-bytes-long';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    process.env.OTP_MAX_DAILY_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = '10';
    expect(isPhoneOtpConfigured()).toBe(false);
    process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '0';
    expect(otpDeliveryLimits()).toBeNull();
    expect(isPhoneOtpConfigured()).toBe(false);
    process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '5';
    expect(otpDeliveryLimits()).toEqual({
      globalDaily: 10,
      globalRolling24Hours: 10,
      perCountryDaily: 5,
    });
    expect(isPhoneOtpConfigured()).toBe(true);
  });

  it('keeps POST as default, enables manual-v1 only by explicit selection, and rejects unknown modes', () => {
    expect(otpProviderApiMode()).toBe('post');
    process.env.OTP_PROVIDER_API_KEY = 'synthetic-test-key';
    process.env.OTP_PROVIDER_TEMPLATE_NAME = 'OTP1';
    process.env.OTP_HASH_SECRET =
      'synthetic-secret-at-least-thirty-two-bytes-long';
    process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';
    process.env.OTP_MAX_DAILY_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_ROLLING_24H_GLOBAL_SENDS = '10';
    process.env.OTP_MAX_DAILY_PER_COUNTRY_SENDS = '10';
    expect(isPhoneOtpConfigured()).toBe(true);

    process.env.OTP_PROVIDER_API_MODE = 'manual-v1';
    expect(otpProviderApiMode()).toBe('manual-v1');
    expect(isPhoneOtpConfigured()).toBe(true);

    process.env.OTP_PROVIDER_API_MODE = 'AUTOGEN';
    expect(otpProviderApiMode()).toBeNull();
    expect(isPhoneOtpConfigured()).toBe(false);
  });
});
