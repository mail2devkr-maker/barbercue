import { WORK_LIMITS } from '@barbercue/shared';

/**
 * FastQue Work runtime switches. Everything is OFF unless explicitly turned on, matching the
 * project's "new money-adjacent features ship dark" rule:
 *
 *   WORK_MARKETPLACE_ENABLED=true      the marketplace API answers at all (otherwise 404 everywhere)
 *   WORK_PAYMENT_PROVIDER=sandbox      use the clearly-labelled sandbox provider (never in production)
 *   WORK_SANDBOX_WEBHOOK_SECRET=...    HMAC secret the sandbox provider signs webhooks with
 *   WORK_PLATFORM_FEE_BPS=1000         employer-side platform fee, basis points (default 10%)
 *
 * No real payment provider is wired yet. With WORK_PAYMENT_PROVIDER unset, funding a job fails
 * closed with WORK_PAYMENTS_NOT_CONFIGURED, so no job can ever be advertised as funded.
 */
export function workMarketplaceEnabled(): boolean {
  return process.env.WORK_MARKETPLACE_ENABLED === 'true';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export type WorkPaymentProviderName = 'sandbox' | 'none';

export function configuredWorkPaymentProvider(): WorkPaymentProviderName {
  const raw = (process.env.WORK_PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  // The sandbox moves no money. It must never be selectable in production, even by mistake.
  if (raw === 'sandbox' && !isProduction()) return 'sandbox';
  return 'none';
}

export function workPlatformFeeBps(): number {
  const raw = Number(process.env.WORK_PLATFORM_FEE_BPS);
  if (!Number.isInteger(raw) || raw < 0 || raw > WORK_LIMITS.maxFeeBps) {
    return WORK_LIMITS.defaultFeeBps;
  }
  return raw;
}
