import { useEffect, useState } from 'react';
import { OTP_RESEND_COOLDOWN_SECONDS, type AuthMethodsDto, type AuthTokens, type MeResponse } from '@barbercue/shared';
import { ApiError, apiFetch } from './api';

// Returning shop-owner phone sign-in (Issue #211, Draft PR #214 "Mobile phone OTP integration handoff").
//
// Contract used here, exactly as documented in that PR:
//   GET  auth/methods              -> { google, phoneOtp, ownerPhoneOtp }   (booleans only; a missing field means "off")
//   POST auth/owner/otp/request    { phone: E.164 }                         -> generic response, no account disclosure
//   POST auth/owner/otp/verify     { phone: E.164, code: 6 digits }         -> { user, tokens } with a STAFF-audience session
// The server only issues that session for a phone already verified on an ACTIVE account that holds a salon-scoped
// SALON_OWNER role and is the salon's canonical owner. Unknown or non-owner numbers get the SAME generic response,
// so this client must never say whether a number belongs to an owner.
//
// The route strings are literals because the shared constants for these routes arrive with PR #214; they will
// switch to the shared exports once that PR is merged. Phone numbers, codes and tokens are never logged.

export const OWNER_OTP_PATHS = {
  methods: 'auth/methods',
  request: 'auth/owner/otp/request',
  verify: 'auth/owner/otp/verify',
} as const;

export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5; // server-side; shown to the owner so the message is accurate

export type AuthMethodsWithOwner = AuthMethodsDto & { ownerPhoneOtp?: boolean };

/** Digits only, with any leading zeros of a national number removed (a trunk prefix is not part of E.164). */
function nationalDigits(value: string): string {
  return value.replace(/\D+/g, '').replace(/^0+/, '');
}

/** "+91" or "91" or " + 9 1 " -> "+91". Returns null when it is not a plausible country calling code (1 to 3 digits). */
export function normalizeDialCode(value: string): string | null {
  const digits = value.replace(/\D+/g, '');
  return /^[1-9]\d{0,2}$/.test(digits) ? `+${digits}` : null;
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/** Builds an E.164 number from a country code and the number as typed (spaces, dashes and brackets are ignored). Null when invalid. */
export function toE164(dialCode: string, national: string): string | null {
  const code = normalizeDialCode(dialCode);
  const digits = nationalDigits(national);
  if (!code || digits.length === 0) return null;
  const phone = `${code}${digits}`;
  return isValidE164(phone) ? phone : null;
}

export function isValidOtpCode(code: string): boolean {
  return new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(code);
}

/** Keeps only digits and caps the length, for the code input. */
export function cleanOtpInput(value: string): string {
  return value.replace(/\D+/g, '').slice(0, OTP_CODE_LENGTH);
}

/** Whole seconds until `until` (ms epoch), never negative. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function cooldownUntil(now: number): number {
  return now + OTP_RESEND_COOLDOWN_SECONDS * 1000;
}

export type OtpFailure = 'RATE_LIMITED' | 'INVALID_OR_EXPIRED' | 'UNAVAILABLE' | 'NETWORK' | 'OTHER';

/**
 * Maps a failed call to a recoverable state. Deliberately coarse: the server answers invalid, expired, wrong-role
 * and unknown-number cases generically, and the client must not try to tell them apart.
 */
export function classifyOtpError(err: unknown): OtpFailure {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'RATE_LIMITED';
    if (err.status === 400 || err.status === 401 || err.status === 403 || err.status === 404 || err.status === 409 || err.status === 422) return 'INVALID_OR_EXPIRED';
    if (err.status === 502 || err.status === 503 || err.status === 504) return 'UNAVAILABLE';
    return 'OTHER';
  }
  return 'NETWORK';
}

/** Reads the capability probe. Any failure means "not available": the option is simply not offered. */
export async function fetchOwnerPhoneOtpAvailable(): Promise<boolean> {
  try {
    const methods = await apiFetch<AuthMethodsWithOwner>(OWNER_OTP_PATHS.methods);
    return methods.ownerPhoneOtp === true;
  } catch {
    return false;
  }
}

/** True once the capability probe says owner phone sign-in is on; false while loading and on any error. */
export function useOwnerPhoneOtpAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchOwnerPhoneOtpAvailable().then((value) => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export function requestOwnerOtp(phone: string): Promise<unknown> {
  return apiFetch(OWNER_OTP_PATHS.request, { method: 'POST', body: JSON.stringify({ phone }) });
}

export function verifyOwnerOtp(phone: string, code: string): Promise<{ user: MeResponse; tokens: AuthTokens }> {
  return apiFetch<{ user: MeResponse; tokens: AuthTokens }>(OWNER_OTP_PATHS.verify, {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  });
}
