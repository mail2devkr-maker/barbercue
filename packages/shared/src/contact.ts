// Live Queue contact details. A queue entry must always be contactable by the shop, but FastQue
// accounts do not reliably carry a phone number (Google sign-in creates email-only users) and no
// customer display name is stored anywhere — so the join flow collects both per entry.

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes a typed mobile number to E.164, or returns null when it cannot be interpreted safely.
 * India-first (this product's market): a bare 10-digit number starting 6-9, a leading 0, or a
 * leading 91 are all read as +91. Anything else must carry an explicit "+" country code — a number
 * is never guessed into another country.
 */
export function normalizeContactPhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  let candidate: string;
  if (hasPlus) candidate = `+${digits}`;
  else if (/^[6-9]\d{9}$/.test(digits)) candidate = `+91${digits}`;
  else if (/^0[6-9]\d{9}$/.test(digits)) candidate = `+91${digits.slice(1)}`;
  else if (/^91[6-9]\d{9}$/.test(digits)) candidate = `+${digits}`;
  else return null;

  return E164.test(candidate) ? candidate : null;
}

export const CONTACT_NAME_MIN_LENGTH = 2;
export const CONTACT_NAME_MAX_LENGTH = 60;

/** Collapses whitespace and trims; returns null when the result is not a usable display name. */
export function normalizeContactName(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (cleaned.length < CONTACT_NAME_MIN_LENGTH || cleaned.length > CONTACT_NAME_MAX_LENGTH) return null;
  return cleaned;
}

/** A value safe to put in a `tel:` URL (digits and a leading +), or null when there is nothing dialable. */
export function telHrefFor(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null;
  const cleaned = phone.trim().replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `tel:${cleaned.startsWith('+') ? '+' : ''}${digits}`;
}
