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

const MAX_PILOT_PHONES = 3;

function phoneDigits(phone: string): string {
  return phone.trim().replace(/^\+/, '');
}

/**
 * Owner-only pilot: when OTP_PILOT_ALLOWED_PHONES is set, real SMS may go ONLY to the listed
 * numbers (comma-separated E.164, at most MAX_PILOT_PHONES). Unset keeps the normal country-wide
 * behaviour. A set-but-unusable value (garbage, too many entries) fails closed: it restricts
 * delivery to nobody and keeps phone OTP unconfigured, so a typo can never widen SMS sending.
 */
export function otpPilotRestriction(): {
  restricted: boolean;
  phones: ReadonlySet<string>;
} {
  const raw = process.env.OTP_PILOT_ALLOWED_PHONES?.trim();
  if (!raw) return { restricted: false, phones: new Set() };
  const entries = raw.split(',').map(phoneDigits);
  const valid =
    entries.length <= MAX_PILOT_PHONES &&
    entries.every((entry) => /^[1-9]\d{7,14}$/.test(entry));
  return { restricted: true, phones: new Set(valid ? entries : []) };
}

export function isOtpPhoneAllowed(phone: string): boolean {
  if (otpPhoneCallingCode(phone) === null) return false;
  const pilot = otpPilotRestriction();
  return !pilot.restricted || pilot.phones.has(phoneDigits(phone));
}

/** Existing POST path remains the default; an unsupported configured mode must fail closed. */
export function otpProviderApiMode(): 'post' | 'manual-v1' | null {
  const value = process.env.OTP_PROVIDER_API_MODE?.trim();
  if (!value || value === 'post') return 'post';
  if (value === 'manual-v1') return 'manual-v1';
  return null;
}

export function isPhoneOtpConfigured(): boolean {
  const apiKey = process.env.OTP_PROVIDER_API_KEY?.trim();
  const template = process.env.OTP_PROVIDER_TEMPLATE_NAME?.trim();
  const providerConfigured = Boolean(
    process.env.NODE_ENV === 'production' &&
    apiKey &&
    otpProviderApiMode() &&
    template &&
    /^[A-Za-z0-9_-]{1,64}$/.test(template),
  );
  // The only non-production enablement is an explicit test-mode switch. E2E tests replace the
  // OTP_SENDER provider before the app starts, so this cannot route test challenges to 2Factor.
  const testSenderEnabled =
    process.env.NODE_ENV === 'test' &&
    process.env.OTP_TEST_SENDER_ENABLED === 'true';
  const pilot = otpPilotRestriction();
  return Boolean(
    (providerConfigured || testSenderEnabled) &&
    (!pilot.restricted || pilot.phones.size > 0) &&
    otpHashSecret() &&
    allowedOtpCallingCodes().length > 0 &&
    otpDeliveryLimits() !== null,
  );
}
