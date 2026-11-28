import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  averageMoney,
  computeRunway,
  FINANCE_FOUNDER_CONTRIBUTOR_TYPES,
  FINANCE_EXPENSE_TYPE_LABEL,
  financeExpenseType,
  type FinanceBreakdownRowDto,
  type FinanceOverviewDto,
  type FinanceOverviewQuery,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  dateOnly,
  forbidden,
  indiaToday,
  isoDay,
  money,
  type FinanceActor,
} from './finance-access';
import { reimbursableOwed } from './finance-funding.service';
import { FinanceSetupService } from './finance-setup.service';

const ZERO = new Prisma.Decimal(0);
const RECOGNISED = ['APPROVED', 'PARTIALLY_PAID', 'PAID'] as const;
const PENDING = ['SUBMITTED', 'UNDER_REVIEW'] as const;
/** Months of history used for the average burn. */
const BURN_MONTHS = 3;

/** First day of the month `offset` months from `day` ("YYYY-MM-DD"). */
export function monthStart(day: string, offset = 0): string {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}
/** The same-length period that ends the day before `from` (both inclusive, "YYYY-MM-DD"). */
export function previousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const day = 86_400_000;
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  const length = Math.max(0, Math.round((end - start) / day));
  const prevTo = start - day;
  return {
    from: new Date(prevTo - length * day).toISOString().slice(0, 10),
    to: new Date(prevTo).toISOString().slice(0, 10),
  };
}
/** Last day of that month. */
export function monthEnd(day: string, offset = 0): string {
  const next = new Date(`${monthStart(day, offset + 1)}T00:00:00.000Z`);
  return new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function breakdown(
  map: Map<string, { label: string; amount: Prisma.Decimal; count: number }>,
): FinanceBreakdownRowDto[] {
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      amount: money(v.amount),
      count: v.count,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

function bump(
  map: Map<string, { label: string; amount: Prisma.Decimal; count: number }>,
  key: string,
  label: string,
  amount: Prisma.Decimal,
) {
  const row = map.get(key) ?? { label, amount: ZERO, count: 0 };
  row.amount = row.amount.plus(amount);
  row.count += 1;
  map.set(key, row);
}

/**
 * Finance overview. Every figure comes from recorded rows: expenses (incurred = approved, partially
 * paid or paid), payments, funding and reimbursement payouts. Cash is opening balances plus actual
 * company-account movements — never "contributions minus expenses". Revenue and budgets are not
 * connected yet and are returned as null rather than invented.
 */
@Injectable()
export class FinanceOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinanceSetupService,
  ) {}

  async overview(
    actor: FinanceActor,
    query: FinanceOverviewQuery,
    now = new Date(),
  ): Promise<FinanceOverviewDto> {
    if (!actor.viewCompany) throw forbidden();
    const today = indiaToday(now);
    const from = query.from ?? monthStart(today);
    const to = query.to ?? today;
    const range = { gte: dateOnly(from), lte: dateOnly(to) };

    const expenseFilter: Prisma.FinanceExpenseWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.city
        ? { city: { equals: query.city, mode: 'insensitive' } }
        : {}),
      ...(query.department
        ? { department: { equals: query.department, mode: 'insensitive' } }
        : {}),
      ...(query.contributorId
        ? {
            payments: {
              some: { contributorId: query.contributorId, voidedAt: null },
            },
          }
        : {}),
    };
    const recognised: Prisma.FinanceExpenseWhereInput = {
      ...expenseFilter,
      status: query.paymentStatus
        ? query.paymentStatus
        : { in: [...RECOGNISED] },
    };
    const prev = previousPeriod(from, to);
    const prevRange = { gte: dateOnly(prev.from), lte: dateOnly(prev.to) };
    const fundingFilter: Prisma.FinanceFundingWhereInput = {
      voidedAt: null,
      ...(query.contributorId ? { contributorId: query.contributorId } : {}),
    };
    const twelveMonthsAgo = monthStart(today, -11);

    const [
      recognisedAll,
      paidOnRecognised,
      approvedUnpaid,
      awaitingApproval,
      thisMonth,
      lastMonth,
      periodExpenses,
      fundingRows,
      personalPaid,
      reimbursablePayments,
      balances,
      companyPayments,
      payouts,
      monthlyIncurred,
      prevIncurred,
      vendorBills,
      pendingExpenseCount,
    ] = await Promise.all([
      this.prisma.financeExpense.aggregate({
        where: recognised,
        _sum: { amount: true },
      }),
      this.prisma.financeExpensePayment.aggregate({
        where: { voidedAt: null, expense: recognised },
        _sum: { amount: true },
      }),
      this.prisma.financeExpense.aggregate({
        where: { ...expenseFilter, status: 'APPROVED' },
        _sum: { amount: true },
      }),
      this.prisma.financeExpense.aggregate({
        where: { ...expenseFilter, status: { in: [...PENDING] } },
        _sum: { amount: true },
      }),
      this.prisma.financeExpense.aggregate({
        where: {
          ...recognised,
          expenseDate: {
            gte: dateOnly(monthStart(today)),
            lte: dateOnly(monthEnd(today)),
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.financeExpense.aggregate({
        where: {
          ...recognised,
          expenseDate: {
            gte: dateOnly(monthStart(today, -1)),
            lte: dateOnly(monthEnd(today, -1)),
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.financeExpense.findMany({
        where: { ...recognised, expenseDate: range },
        select: {
          amount: true,
          city: true,
          department: true,
          reimbursementRequired: true,
          category: { select: { id: true, name: true, department: true } },
          payments: {
            where: { voidedAt: null },
            select: {
              amount: true,
              contributor: { select: { id: true, name: true } },
              account: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.financeFunding.findMany({
        where: fundingFilter,
        select: {
          kind: true,
          amount: true,
          date: true,
          contributor: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.financeExpensePayment.aggregate({
        where: {
          voidedAt: null,
          payerType: 'PERSON',
          expense: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
          ...(query.contributorId
            ? { contributorId: query.contributorId }
            : {}),
        },
        _sum: { amount: true },
      }),
      this.prisma.financeExpensePayment.findMany({
        where: {
          voidedAt: null,
          payerType: 'PERSON',
          personalTreatment: 'REIMBURSABLE',
          expense: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
          ...(query.contributorId
            ? { contributorId: query.contributorId }
            : {}),
        },
        select: {
          amount: true,
          contributor: { select: { id: true, name: true } },
          reimbursements: {
            select: {
              status: true,
              amountRequested: true,
              amountApproved: true,
              payouts: { select: { amount: true, voidedAt: true } },
            },
          },
        },
      }),
      this.setup.accountBalances(),
      this.prisma.financeExpensePayment.findMany({
        where: {
          voidedAt: null,
          payerType: 'COMPANY_ACCOUNT',
          paidOn: { gte: dateOnly(twelveMonthsAgo) },
        },
        select: { amount: true, paidOn: true },
      }),
      this.prisma.financeReimbursementPayout.findMany({
        where: { voidedAt: null, paidOn: { gte: dateOnly(twelveMonthsAgo) } },
        select: { amount: true, paidOn: true },
      }),
      this.prisma.financeExpense.findMany({
        where: {
          ...recognised,
          expenseDate: { gte: dateOnly(twelveMonthsAgo) },
        },
        select: { amount: true, expenseDate: true },
      }),
      this.prisma.financeExpense.aggregate({
        where: { ...recognised, expenseDate: prevRange },
        _sum: { amount: true },
      }),
      this.prisma.financeExpense.findMany({
        where: {
          ...expenseFilter,
          vendorId: { not: null },
          status: { in: ['APPROVED', 'PARTIALLY_PAID'] },
        },
        select: {
          amount: true,
          vendor: { select: { id: true, name: true } },
          payments: { where: { voidedAt: null }, select: { amount: true } },
        },
      }),
      this.prisma.financeExpense.count({
        where: { ...expenseFilter, status: { in: [...PENDING] } },
      }),
    ]);

    // Funding (never revenue).
    let totalFunds = ZERO;
    let founderFunds = ZERO;
    let periodFunding = ZERO;
    const byContributor = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    for (const f of fundingRows) {
      if (f.kind !== 'CONTRIBUTION') continue;
      totalFunds = totalFunds.plus(f.amount);
      if (FINANCE_FOUNDER_CONTRIBUTOR_TYPES.includes(f.contributor.type))
        founderFunds = founderFunds.plus(f.amount);
      const day = isoDay(f.date);
      if (day >= from && day <= to)
        periodFunding = periodFunding.plus(f.amount);
      bump(byContributor, f.contributor.id, f.contributor.name, f.amount);
    }

    // Period breakdowns of incurred expenses.
    const byCategory = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    const byType = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    const byCity = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    const byDepartment = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    const byPaidBy = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    let periodIncurred = ZERO;
    for (const e of periodExpenses) {
      periodIncurred = periodIncurred.plus(e.amount);
      bump(byCategory, e.category.id, e.category.name, e.amount);
      const type = financeExpenseType(e);
      bump(byType, type, FINANCE_EXPENSE_TYPE_LABEL[type], e.amount);
      bump(
        byCity,
        (e.city ?? '').toLowerCase() || 'unassigned',
        e.city ?? 'Not assigned',
        e.amount,
      );
      const dept = e.department ?? e.category.department;
      bump(
        byDepartment,
        (dept ?? '').toLowerCase() || 'unassigned',
        dept ?? 'Not assigned',
        e.amount,
      );
      for (const p of e.payments) {
        if (p.contributor)
          bump(
            byPaidBy,
            `person:${p.contributor.id}`,
            p.contributor.name,
            p.amount,
          );
        else if (p.account)
          bump(
            byPaidBy,
            `account:${p.account.id}`,
            `Company · ${p.account.name}`,
            p.amount,
          );
      }
    }

    // Reimbursements owed (approved or unclaimed) and awaiting review.
    let owed = ZERO;
    let awaiting = ZERO;
    const owedByPerson = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    let claimsInReview = 0;
    let claimsApprovedUnpaid = 0;
    for (const p of reimbursablePayments) {
      for (const c of p.reimbursements) {
        if (c.status === 'SUBMITTED' || c.status === 'UNDER_REVIEW')
          claimsInReview += 1;
        else if (c.status === 'APPROVED' || c.status === 'PARTIALLY_REIMBURSED')
          claimsApprovedUnpaid += 1;
      }
      const r = reimbursableOwed(p);
      owed = owed.plus(r.owed);
      awaiting = awaiting.plus(r.awaitingReview);
      const total = r.owed.plus(r.awaitingReview);
      if (!total.isZero() && p.contributor)
        bump(owedByPerson, p.contributor.id, p.contributor.name, total);
    }

    // Cash (actual company accounts).
    const cash = [...balances.values()].reduce((t, v) => t.plus(v), ZERO);

    // Monthly series + burn from company cash out (operating: expense payments + reimbursement payouts).
    const months: string[] = Array.from({ length: 12 }, (_, i) =>
      monthStart(today, i - 11).slice(0, 7),
    );
    const series = new Map(
      months.map((m) => [
        m,
        { incurred: ZERO, cashOut: ZERO, fundingIn: ZERO, repaid: ZERO },
      ]),
    );
    for (const e of monthlyIncurred) {
      const row = series.get(isoDay(e.expenseDate).slice(0, 7));
      if (row) row.incurred = row.incurred.plus(e.amount);
    }
    for (const p of [...companyPayments, ...payouts]) {
      const row = series.get(isoDay(p.paidOn).slice(0, 7));
      if (row) row.cashOut = row.cashOut.plus(p.amount);
    }
    for (const f of fundingRows) {
      const row = series.get(isoDay(f.date).slice(0, 7));
      if (!row) continue;
      if (f.kind === 'CONTRIBUTION')
        row.fundingIn = row.fundingIn.plus(f.amount);
      else row.repaid = row.repaid.plus(f.amount);
    }
    // Burn: the last complete months that have any recorded activity, at most BURN_MONTHS.
    const earliest = await this.earliestActivity();
    const completeMonths = months
      .slice(0, -1)
      .filter((m) => earliest !== null && m >= earliest.slice(0, 7));
    const burnMonths = completeMonths.slice(-BURN_MONTHS);
    const grossBurns = burnMonths.map((m) => money(series.get(m)!.cashOut));
    const averageGrossBurn = averageMoney(grossBurns);
    // No revenue is connected yet, so net burn equals gross burn (stated in the UI).
    const averageNetBurn = averageGrossBurn;

    // Period net cash flow: funding in − repayments − company payments − payouts, by transaction date.
    const flows = async (start: string, end: string) => {
      const r = { gte: dateOnly(start), lte: dateOnly(end) };
      const inR = (d: Date) => {
        const day = isoDay(d);
        return day >= start && day <= end;
      };
      const [companyPaid, paidOut] = await Promise.all([
        this.prisma.financeExpensePayment.aggregate({
          where: { voidedAt: null, payerType: 'COMPANY_ACCOUNT', paidOn: r },
          _sum: { amount: true },
        }),
        this.prisma.financeReimbursementPayout.aggregate({
          where: { voidedAt: null, paidOn: r },
          _sum: { amount: true },
        }),
      ]);
      let fundingIn = ZERO;
      let repaid = ZERO;
      for (const f of fundingRows) {
        if (!inR(f.date)) continue;
        if (f.kind === 'CONTRIBUTION') fundingIn = fundingIn.plus(f.amount);
        else repaid = repaid.plus(f.amount);
      }
      const cashOut = repaid
        .plus(companyPaid._sum.amount ?? ZERO)
        .plus(paidOut._sum.amount ?? ZERO);
      return { fundingIn, cashOut, net: fundingIn.minus(cashOut) };
    };
    const [current, before] = await Promise.all([
      flows(from, to),
      flows(prev.from, prev.to),
    ]);
    const periodNet = current.net;

    // Vendor payables: approved expenses with a vendor, less payments recorded against them.
    let vendorPayables = ZERO;
    let vendorBillsUnpaid = 0;
    const byVendor = new Map<
      string,
      { label: string; amount: Prisma.Decimal; count: number }
    >();
    for (const e of vendorBills) {
      const paidSoFar = e.payments.reduce((t, p) => t.plus(p.amount), ZERO);
      const due = Prisma.Decimal.max(e.amount.minus(paidSoFar), 0);
      if (due.isZero() || !e.vendor) continue;
      vendorPayables = vendorPayables.plus(due);
      vendorBillsUnpaid += 1;
      bump(byVendor, e.vendor.id, e.vendor.name, due);
    }

    const incurred = recognisedAll._sum.amount ?? ZERO;
    const paid = paidOnRecognised._sum.amount ?? ZERO;
    const unpaid = Prisma.Decimal.max(incurred.minus(paid), 0);

    return {
      period: { from, to },
      generatedAt: now.toISOString(),
      kpis: {
        totalFundsContributed: money(totalFunds),
        founderContributions: money(founderFunds),
        otherFunding: money(totalFunds.minus(founderFunds)),
        paidPersonallyOnBehalf: money(personalPaid._sum.amount),
        totalExpensesIncurred: money(incurred),
        totalExpensesPaid: money(paid),
        unpaidLiabilities: money(unpaid),
        expensesThisMonth: money(thisMonth._sum.amount),
        expensesLastMonth: money(lastMonth._sum.amount),
        periodExpensesIncurred: money(periodIncurred),
        periodFundingReceived: money(periodFunding),
        availableCash: money(cash),
        averageGrossBurn,
        averageNetBurn,
        burnMonthsUsed: burnMonths.length,
        runway: computeRunway(money(cash), averageNetBurn),
        pendingReimbursements: money(owed),
        reimbursementsAwaitingReview: money(awaiting),
        outstandingPayables: money(unpaid.plus(owed)),
        approvedUnpaidExpenses: money(approvedUnpaid._sum.amount),
        expensesAwaitingApproval: money(awaitingApproval._sum.amount),
        periodNetCashFlow: money(periodNet),
        periodCashOut: money(current.cashOut),
        vendorPayables: money(vendorPayables),
        vendorBillsUnpaid,
        accountCount: balances.size,
        revenueReceived: null,
        budgetUtilizationPercent: null,
      },
      byCategory: breakdown(byCategory),
      byType: breakdown(byType),
      byCity: breakdown(byCity),
      byDepartment: breakdown(byDepartment),
      byPaidBy: breakdown(byPaidBy),
      byContributorFunding: breakdown(byContributor),
      monthly: months.map((m) => {
        const row = series.get(m)!;
        return {
          month: m,
          incurred: money(row.incurred),
          companyCashOut: money(row.cashOut),
          fundingIn: money(row.fundingIn),
          repaymentsOut: money(row.repaid),
        };
      }),
      reimbursementsOwedByPerson: breakdown(owedByPerson),
      vendorPayablesByVendor: breakdown(byVendor),
      previous: {
        ...prev,
        fundingReceived: money(before.fundingIn),
        expensesIncurred: money(prevIncurred._sum.amount),
        cashOut: money(before.cashOut),
        netCashFlow: money(before.net),
      },
      pending: {
        expensesAwaitingApproval: pendingExpenseCount,
        reimbursementsAwaitingReview: claimsInReview,
        reimbursementsApprovedUnpaid: claimsApprovedUnpaid,
      },
    };
  }

  /** Date of the first recorded money movement (opening balance, funding, payment), or null. */
  private async earliestActivity(): Promise<string | null> {
    const [account, funding, payment] = await Promise.all([
      this.prisma.financeAccount.findFirst({
        orderBy: { openingBalanceDate: 'asc' },
        select: { openingBalanceDate: true },
      }),
      this.prisma.financeFunding.findFirst({
        where: { voidedAt: null },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.financeExpensePayment.findFirst({
        where: { voidedAt: null },
        orderBy: { paidOn: 'asc' },
        select: { paidOn: true },
      }),
    ]);
    const days = [account?.openingBalanceDate, funding?.date, payment?.paidOn]
      .filter((d): d is Date => !!d)
      .map(isoDay)
      .sort();
    return days[0] ?? null;
  }
}
