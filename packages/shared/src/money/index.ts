import { CREDIT_PER_SLAB_INR, CREDIT_SLAB_AMOUNT_INR } from '../constants';

/**
 * FastQue Credits / Wallet — authoritative money representation (Part 11 precision hardening).
 *
 * The server's actual financial *authority* (redemption cap, actualCreditsUsed, payableAmount,
 * subsidy amount, lot consumption) must never be computed by dividing/multiplying a JS `number`
 * that represents a fractional rupee amount — IEEE-754 doubles cannot exactly represent most
 * 2-decimal-place values (0.01, 0.03, ... are all repeating binary fractions), so an unbounded
 * chain of such operations is not something this module accepts "is probably fine" for financial
 * authority, regardless of how the specific slab formula happens to behave for realistic inputs.
 *
 * Integer PAISE (1 rupee = 100 paise) is the safe representation instead: every persisted rupee
 * amount in this product has at most 2 decimal places (`@db.Decimal(10,2)`), so it converts to an
 * exact integer count of paise with zero rounding. Once in paise, +, -, Math.min/Math.max, and
 * comparisons are all EXACT per IEEE-754 (doubles represent every integer up to 2^53 exactly) —
 * only the slab-cap formula's division needs BigInt, since dividing by a non-power-of-2 amount is
 * the one place ordinary integer division could in principle land on a non-representable exact
 * quotient (see computeMaxRedeemableCreditsPaise).
 *
 * The ONLY conversions in or out of paise happen at controlled boundaries:
 *   - IN: a Prisma.Decimal's own `.toString()` (never `Number(decimal)`), or a request value
 *     already validated by a zod `.multipleOf(0.01)` check.
 *   - OUT: back to a decimal string for a Prisma `data` write, or to a display/DTO `number` for
 *     the API boundary (packages/shared has no Prisma dependency, so callers pass strings, not
 *     Prisma.Decimal instances, to the functions below).
 *
 * packages/shared's own `computeMaxRedeemableCredits` (calc/index.ts) remains as a float-based
 * CLIENT PREVIEW ONLY — web/mobile render it before a booking exists, purely for UX, and the
 * server never trusts or reuses its result. SERVER = financial authority via this module;
 * CLIENT = preview only, always overridden by the server's actual response.
 */

export class InvalidMoneyValueError extends Error {}

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * Parses an exact decimal string (at most 2 fractional digits — e.g. Prisma.Decimal#toString(),
 * or String(n) for an n already known to have at most 2 fractional digits) into an exact integer
 * count of paise via string manipulation only — no `/` or `*` on the fractional value itself, so
 * no float rounding step is involved at all. Throws rather than rounding when the input carries a
 * third fractional digit or isn't a plain decimal number — that indicates a bug upstream (a value
 * that should already have been rejected by request validation, or an unexpected DB value), never
 * something to silently coerce.
 */
export function decimalStringToPaise(value: string): number {
  const trimmed = value.trim();
  if (!DECIMAL_STRING_PATTERN.test(trimmed)) {
    throw new InvalidMoneyValueError(
      `"${value}" is not an exact decimal amount with at most 2 fractional digits.`,
    );
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePart, fractionPartRaw = ''] = unsigned.split('.');
  const fractionPart = fractionPartRaw.padEnd(2, '0');
  const paise = Number.parseInt(wholePart, 10) * 100 + Number.parseInt(fractionPart, 10);
  return negative ? -paise : paise;
}

/**
 * Converts a JS `number` already known to have at most 2 fractional digits into paise. Safe
 * specifically because `String(value)` produces the shortest decimal string that round-trips back
 * to the same double — for every real-world rupee-and-paise amount this is the exact literal the
 * caller intended (verified empirically: no realistic 2-decimal INR amount prints with spurious
 * trailing float noise). This is NOT a general float-to-decimal rounding helper — a value with a
 * genuine 3rd fractional digit still throws via decimalStringToPaise's own pattern check, exactly
 * like a malformed string would. The real precondition (at most 2 decimal places) belongs at the
 * request-validation boundary (zod `.multipleOf(0.01)`); this is a second, defensive check, not
 * the primary one.
 */
export function numberToPaise(value: number): number {
  if (!Number.isFinite(value)) {
    throw new InvalidMoneyValueError(`${value} is not a finite money amount.`);
  }
  return decimalStringToPaise(String(value));
}

/** Inverse of decimalStringToPaise — for a Prisma `data` write (Prisma parses the string directly
 * into its Decimal representation, so this never re-enters float space on the way back in). */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new InvalidMoneyValueError(`${paise} is not an integer paise amount.`);
  }
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${negative ? '-' : ''}${rupees}.${String(remainder).padStart(2, '0')}`;
}

/** Rupee-scale `number` for a display/DTO/API boundary only — never fed back into further
 * authoritative arithmetic. See this module's own doc comment on controlled boundaries. */
export function paiseToRupees(paise: number): number {
  if (!Number.isInteger(paise)) {
    throw new InvalidMoneyValueError(`${paise} is not an integer paise amount.`);
  }
  return Number(paiseToDecimalString(paise));
}

/**
 * FastQue Credits / Wallet — the authoritative, paise-exact REDEMPTION CAP formula. Conceptually
 * identical to calc/index.ts's computeMaxRedeemableCredits (floor(price/50)*10) but performed with
 * BigInt integer division so the slab count is never derived from a floating-point `/` on a
 * fractional rupee value — this is the version the server's actual authority calls; the shared
 * float version remains client-preview-only (see this module's own header comment).
 */
export function computeMaxRedeemableCreditsPaise(serviceSubtotalPaise: number): number {
  if (!Number.isInteger(serviceSubtotalPaise) || serviceSubtotalPaise < 0) {
    throw new InvalidMoneyValueError(
      `${serviceSubtotalPaise} is not a valid non-negative integer paise amount.`,
    );
  }
  const slabPaise = BigInt(CREDIT_SLAB_AMOUNT_INR * 100);
  const creditPerSlabPaise = BigInt(CREDIT_PER_SLAB_INR * 100);
  const slabs = BigInt(serviceSubtotalPaise) / slabPaise; // exact integer division (truncation == floor for non-negative operands)
  return Number(slabs * creditPerSlabPaise);
}
