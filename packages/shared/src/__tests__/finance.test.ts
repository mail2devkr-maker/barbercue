import { Role } from '../enums';
import {
  FINANCE_CONTRIBUTOR_TYPE_LABEL,
  FINANCE_DEFAULT_CATEGORIES,
  FINANCE_FOUNDER_CONTRIBUTOR_TYPES,
  FinanceContributorType,
  financeContributorSchema,
  financeOverviewQuerySchema,
  averageMoney,
  computeRunway,
  expenseStatusAfterPayments,
  financeExpenseInputSchema,
  financeExpensePaymentSchema,
  financeFromPaise,
  financeMoneySchema,
  financeToPaise,
  formatInr,
  hasFinancePermission,
  normalizeFinanceName,
  reimbursementStatusAfterPayouts,
  sumMoney,
} from '../finance';

describe('finance money (exact)', () => {
  it('converts rupees to paise and back without floating-point error', () => {
    expect(financeToPaise('0.1')).toBe(10);
    expect(financeToPaise('1234.56')).toBe(123456);
    expect(financeFromPaise(123456)).toBe('1234.56');
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30'); // 0.1 + 0.2 !== 0.3 in floats
    expect(sumMoney(['999999.99', '0.01'])).toBe('1000000.00');
  });

  it('rejects malformed, negative or over-precise amounts', () => {
    for (const bad of ['-1', '1.234', 'abc', '1e5', '']) expect(() => financeToPaise(bad)).toThrow();
    expect(financeMoneySchema.safeParse('0').success).toBe(false);
    expect(financeMoneySchema.safeParse('10.5').success && financeMoneySchema.parse('10.5')).toBe('10.50');
  });

  it('formats INR with Indian digit grouping', () => {
    expect(formatInr('1234567.5')).toBe('₹12,34,567.50');
    expect(formatInr('100')).toBe('₹100');
  });
});

describe('finance contributors', () => {
  it('accepts a co-founder contributor and labels every type', () => {
    expect(financeContributorSchema.safeParse({ name: 'Asha', type: 'CO_FOUNDER' }).success).toBe(true);
    expect(financeContributorSchema.safeParse({ name: 'Asha', type: 'COFOUNDER' }).success).toBe(false);
    expect(FINANCE_CONTRIBUTOR_TYPE_LABEL.CO_FOUNDER).toBe('Co-founder');
    for (const t of Object.values(FinanceContributorType)) expect(FINANCE_CONTRIBUTOR_TYPE_LABEL[t]).toBeTruthy();
    expect(FINANCE_FOUNDER_CONTRIBUTOR_TYPES).toEqual(expect.arrayContaining(['FOUNDER', 'CO_FOUNDER', 'DIRECTOR']));
  });

  it('only filters the overview by recognised payment states', () => {
    expect(financeOverviewQuerySchema.safeParse({ paymentStatus: 'PAID' }).success).toBe(true);
    expect(financeOverviewQuerySchema.safeParse({ paymentStatus: 'DRAFT' }).success).toBe(false);
  });
});

describe('finance rules', () => {
  it('never marks an expense paid on approval alone', () => {
    expect(expenseStatusAfterPayments('APPROVED', '5000.00', '0.00')).toBe('APPROVED');
    expect(expenseStatusAfterPayments('APPROVED', '5000.00', '3000.00')).toBe('PARTIALLY_PAID');
    expect(expenseStatusAfterPayments('PARTIALLY_PAID', '5000.00', '5000.00')).toBe('PAID');
    expect(expenseStatusAfterPayments('PAID', '5000.00', '3000.00')).toBe('PARTIALLY_PAID'); // after a void
    // Payments before a decision do not change a pending status.
    expect(expenseStatusAfterPayments('SUBMITTED', '5000.00', '5000.00')).toBe('SUBMITTED');
  });

  it('tracks partial and full reimbursement', () => {
    expect(reimbursementStatusAfterPayouts('APPROVED', '1000.00', '400.00')).toBe('PARTIALLY_REIMBURSED');
    expect(reimbursementStatusAfterPayouts('PARTIALLY_REIMBURSED', '1000.00', '1000.00')).toBe('FULLY_REIMBURSED');
    expect(reimbursementStatusAfterPayouts('FULLY_REIMBURSED', '1000.00', '0.00')).toBe('APPROVED');
    expect(reimbursementStatusAfterPayouts('SUBMITTED', null, '0.00')).toBe('SUBMITTED');
  });

  it('reports runway honestly when there is no burn or no history', () => {
    expect(computeRunway('120000.00', '20000.00')).toEqual({ kind: 'MONTHS', months: 6 });
    expect(computeRunway('100000.00', '30000.00')).toEqual({ kind: 'MONTHS', months: 3.3 });
    expect(computeRunway('100000.00', '0.00')).toEqual({ kind: 'NOT_BURNING' });
    expect(computeRunway('100000.00', '-500.00')).toEqual({ kind: 'NOT_BURNING' });
    expect(computeRunway('0.00', '500.00')).toEqual({ kind: 'NO_CASH' });
    expect(computeRunway('100000.00', null)).toEqual({ kind: 'INSUFFICIENT_DATA' });
    expect(averageMoney(['100.00', '200.01'])).toBe('150.01');
    expect(averageMoney([])).toBeNull();
  });

  it('requires a payer and a treatment for personal payments', () => {
    const base = { amount: '100', paidOn: '2026-11-01', method: 'UPI' };
    expect(financeExpensePaymentSchema.safeParse({ ...base, payerType: 'COMPANY_ACCOUNT' }).success).toBe(false);
    expect(financeExpensePaymentSchema.safeParse({ ...base, payerType: 'PERSON', contributorId: '7d0f7d0f-7d0f-4d0f-8d0f-7d0f7d0f7d0f' }).success).toBe(false);
    expect(
      financeExpensePaymentSchema.safeParse({ ...base, payerType: 'PERSON', contributorId: '7d0f7d0f-7d0f-4d0f-8d0f-7d0f7d0f7d0f', personalTreatment: 'REIMBURSABLE' }).success,
    ).toBe(true);
  });

  it('does not allow tax greater than the amount', () => {
    const r = financeExpenseInputSchema.safeParse({
      expenseDate: '2026-11-01',
      categoryId: '7d0f7d0f-7d0f-4d0f-8d0f-7d0f7d0f7d0f',
      description: 'Hosting',
      amount: '100',
      taxAmount: '150',
    });
    expect(r.success).toBe(false);
  });

  it('keeps company-wide finance away from ordinary admin roles', () => {
    expect(hasFinancePermission([Role.PLATFORM_ADMIN], 'configureFinance')).toBe(true);
    expect(hasFinancePermission([Role.CO_FOUNDER], 'viewCompanyFinance')).toBe(true);
    expect(hasFinancePermission([Role.CO_FOUNDER], 'viewBankDetails')).toBe(false);
    for (const role of [Role.HR_ADMIN, Role.SALES_ADMIN, Role.PLATFORM_VIEWER]) {
      expect(hasFinancePermission([role], 'viewCompanyFinance')).toBe(false);
      expect(hasFinancePermission([role], 'submitOwnClaims')).toBe(true);
    }
    expect(hasFinancePermission([Role.FIELD_EXECUTIVE], 'submitOwnClaims')).toBe(false);
  });

  it('ships the FastQue category list without duplicate names', () => {
    expect(FINANCE_DEFAULT_CATEGORIES).toHaveLength(10);
    const mains = FINANCE_DEFAULT_CATEGORIES.map((c) => normalizeFinanceName(c.name));
    expect(new Set(mains).size).toBe(mains.length);
    for (const c of FINANCE_DEFAULT_CATEGORIES) {
      const subs = c.subcategories.map(normalizeFinanceName);
      expect(new Set(subs).size).toBe(subs.length);
    }
  });
});
