import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FinanceErrorCode,
  normalizeFinanceName,
  type FinanceAccountDto,
  type FinanceAccountInput,
  type FinanceCategoryCreateInput,
  type FinanceCategoryDto,
  type FinanceCategoryUpdateInput,
  type FinanceContributorDto,
  type FinanceContributorInput,
  type FinanceMeDto,
  type FinanceVendorDto,
  type FinanceVendorInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { recordFinanceAudit } from './finance-audit';
import {
  dateOnly,
  forbidden,
  invalid,
  isUniqueViolation,
  isoDay,
  money,
  notFound,
  type FinanceActor,
} from './finance-access';

type Tx = Prisma.TransactionClient;

const contributorInclude = {
  user: { select: { email: true } },
} satisfies Prisma.FinanceContributorInclude;

type ContributorRow = Prisma.FinanceContributorGetPayload<{
  include: typeof contributorInclude;
}>;

export function toContributorDto(c: ContributorRow): FinanceContributorDto {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    userId: c.userId,
    userEmail: c.user?.email ?? null,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    isActive: c.isActive,
  };
}

/**
 * Finance set-up data: categories, contributors, company accounts and vendors. Company-wide lists
 * are for finance viewers; categories are readable by everyone who may file a claim.
 */
@Injectable()
export class FinanceSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async me(actor: FinanceActor): Promise<FinanceMeDto> {
    const own = await this.prisma.financeContributor.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    return {
      roles: {
        viewCompany: actor.viewCompany,
        manage: actor.manage,
        approve: actor.approve,
        configure: actor.configure,
        bankDetails: actor.bankDetails,
      },
      contributorId: own?.id ?? null,
    };
  }

  // ------------------------------------------------------------ categories

  async categories(): Promise<FinanceCategoryDto[]> {
    const mains = await this.prisma.financeCategory.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        subcategories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      },
    });
    return mains.map((m) => ({
      id: m.id,
      name: m.name,
      department: m.department,
      isSystem: m.isSystem,
      isActive: m.isActive,
      subcategories: m.subcategories.map((s) => ({
        id: s.id,
        name: s.name,
        isSystem: s.isSystem,
        isActive: s.isActive,
      })),
    }));
  }

  /** Main categories need configureFinance; custom subcategories only manageFinance. */
  async createCategory(actor: FinanceActor, input: FinanceCategoryCreateInput) {
    if (input.parentId ? !actor.manage : !actor.configure) throw forbidden();
    if (input.parentId) {
      const parent = await this.prisma.financeCategory.findUnique({
        where: { id: input.parentId },
      });
      if (!parent || parent.parentId) throw notFound('That main category');
    }
    const sortOrder = await this.prisma.financeCategory.count({
      where: { parentId: input.parentId ?? null },
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeCategory.create({
          data: {
            name: input.name,
            normalizedName: normalizeFinanceName(input.name),
            parentId: input.parentId ?? null,
            department: input.department ?? null,
            sortOrder,
            createdByUserId: actor.userId,
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'CATEGORY',
          entityId: row.id,
          action: 'CREATED',
          actorUserId: actor.userId,
          after: { name: row.name, parentId: row.parentId },
        });
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw invalid('A category with that name already exists here.');
      throw error;
    }
  }

  async updateCategory(
    actor: FinanceActor,
    id: string,
    input: FinanceCategoryUpdateInput,
  ) {
    if (!actor.configure) throw forbidden();
    const before = await this.prisma.financeCategory.findUnique({
      where: { id },
    });
    if (!before) throw notFound('That category');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeCategory.update({
          where: { id },
          data: {
            ...(input.name !== undefined
              ? {
                  name: input.name,
                  normalizedName: normalizeFinanceName(input.name),
                }
              : {}),
            ...(input.department !== undefined
              ? { department: input.department }
              : {}),
            ...(input.isActive !== undefined
              ? { isActive: input.isActive }
              : {}),
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'CATEGORY',
          entityId: id,
          action: 'UPDATED',
          actorUserId: actor.userId,
          before: {
            name: before.name,
            department: before.department,
            isActive: before.isActive,
          },
          after: {
            name: row.name,
            department: row.department,
            isActive: row.isActive,
          },
        });
        return { id };
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw invalid('A category with that name already exists here.');
      throw error;
    }
  }

  // ------------------------------------------------------------ contributors

  async contributors(actor: FinanceActor): Promise<FinanceContributorDto[]> {
    const rows = await this.prisma.financeContributor.findMany({
      where: actor.viewCompany ? {} : { userId: actor.userId },
      include: contributorInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toContributorDto);
  }

  private async userIdForEmail(
    email: string | undefined,
  ): Promise<string | null> {
    if (!email) return null;
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!user)
      throw invalid(
        'No FastQue user has that email. Leave it empty for someone who is not a platform user.',
      );
    return user.id;
  }

  async createContributor(actor: FinanceActor, input: FinanceContributorInput) {
    if (!actor.manage) throw forbidden();
    const userId = await this.userIdForEmail(input.userEmail);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeContributor.create({
          data: {
            name: input.name,
            type: input.type,
            userId,
            email: input.email ?? null,
            phone: input.phone ?? null,
            notes: input.notes ?? null,
            isActive: input.isActive ?? true,
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'CONTRIBUTOR',
          entityId: row.id,
          action: 'CREATED',
          actorUserId: actor.userId,
          after: { name: row.name, type: row.type, userId },
        });
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'userId'))
        throw invalid(
          'That FastQue user is already linked to another contributor.',
        );
      throw error;
    }
  }

  async updateContributor(
    actor: FinanceActor,
    id: string,
    input: FinanceContributorInput,
  ) {
    if (!actor.manage) throw forbidden();
    const before = await this.prisma.financeContributor.findUnique({
      where: { id },
    });
    if (!before) throw notFound('That contributor');
    const userId = await this.userIdForEmail(input.userEmail);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeContributor.update({
          where: { id },
          data: {
            name: input.name,
            type: input.type,
            userId,
            email: input.email ?? null,
            phone: input.phone ?? null,
            notes: input.notes ?? null,
            ...(input.isActive !== undefined
              ? { isActive: input.isActive }
              : {}),
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'CONTRIBUTOR',
          entityId: id,
          action: 'UPDATED',
          actorUserId: actor.userId,
          before: {
            name: before.name,
            type: before.type,
            userId: before.userId,
            isActive: before.isActive,
          },
          after: {
            name: row.name,
            type: row.type,
            userId: row.userId,
            isActive: row.isActive,
          },
        });
        return { id };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'userId'))
        throw invalid(
          'That FastQue user is already linked to another contributor.',
        );
      throw error;
    }
  }

  /**
   * The caller's own contributor record, created on first use (as an EMPLOYEE) so a staff member
   * can claim what they paid without a duplicate record ever existing for the same user.
   */
  async ensureOwnContributor(tx: Tx, userId: string): Promise<string> {
    const existing = await tx.financeContributor.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) return existing.id;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        employeeProfile: { select: { fullName: true } },
      },
    });
    const name =
      user?.employeeProfile?.fullName ??
      user?.email ??
      user?.phone ??
      'FastQue team member';
    const row = await tx.financeContributor.create({
      data: { name, type: 'EMPLOYEE', userId, email: user?.email ?? null },
    });
    await recordFinanceAudit(tx, {
      entityType: 'CONTRIBUTOR',
      entityId: row.id,
      action: 'CREATED_FOR_OWN_CLAIM',
      actorUserId: userId,
      after: { name, type: 'EMPLOYEE', userId },
    });
    return row.id;
  }

  // ------------------------------------------------------------ company accounts

  async accounts(actor: FinanceActor): Promise<FinanceAccountDto[]> {
    if (!actor.viewCompany) throw forbidden();
    const rows = await this.prisma.financeAccount.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const balances = await this.accountBalances();
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      institution: a.institution,
      accountLast4: actor.bankDetails ? a.accountLast4 : null,
      openingBalance: money(a.openingBalance),
      openingBalanceDate: isoDay(a.openingBalanceDate),
      balance: money(balances.get(a.id) ?? a.openingBalance),
      isActive: a.isActive,
    }));
  }

  /** Actual cash per account: opening balance + funding in − repayments − payments − payouts (active rows only). */
  async accountBalances(): Promise<Map<string, Prisma.Decimal>> {
    const [accounts, fundingIn, repaid, paid, payouts] = await Promise.all([
      this.prisma.financeAccount.findMany({
        select: { id: true, openingBalance: true },
      }),
      this.prisma.financeFunding.groupBy({
        by: ['accountId'],
        where: { voidedAt: null, kind: 'CONTRIBUTION' },
        _sum: { amount: true },
      }),
      this.prisma.financeFunding.groupBy({
        by: ['accountId'],
        where: { voidedAt: null, kind: 'REPAYMENT' },
        _sum: { amount: true },
      }),
      this.prisma.financeExpensePayment.groupBy({
        by: ['accountId'],
        where: { voidedAt: null, payerType: 'COMPANY_ACCOUNT' },
        _sum: { amount: true },
      }),
      this.prisma.financeReimbursementPayout.groupBy({
        by: ['accountId'],
        where: { voidedAt: null },
        _sum: { amount: true },
      }),
    ]);
    const result = new Map<string, Prisma.Decimal>();
    for (const a of accounts) result.set(a.id, a.openingBalance);
    const add = (id: string | null, v: Prisma.Decimal | null, sign: 1 | -1) => {
      if (!id || !v) return;
      const current = result.get(id) ?? new Prisma.Decimal(0);
      result.set(id, sign === 1 ? current.plus(v) : current.minus(v));
    };
    fundingIn.forEach((r) => add(r.accountId, r._sum.amount, 1));
    repaid.forEach((r) => add(r.accountId, r._sum.amount, -1));
    paid.forEach((r) => add(r.accountId, r._sum.amount, -1));
    payouts.forEach((r) => add(r.accountId, r._sum.amount, -1));
    return result;
  }

  async saveAccount(
    actor: FinanceActor,
    id: string | null,
    input: FinanceAccountInput,
  ) {
    if (!actor.configure) throw forbidden();
    const before = id
      ? await this.prisma.financeAccount.findUnique({ where: { id } })
      : null;
    if (id && !before) throw notFound('That account');
    return this.prisma.$transaction(async (tx) => {
      const data = {
        name: input.name,
        type: input.type,
        institution: input.institution ?? null,
        accountLast4: input.accountLast4 ?? null,
        openingBalance: new Prisma.Decimal(input.openingBalance),
        openingBalanceDate: dateOnly(input.openingBalanceDate),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      const row = id
        ? await tx.financeAccount.update({ where: { id }, data })
        : await tx.financeAccount.create({ data });
      await recordFinanceAudit(tx, {
        entityType: 'ACCOUNT',
        entityId: row.id,
        action: id ? 'UPDATED' : 'CREATED',
        actorUserId: actor.userId,
        before: before
          ? {
              name: before.name,
              type: before.type,
              openingBalance: before.openingBalance,
              openingBalanceDate: before.openingBalanceDate,
              isActive: before.isActive,
            }
          : null,
        after: {
          name: row.name,
          type: row.type,
          openingBalance: row.openingBalance,
          openingBalanceDate: row.openingBalanceDate,
          isActive: row.isActive,
        },
      });
      return { id: row.id };
    });
  }

  async assertActiveAccount(tx: Tx, accountId: string) {
    const account = await tx.financeAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) throw notFound('That company account');
    if (!account.isActive) throw invalid('That company account is inactive.');
  }

  // ------------------------------------------------------------ vendors

  async vendors(actor: FinanceActor): Promise<FinanceVendorDto[]> {
    if (!actor.viewCompany) throw forbidden();
    const [rows, totals] = await Promise.all([
      this.prisma.financeVendor.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.financeExpense.findMany({
        where: {
          vendorId: { not: null },
          status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] },
        },
        select: {
          vendorId: true,
          amount: true,
          payments: { where: { voidedAt: null }, select: { amount: true } },
        },
      }),
    ]);
    const byVendor = new Map<
      string,
      { paid: Prisma.Decimal; owed: Prisma.Decimal; count: number }
    >();
    for (const e of totals) {
      const paid = e.payments.reduce(
        (t, p) => t.plus(p.amount),
        new Prisma.Decimal(0),
      );
      const v = byVendor.get(e.vendorId!) ?? {
        paid: new Prisma.Decimal(0),
        owed: new Prisma.Decimal(0),
        count: 0,
      };
      v.paid = v.paid.plus(paid);
      v.owed = v.owed.plus(Prisma.Decimal.max(e.amount.minus(paid), 0));
      v.count += 1;
      byVendor.set(e.vendorId!, v);
    }
    return rows.map((v) => {
      const t = byVendor.get(v.id);
      return {
        id: v.id,
        name: v.name,
        category: v.category,
        contactPerson: v.contactPerson,
        phone: v.phone,
        email: v.email,
        address: v.address,
        gstin: v.gstin,
        paymentTerms: v.paymentTerms,
        bankDetails: actor.bankDetails ? v.bankDetails : null,
        isActive: v.isActive,
        totalPaid: money(t?.paid),
        outstanding: money(t?.owed),
        expenseCount: t?.count ?? 0,
      };
    });
  }

  /** Vendor names for the expense form — every claim role may pick a vendor, without contact or bank data. */
  async vendorOptions() {
    return this.prisma.financeVendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async saveVendor(
    actor: FinanceActor,
    id: string | null,
    input: FinanceVendorInput,
  ) {
    if (!actor.manage) throw forbidden();
    const before = id
      ? await this.prisma.financeVendor.findUnique({ where: { id } })
      : null;
    if (id && !before) throw notFound('That vendor');
    // Bank details can only be written by someone allowed to see them; otherwise they are left as they were.
    if (input.bankDetails !== undefined && !actor.bankDetails)
      throw new AppException(
        FinanceErrorCode.FORBIDDEN,
        'Only a platform admin can set bank details.',
        HttpStatus.FORBIDDEN,
      );
    return this.prisma.$transaction(async (tx) => {
      const data = {
        name: input.name,
        category: input.category ?? null,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        gstin: input.gstin ?? null,
        paymentTerms: input.paymentTerms ?? null,
        ...(actor.bankDetails
          ? { bankDetails: input.bankDetails ?? null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };
      const row = id
        ? await tx.financeVendor.update({ where: { id }, data })
        : await tx.financeVendor.create({ data });
      await recordFinanceAudit(tx, {
        entityType: 'VENDOR',
        entityId: row.id,
        action: id ? 'UPDATED' : 'CREATED',
        actorUserId: actor.userId,
        // Bank details are never copied into the audit trail.
        before: before
          ? {
              name: before.name,
              gstin: before.gstin,
              isActive: before.isActive,
              bankDetailsChanged: false,
            }
          : null,
        after: {
          name: row.name,
          gstin: row.gstin,
          isActive: row.isActive,
          bankDetailsChanged:
            !!before &&
            actor.bankDetails &&
            (before.bankDetails ?? null) !== (input.bankDetails ?? null),
        },
      });
      return { id: row.id };
    });
  }
}
