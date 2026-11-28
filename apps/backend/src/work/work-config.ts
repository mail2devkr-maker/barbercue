import { WORK_LIMITS } from '@barbercue/shared';

/**
 * FastQue Work runtime switches. Everything is OFF unless explicitly turned on, matching the
 * project's "new money-adjacent features ship dark" rule:
 *
 *   WORK_MARKETPLACE_ENABLED=true      the marketplace API answers at all (otherwise 404 everywhere)
 *   WORK_PAYMENT_PROVIDER=sandbox      use the clearly-labelled sandbox provider (never in production)
 *   WORK_PAYMENT_PROVIDER=manual_bank  manual NEFT/IMPS: employers transfer to the company account and
 *                                      a platform admin confirms receipt with the bank UTR; payouts are
 *                                      sent by NEFT from the company account and confirmed the same way
 *   WORK_MANUAL_BANK_ACCOUNT_NAME / _ACCOUNT_NUMBER / _IFSC / _BANK_NAME
 *                                      the company account shown to employers (manual_bank only)
 *   WORK_MANUAL_UPI_ID / _UPI_NAME     the company UPI ID (VPA) and payee name employers pay to by UPI
 *                                      (manual_bank only; bank details, UPI, or both may be set)
 *   WORK_SANDBOX_WEBHOOK_SECRET=...    HMAC secret the sandbox provider signs webhooks with
 *   WORK_PLATFORM_FEE_BPS=1000         employer-side platform fee, basis points (default 10%)
 *
 * With WORK_PAYMENT_PROVIDER unset (or manual_bank without complete company bank details), funding a
 * job fails closed with WORK_PAYMENTS_NOT_CONFIGURED, so no job can ever be advertised as funded.
 */
export function workMarketplaceEnabled(): boolean {
  return process.env.WORK_MARKETPLACE_ENABLED === 'true';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export type WorkPaymentProviderName = 'sandbox' | 'manual_bank' | 'none';

export function configuredWorkPaymentProvider(): WorkPaymentProviderName {
  const raw = (process.env.WORK_PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  // The sandbox moves no money. It must never be selectable in production, even by mistake.
  if (raw === 'sandbox' && !isProduction()) return 'sandbox';
  // Manual bank transfer needs the company account employers pay into; without it, fail closed.
  if (raw === 'manual_bank' && (manualBankAccount() || manualUpiAccount())) return 'manual_bank';
  return 'none';
}

export interface ManualBankAccount {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

/** The company bank account employers transfer to. Null unless every field is set and valid. */
export function manualBankAccount(): ManualBankAccount | null {
  const accountName = (process.env.WORK_MANUAL_BANK_ACCOUNT_NAME ?? '').trim();
  const accountNumber = (process.env.WORK_MANUAL_BANK_ACCOUNT_NUMBER ?? '')
    .replace(/\s+/g, '')
    .trim();
  const ifsc = (process.env.WORK_MANUAL_BANK_IFSC ?? '').trim().toUpperCase();
  const bankName = (process.env.WORK_MANUAL_BANK_BANK_NAME ?? '').trim();
  if (
    accountName.length < 2 ||
    !/^\d{9,18}$/.test(accountNumber) ||
    !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) ||
    bankName.length < 2
  ) {
    return null;
  }
  return { accountName, accountNumber, ifsc, bankName };
}

export interface ManualUpiAccount {
  vpa: string;
  payeeName: string;
}

/** The company UPI ID employers pay to. Null unless WORK_MANUAL_UPI_ID is a valid VPA. */
export function manualUpiAccount(): ManualUpiAccount | null {
  const vpa = (process.env.WORK_MANUAL_UPI_ID ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(vpa)) return null;
  const payeeName = (process.env.WORK_MANUAL_UPI_NAME ?? '').trim().slice(0, 60) || 'FastQue';
  return { vpa, payeeName };
}

export function workPlatformFeeBps(): number {
  const raw = Number(process.env.WORK_PLATFORM_FEE_BPS);
  if (!Number.isInteger(raw) || raw < 0 || raw > WORK_LIMITS.maxFeeBps) {
    return WORK_LIMITS.defaultFeeBps;
  }
  return raw;
}
