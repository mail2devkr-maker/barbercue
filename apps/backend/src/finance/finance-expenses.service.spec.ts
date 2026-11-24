import { Prisma } from '@prisma/client';
import type { FinanceExpenseInput } from '@barbercue/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { FinanceActor } from './finance-access';
import {
  FinanceExpensesService,
  createdAsReimbursement,
} from './finance-expenses.service';
import type { FinanceSetupService } from './finance-setup.service';

const D = (v: string | number) => new Prisma.Decimal(v);

const manager: FinanceActor = {
  userId: 'u-admin',
  isPlatformAdmin: false,
  viewCompany: true,
  manage: true,
  approve: true,
  configure: false,
  bankDetails: false,
};
const staff: FinanceActor = {
  userId: 'u-hr',
  isPlatformAdmin: false,
  viewCompany: false,
  manage: false,
  approve: false,
  configure: false,
  bankDetails: false,
};

const base = {
  expenseDate: '2026-11-18',
  categoryId: '11111111-1111-4111-8111-111111111111',
  description: 'Team lunch with salon partners',
  amount: '1200.00',
  taxAmount: '0.00',
  isRecurring: false,
  reimbursementRequired: false,
} as FinanceExpenseInput;

function payment(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    expenseId: 'e1',
    amount: D('1200'),
    paidOn: new Date('2026-11-18'),
    payerType: 'PERSON',
    accountId: null,
    account: null,
    contributorId: 'c-hr',
    contributor: { id: 'c-hr', name: 'HR person', userId: 'u-hr' },
    personalTreatment: 'REIMBURSABLE',
    method: 'OTHER',
    reference: null,
    voidedAt: null,
    voidReason: null,
    voidedByUserId: null,
    createdByUserId: 'u-hr',
    clientRequestId: null,
    createdAt: new Date(),
    reimbursements: [] as Array<{ id: string }>,
    ...over,
  };
}

function expense(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    number: 'EXP-000001',
    expenseDate: new Date('2026-11-18T00:00:00.000Z'),
    categoryId: base.categoryId,
    category: { id: base.categoryId, name: 'Human Resources' },
    subcategoryId: null,
    subcategory: null,
    customSubcategory: null,
    description: base.description,
    amount: D('1200'),
    taxAmount: D('0'),
    currency: 'INR',
    vendorId: null,
    vendor: null,
    department: null,
    city: null,
    project: null,
    reimbursementRequired: true,
    isRecurring: false,
    notes: null,
    status: 'SUBMITTED',
    createdByUserId: 'u-hr',
    submittedAt: new Date(),
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    cancelledAt: null,
    clientRequestId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    payments: [payment()],
    _count: { attachments: 0 },
    ...over,
  };
}

function setup(row: ReturnType<typeof expense>) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    financeExpense: {
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...row, ...data }),
      ),
    },
    financeAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    financeReimbursementPayout: { count: jest.fn().mockResolvedValue(0) },
    financeReimbursement: {
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'r-new', amountRequested: D('1200') }),
    },
    financeExpensePayment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
  };
  const prisma = {
    financeExpense: { findFirst: jest.fn().mockResolvedValue(row) },
    financeCategory: {
      findUnique: jest.fn().mockResolvedValue({
        id: base.categoryId,
        parentId: null,
        isActive: true,
      }),
    },
    financeContributor: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c-hr' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'c-hr' }),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const service = new FinanceExpensesService(
    prisma as unknown as PrismaService,
    {} as FinanceSetupService,
  );
  return { service, tx };
}

describe('createdAsReimbursement', () => {
  it('saves a new expense as a company expense unless it was paid personally to be paid back', () => {
    expect(createdAsReimbursement(base)).toBe(false);
    expect(createdAsReimbursement({ ...base, paidByMe: true })).toBe(true);
    expect(
      createdAsReimbursement({
        ...base,
        paidBy: {
          payerType: 'PERSON',
          contributorId: 'c',
          personalTreatment: 'REIMBURSABLE',
          method: 'UPI',
        },
      }),
    ).toBe(true);
    expect(
      createdAsReimbursement({
        ...base,
        paidBy: {
          payerType: 'PERSON',
          contributorId: 'c',
          personalTreatment: 'FOUNDER_LOAN',
          method: 'UPI',
        },
      }),
    ).toBe(false);
    // A company-account payment is never a claim, even if the flag is sent.
    expect(
      createdAsReimbursement({
        ...base,
        reimbursementRequired: true,
        paidBy: { payerType: 'COMPANY_ACCOUNT', accountId: 'a', method: 'UPI' },
      }),
    ).toBe(false);
  });
});

describe('FinanceExpensesService.update — expense type', () => {
  it('turns a mis-recorded claim into a company expense: new category, claim cancelled, personal payment voided', async () => {
    const row = expense({
      payments: [payment({ reimbursements: [{ id: 'r1' }] })],
    });
    const { service, tx } = setup(row);
    const otherCategory = '22222222-2222-4222-8222-222222222222';
    await service.update(staff, 'e1', {
      ...base,
      categoryId: otherCategory,
      reimbursementRequired: false,
    });
    expect(tx.financeExpense.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({
        categoryId: otherCategory,
        reimbursementRequired: false,
      }),
    });
    expect(tx.financeReimbursement.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'CANCELLED' },
    });
    expect(tx.financeExpensePayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', voidedAt: null } }),
    );
  });

  it('refuses to un-claim an expense that has already been reimbursed', async () => {
    const { service, tx } = setup(
      expense({ payments: [payment({ reimbursements: [{ id: 'r1' }] })] }),
    );
    tx.financeReimbursementPayout.count.mockResolvedValue(1);
    await expect(
      service.update(manager, 'e1', { ...base, reimbursementRequired: false }),
    ).rejects.toThrow(/already been reimbursed/);
  });

  it('keeps a company-paid expense from becoming a claim', async () => {
    const { service } = setup(
      expense({
        reimbursementRequired: false,
        payments: [
          payment({
            payerType: 'COMPANY_ACCOUNT',
            contributorId: null,
            contributor: null,
            personalTreatment: null,
            accountId: 'a1',
          }),
        ],
      }),
    );
    await expect(
      service.update(manager, 'e1', { ...base, reimbursementRequired: true }),
    ).rejects.toThrow(/own money/);
  });

  it('opens the claim when a submitted personal payment is changed to a reimbursement claim', async () => {
    const { service, tx } = setup(expense({ reimbursementRequired: false }));
    await service.update(manager, 'e1', {
      ...base,
      reimbursementRequired: true,
    });
    expect(tx.financeReimbursement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expensePaymentId: 'p1',
        contributorId: 'c-hr',
      }),
    });
  });

  it('lets a finance manager reclassify an approved expense but not change its money', async () => {
    const row = expense({
      status: 'PAID',
      reimbursementRequired: false,
      payments: [],
    });
    const { service, tx } = setup(row);
    const otherCategory = '22222222-2222-4222-8222-222222222222';
    await service.update(manager, 'e1', { ...base, categoryId: otherCategory });
    expect(tx.financeExpense.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ categoryId: otherCategory }),
    });
    await expect(
      service.update(manager, 'e1', { ...base, amount: '999.00' }),
    ).rejects.toThrow(/already approved/);
    // Staff cannot touch an approved expense at all.
    await expect(
      service.update(staff, 'e1', { ...base, categoryId: otherCategory }),
    ).rejects.toThrow(/can no longer be edited/);
  });
});
