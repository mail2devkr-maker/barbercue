import {
  ManualBankTransferWorkPaymentProvider,
  SANDBOX_SIGNATURE_HEADER,
  SANDBOX_TIMESTAMP_HEADER,
  SandboxWorkPaymentProvider,
  UnconfiguredWorkPaymentProvider,
} from './work-payment-provider';
import { configuredWorkPaymentProvider, manualBankAccount, manualUpiAccount, workMarketplaceEnabled, workPlatformFeeBps } from '../work-config';
import { csvRow } from '../work-payments.service';

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

describe('manual bank transfer (NEFT)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const setBank = () => {
    process.env.WORK_MANUAL_BANK_ACCOUNT_NAME = 'DEMO COMPANY PRIVATE LIMITED';
    process.env.WORK_MANUAL_BANK_ACCOUNT_NUMBER = '0001 1122 2333';
    process.env.WORK_MANUAL_BANK_IFSC = 'demo0001234';
    process.env.WORK_MANUAL_BANK_BANK_NAME = 'Demo Bank';
  };

  it('is selectable in production, but only with a complete company account', () => {
    process.env.NODE_ENV = 'production';
    process.env.WORK_PAYMENT_PROVIDER = 'manual_bank';
    expect(configuredWorkPaymentProvider()).toBe('none');
    setBank();
    expect(configuredWorkPaymentProvider()).toBe('manual_bank');
    expect(manualBankAccount()).toEqual({ accountName: 'DEMO COMPANY PRIVATE LIMITED', accountNumber: '000111222333', ifsc: 'DEMO0001234', bankName: 'Demo Bank' });
    process.env.WORK_MANUAL_BANK_IFSC = 'NOT-AN-IFSC';
    expect(configuredWorkPaymentProvider()).toBe('none');
  });

  it('is also selectable with only a valid company UPI ID', () => {
    process.env.NODE_ENV = 'production';
    process.env.WORK_PAYMENT_PROVIDER = 'manual_bank';
    delete process.env.WORK_MANUAL_BANK_ACCOUNT_NAME;
    process.env.WORK_MANUAL_UPI_ID = 'not a vpa';
    expect(configuredWorkPaymentProvider()).toBe('none');
    process.env.WORK_MANUAL_UPI_ID = 'demo.company@okdemo';
    expect(configuredWorkPaymentProvider()).toBe('manual_bank');
    expect(manualUpiAccount()).toEqual({ vpa: 'demo.company@okdemo', payeeName: 'FastQue' });
    process.env.WORK_MANUAL_UPI_NAME = 'Demo Company';
    expect(manualUpiAccount()?.payeeName).toBe('Demo Company');
    expect(manualBankAccount()).toBeNull();
  });

  it('issues bank-remark-safe references and accepts no webhook', async () => {
    const p = new ManualBankTransferWorkPaymentProvider();
    expect(p).toMatchObject({ name: 'manual_bank', sandbox: false, payoutMethod: 'BANK', manualSettlement: true });
    const { providerOrderId } = await p.createFundingOrder({ fundingId: '3f9a1c2b-7d4e-4a00-9b11-000000000000' });
    expect(providerOrderId).toBe('FQW3F9A1C2B7D4E');
    expect(() => p.verifyAndParseWebhook()).toThrow();
  });

  it('quotes CSV values and neutralises spreadsheet formulas', () => {
    expect(csvRow(['a"b', '=HYPERLINK("x")', '+1', '-2', '@x', 'plain'])).toBe('"a""b","\'=HYPERLINK(""x"")","\'+1","\'-2","\'@x","plain"');
  });
});
