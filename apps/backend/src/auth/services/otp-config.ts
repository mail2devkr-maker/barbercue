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

export function isOtpPhoneAllowed(phone: string): boolean {
  const digits = phone.startsWith('+') ? phone.slice(1) : phone;
  return allowedOtpCallingCodes().some((callingCode) =>
    digits.startsWith(callingCode),
  );
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
    allowedOtpCallingCodes().length > 0,
  );
}
