// Country-driven presentation and validation rules.
//
// DELIBERATELY SMALL. Every entry here is a rule we can state authoritatively for a country the
// platform actually operates in. Adding a country means adding real, verified rules — never a
// plausible guess. A wrong postal regex silently rejects legitimate businesses, and a wrong
// currency mislabels prices; both are worse than falling back to the permissive defaults below.
//
// countryCode is always ISO-3166-1 alpha-2 (City.countryCode), never the free-text City.country.

export interface PostalCodeRule {
  /** Full-match pattern for a valid postal code in this country. */
  regex: RegExp;
  /** Shown to the owner as a hint, and used in validation messages. */
  example: string;
  /** False for countries that have no national postal system worth requiring. */
  required: boolean;
  /** Country-specific label — "PIN Code" in India, "ZIP Code" in the US, "Postcode" in the UK. */
  label: string;
}

/**
 * India's rule is the exact pattern that shipped in Phase 11 (INDIAN_PIN_CODE_REGEX): six digits,
 * never starting with zero, since the leading digit is the postal region (1-8). Unchanged and
 * unweakened.
 */
export const POSTAL_CODE_RULES: Readonly<Record<string, PostalCodeRule>> = {
  IN: {
    regex: /^[1-9][0-9]{5}$/,
    example: '560001',
    required: true,
    label: 'PIN Code',
  },
};

/**
 * Used for any country without an entry above. Permissive on purpose: rejecting a real address
 * because we lack a rule is a worse failure than accepting an imperfect one. Not required, because
 * several countries (UAE, Hong Kong) have no postal code to give.
 */
export const GENERIC_POSTAL_CODE_RULE: PostalCodeRule = {
  regex: /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/,
  example: '',
  required: false,
  label: 'Postal code',
};

export function postalCodeRuleFor(countryCode: string | null | undefined): PostalCodeRule {
  if (!countryCode) return GENERIC_POSTAL_CODE_RULE;
  return POSTAL_CODE_RULES[countryCode.toUpperCase()] ?? GENERIC_POSTAL_CODE_RULE;
}

/** True when `value` is acceptable for `countryCode`. Empty is valid only where not required. */
export function isValidPostalCode(
  countryCode: string | null | undefined,
  value: string | null | undefined,
): boolean {
  const rule = postalCodeRuleFor(countryCode);
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return !rule.required;
  return rule.regex.test(trimmed);
}

// ---------- Currency ----------

/**
 * Only for countries with a single unambiguous national currency that we actually operate in.
 * Used to populate Salon.currency at registration; an unlisted country leaves it null rather than
 * guessing, and the UI then renders a bare amount instead of a wrong symbol.
 */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  IN: 'INR',
};

export function currencyForCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? null;
}

// ---------- Distance ----------

/**
 * Part 8/9 correction — the only countries where everyday distances are customarily communicated
 * in miles rather than km. Deliberately as small/conservative as COUNTRY_CURRENCY above: every
 * other country gets the metric display below, never a guessed unit.
 */
export const IMPERIAL_DISTANCE_COUNTRY_CODES: ReadonlySet<string> = new Set(['US', 'LR', 'MM']);

export function usesImperialDistance(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return IMPERIAL_DISTANCE_COUNTRY_CODES.has(countryCode.toUpperCase());
}

const KM_PER_MILE = 1.609344;

/**
 * Formats a distance already computed in km — the one canonical unit search filtering/sorting
 * ever uses, on both server and client, regardless of what this function displays — as
 * customer-friendly text. `countryCode` should be the specific salon's own country (the same field
 * formatMoney already takes it from), never a device-wide setting: there is no per-user unit
 * preference in this app today, so this is a deterministic, per-result, country-based display rule
 * exactly like formatMoney's own currency-by-country resolution, not an invented preference system.
 *
 * Metric shows meters below 1km (matching the distance-filter chips' own 100m/200m/500m
 * granularity) and km with one decimal place above it. Imperial always shows miles — converting
 * only for display; the underlying km value and every filter/sort computation are untouched.
 */
export function formatDistance(km: number, countryCode: string | null | undefined): string {
  if (usesImperialDistance(countryCode)) {
    const miles = km / KM_PER_MILE;
    const rounded = miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
    return `${rounded} mi`;
  }
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${rounded} km`;
}

/**
 * Locale used for number grouping. India groups as 12,34,567 rather than 1,234,567, so this is a
 * correctness concern, not cosmetics. An unlisted country falls back to the runtime default.
 */
export const COUNTRY_LOCALE: Readonly<Record<string, string>> = {
  IN: 'en-IN',
};

export function localeForCountry(countryCode: string | null | undefined): string | undefined {
  if (!countryCode) return undefined;
  return COUNTRY_LOCALE[countryCode.toUpperCase()];
}

/**
 * Formats a salon/service price for display.
 *
 * `minimumFractionDigits: 0` preserves exactly what the UI rendered before this existed — "₹300",
 * not "₹300.00" — while `maximumFractionDigits: 2` still shows real paise when present.
 *
 * A null/unknown currency renders the bare grouped number with no symbol. That is deliberate: an
 * amount with the wrong currency symbol is misinformation, whereas an unlabelled number is merely
 * incomplete. Salon.currency is nullable until registration always populates it.
 *
 * Note this takes a MAJOR-unit amount (300 = ₹300), matching how Service.price is stored today.
 * The minor-unit migration (D9/D10) is deliberately not part of this change.
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  countryCode?: string | null,
): string {
  const locale = localeForCountry(countryCode);
  if (!currency) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Intl throws RangeError on an unrecognised currency code. Degrade to a plain number rather
    // than crashing a price list over one bad value.
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

// ---------- Phone ----------

/**
 * Placeholder shown in phone inputs. E.164 validation itself is already country-agnostic
 * (see otpRequestSchema) and is NOT changed by this map — only the example shown to the user.
 */
export const COUNTRY_PHONE_EXAMPLE: Readonly<Record<string, string>> = {
  IN: '+919876543210',
};

export function phonePlaceholderForCountry(
  countryCode: string | null | undefined,
): string {
  if (!countryCode) return '+…';
  return COUNTRY_PHONE_EXAMPLE[countryCode.toUpperCase()] ?? '+…';
}

// ---------- Zoned date/time (Part 5 — show arrival time after booking) ----------
//
// Every booking-time render on web and mobile used to call `Date#toLocaleString()` /
// `toLocaleTimeString()` with no `timeZone` option, which silently formats in the *device's* own
// timezone. That is correct for a customer booking a shop in their own city, but actively wrong
// the moment they book a shop in a different one (e.g. traveling, or a multi-city product) — the
// exact "arrival time" a customer is shown could be off by hours with no indication anything was
// wrong. These helpers are the single place that formats a booking instant, so both apps convert
// through the salon's own IANA zone (BookingDetailDto.salonTimezone, resolved server-side by
// resolveSalonTimeZone) the same way, instead of each re-implementing (or forgetting) it.

/**
 * Formats an ISO instant as wall-clock text in a specific IANA zone. An unknown/invalid timezone
 * string throws inside `Intl.DateTimeFormat`; rather than crash a booking screen over one bad
 * value, this falls back to formatting with no explicit zone (the runtime's own default) — the
 * same "incomplete beats wrong" precedent formatMoney above follows for an unlisted currency.
 */
export function formatZonedDateTime(
  iso: string,
  timezone: string | null | undefined,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone ?? undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

/**
 * A stable 'YYYY-MM-DD' key for `iso`'s calendar date in `timezone` — always this exact format
 * regardless of `Intl`'s locale-dependent field ordering, via the same 'en-CA' trick the backend's
 * own timezone.ts formatter uses. For comparing "is this the same calendar day as X" (e.g.
 * "Today"/"Tomorrow" labeling) in the salon's own zone rather than the device's — the day boundary
 * itself can differ by zone, not just the clock time shown within it.
 */
export function zonedDateKey(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

export interface BookingArrivalTime {
  /** e.g. "Fri, Sep 12" */
  date: string;
  /** e.g. "3:45 PM" */
  time: string;
  /**
   * True when `timezone` is missing OR matches the *viewing device's* own resolved zone. The UI
   * uses this to decide whether a "(shop's local time)" qualifier is worth showing — pointless
   * (and slightly confusing) when the customer's own device is already in that same zone, but
   * exactly the disambiguation a traveling customer needs when it isn't.
   */
  isDeviceLocalTimezone: boolean;
}

/**
 * The one function every booking confirmation/detail/list screen should call to show an "arrival
 * time" — never a raw `new Date(slotStart).toLocaleString()`. `timezone` should be the booking's
 * `salonTimezone` (null when the salon's zone genuinely could not be resolved server-side, in
 * which case this degrades to the device's own zone, same as the pre-Part-5 behavior, rather than
 * fabricating one).
 */
export function formatBookingArrivalTime(
  iso: string,
  timezone: string | null | undefined,
  locale?: string,
): BookingArrivalTime {
  const date = formatZonedDateTime(iso, timezone, locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = formatZonedDateTime(iso, timezone, locale, {
    hour: 'numeric',
    minute: '2-digit',
  });
  let deviceTimezone: string | null = null;
  try {
    deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    deviceTimezone = null;
  }
  const isDeviceLocalTimezone = !timezone || !deviceTimezone || timezone === deviceTimezone;
  return { date, time, isDeviceLocalTimezone };
}
