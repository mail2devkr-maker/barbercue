import { grantPromotionalCreditsSchema } from '../schemas';
import { CreditFundingSource } from '../enums';

describe('grantPromotionalCreditsSchema', () => {
  const valid = {
    customerId: '11111111-1111-1111-1111-111111111111',
    amount: 100,
    reason: 'Launch promo',
  };

  it('accepts a minimal valid grant (fundingSource defaults to FASTQUE_FUNDED)', () => {
    const result = grantPromotionalCreditsSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fundingSource).toBe(CreditFundingSource.FASTQUE_FUNDED);
    }
  });

  it('accepts optional campaignRef, fundingSource, and a future expiresAt', () => {
    const result = grantPromotionalCreditsSchema.safeParse({
      ...valid,
      campaignRef: 'WELCOME50',
      fundingSource: CreditFundingSource.SHOP_FUNDED,
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing reason', () => {
    const { reason: _reason, ...rest } = valid;
    expect(grantPromotionalCreditsSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty-string reason', () => {
    expect(grantPromotionalCreditsSchema.safeParse({ ...valid, reason: '   ' }).success).toBe(false);
  });

  it('rejects a non-UUID customerId', () => {
    expect(
      grantPromotionalCreditsSchema.safeParse({ ...valid, customerId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects a zero or negative amount', () => {
    expect(grantPromotionalCreditsSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(grantPromotionalCreditsSchema.safeParse({ ...valid, amount: -10 }).success).toBe(false);
  });

  it('rejects an invalid fundingSource', () => {
    expect(
      grantPromotionalCreditsSchema.safeParse({ ...valid, fundingSource: 'CASH' }).success,
    ).toBe(false);
  });

  // Part 11 (FastQue Credits precision audit) — amount must reject anything with more than 2
  // fractional digits, tested against the actual schema.
  describe('amount precision', () => {
    it.each([0.01, 0.1, 1.1, 10.01, 99.99, 100, 999.99])(
      'accepts Rs.%s (at most 2 decimal places)',
      (amount) => {
        expect(grantPromotionalCreditsSchema.safeParse({ ...valid, amount }).success).toBe(true);
      },
    );

    it.each([10.001, 10.999, 0.001, 99.999])(
      'rejects Rs.%s (more than 2 decimal places)',
      (amount) => {
        expect(grantPromotionalCreditsSchema.safeParse({ ...valid, amount }).success).toBe(false);
      },
    );
  });
});
