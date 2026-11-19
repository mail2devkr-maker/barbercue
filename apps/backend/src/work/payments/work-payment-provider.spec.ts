import {
  SANDBOX_SIGNATURE_HEADER,
  SANDBOX_TIMESTAMP_HEADER,
  SandboxWorkPaymentProvider,
  UnconfiguredWorkPaymentProvider,
} from './work-payment-provider';
import { configuredWorkPaymentProvider, workMarketplaceEnabled, workPlatformFeeBps } from '../work-config';

describe('SandboxWorkPaymentProvider', () => {
  const provider = new SandboxWorkPaymentProvider('unit-test-sandbox-secret');

  it('accepts an event it signed', () => {
    const { event, headers } = provider.buildEvent('funding.succeeded', 'sbx_order_1', 275000);
    expect(provider.verifyAndParseWebhook(headers, event)).toEqual(event);
  });

  it('rejects a tampered amount, reference or type', () => {
    const { event, headers } = provider.buildEvent('payout.succeeded', 'sbx_payout_1', 50000);
    expect(() => provider.verifyAndParseWebhook(headers, { ...event, amountPaise: 500000 })).toThrow();
    expect(() => provider.verifyAndParseWebhook(headers, { ...event, reference: 'sbx_payout_2' })).toThrow();
    expect(() => provider.verifyAndParseWebhook(headers, { ...event, type: 'payout.failed' })).toThrow();
  });

  it('rejects a signature from another secret', () => {
    const other = new SandboxWorkPaymentProvider('a-different-sandbox-secret');
    const { event, headers } = other.buildEvent('funding.succeeded', 'sbx_order_1', 100);
    expect(() => provider.verifyAndParseWebhook(headers, event)).toThrow();
  });

  it('rejects a stale event even with a valid signature', () => {
    const { event } = provider.buildEvent('funding.succeeded', 'sbx_order_1', 100);
    const old = { ...event, createdAt: event.createdAt - 3600 };
    const headers = { [SANDBOX_SIGNATURE_HEADER]: provider.sign(old), [SANDBOX_TIMESTAMP_HEADER]: String(old.createdAt) };
    expect(() => provider.verifyAndParseWebhook(headers, old)).toThrow();
  });

  it('rejects missing or malformed headers', () => {
    const { event } = provider.buildEvent('funding.succeeded', 'sbx_order_1', 100);
    expect(() => provider.verifyAndParseWebhook({}, event)).toThrow();
    expect(() => provider.verifyAndParseWebhook({ [SANDBOX_SIGNATURE_HEADER]: 'zz', [SANDBOX_TIMESTAMP_HEADER]: String(event.createdAt) }, event)).toThrow();
  });

  it('refuses a short secret', () => {
    expect(() => new SandboxWorkPaymentProvider('short')).toThrow();
  });
});

describe('UnconfiguredWorkPaymentProvider', () => {
  it('fails closed for funding, payouts and webhooks', async () => {
    const p = new UnconfiguredWorkPaymentProvider();
    await expect(p.createFundingOrder()).rejects.toMatchObject({ code: 'WORK_PAYMENTS_NOT_CONFIGURED' });
    await expect(p.createPayout()).rejects.toMatchObject({ code: 'WORK_PAYMENTS_NOT_CONFIGURED' });
    expect(() => p.verifyAndParseWebhook()).toThrow();
  });
});

describe('work-config', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is off unless explicitly enabled', () => {
    delete process.env.WORK_MARKETPLACE_ENABLED;
    expect(workMarketplaceEnabled()).toBe(false);
    process.env.WORK_MARKETPLACE_ENABLED = '1';
    expect(workMarketplaceEnabled()).toBe(false);
    process.env.WORK_MARKETPLACE_ENABLED = 'true';
    expect(workMarketplaceEnabled()).toBe(true);
  });

  it('never selects the sandbox in production', () => {
    process.env.WORK_PAYMENT_PROVIDER = 'sandbox';
    process.env.NODE_ENV = 'development';
    expect(configuredWorkPaymentProvider()).toBe('sandbox');
    process.env.NODE_ENV = 'production';
    expect(configuredWorkPaymentProvider()).toBe('none');
  });

  it('falls back to the default fee on an invalid setting', () => {
    process.env.WORK_PLATFORM_FEE_BPS = '99999';
    expect(workPlatformFeeBps()).toBe(1000);
    process.env.WORK_PLATFORM_FEE_BPS = '750';
    expect(workPlatformFeeBps()).toBe(750);
  });
});
