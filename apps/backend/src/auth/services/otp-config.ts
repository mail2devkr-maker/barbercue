/** Values are read only by the backend. Never expose or log API keys or hash secrets. */
export function otpHashSecret(): string | null {
  const secret = process.env.OTP_HASH_SECRET;
  return secret && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

export function allowedOtpCallingCodes(): string[] {
  return (process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^\+/, ''))
    .filter((value) => /^[1-9]\d{0,2}$/.test(value));
}

export interface OtpDeliveryLimits {
  globalDaily: number;
  globalRolling24Hours: number;
  perCountryDaily: number;
}

function positiveIntegerSetting(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** OTP is fail-closed unless the owner supplies explicit hard message ceilings. */
export function otpDeliveryLimits(): OtpDeliveryLimits | null {
  const globalDaily = positiveIntegerSetting('OTP_MAX_DAILY_GLOBAL_SENDS');
  const globalRolling24Hours = positiveIntegerSetting(
    'OTP_MAX_ROLLING_24H_GLOBAL_SENDS',
  );
  const perCountryDaily = positiveIntegerSetting(
    'OTP_MAX_DAILY_PER_COUNTRY_SENDS',
  );
  if (
    globalDaily === null ||
    globalRolling24Hours === null ||
    perCountryDaily === null
  ) {
    return null;
  }
  return { globalDaily, globalRolling24Hours, perCountryDaily };
}

export function otpPhoneCallingCode(phone: string): string | null {
  const digits = phone.startsWith('+') ? phone.slice(1) : phone;
  return (
    [...allowedOtpCallingCodes()]
      .sort((left, right) => right.length - left.length)
      .find((callingCode) => digits.startsWith(callingCode)) ?? null
  );
}

export function isOtpPhoneAllowed(phone: string): boolean {
  return otpPhoneCallingCode(phone) !== null;
}

export function isPhoneOtpConfigured(): boolean {
  const apiKey = process.env.OTP_PROVIDER_API_KEY?.trim();
  const template = process.env.OTP_PROVIDER_TEMPLATE_NAME?.trim();
  const providerConfigured = Boolean(
    process.env.NODE_ENV === 'production' &&
    apiKey &&
    template &&
    /^[A-Za-z0-9_-]{1,64}$/.test(template),
  );
  // The only non-production enablement is an explicit test-mode switch. E2E tests replace the
  // OTP_SENDER provider before the app starts, so this cannot route test challenges to 2Factor.
  const testSenderEnabled =
    process.env.NODE_ENV === 'test' &&
    process.env.OTP_TEST_SENDER_ENABLED === 'true';
  return Boolean(
    (providerConfigured || testSenderEnabled) &&
    otpHashSecret() &&
    allowedOtpCallingCodes().length > 0 &&
    otpDeliveryLimits() !== null,
  );
}
