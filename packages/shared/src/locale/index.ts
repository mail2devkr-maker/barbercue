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
