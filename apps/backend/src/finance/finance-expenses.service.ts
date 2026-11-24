import { createHash, randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FINANCE_ATTACHMENT_MAX_BYTES,
  FINANCE_ATTACHMENT_MIME_TYPES,
  FINANCE_EDITABLE_STATUSES,
  FINANCE_EXPENSE_STATUS_LABEL,
  FINANCE_EXPENSE_TYPE_LABEL,
  FINANCE_PAYABLE_STATUSES,
  FINANCE_PENDING_STATUSES,
  FINANCE_RECLASSIFIABLE_STATUSES,
  FINANCE_RECOGNISED_STATUSES,
  FinanceErrorCode,
  expenseStatusAfterPayments,
  financeExpenseType,
  type FinanceAuditEventDto,
  type FinanceDuplicateCandidateDto,
  type FinanceExpenseDetailDto,
  type FinanceExpenseDto,
  type FinanceExpenseInput,
  type FinanceExpenseListQuery,
  type FinanceExpensePageDto,
  type FinanceExpensePaymentInput,
  type FinanceExpenseReviewInput,
  type FinanceExpenseStatus,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { recordFinanceAudit } from './finance-audit';
import {
  dateOnly,
  forbidden,
  invalid,
  invalidState,
  isUniqueViolation,
  isoDay,
  money,
  notFound,
  type FinanceActor,
} from './finance-access';
import { FinanceSetupService } from './finance-setup.service';

type Tx = Prisma.TransactionClient;

const expenseInclude = {
  category: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: {
      account: { select: { id: true, name: true } },
      contributor: { select: { id: true, name: true, userId: true } },
      reimbursements: {
        where: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
        select: { id: true },
      },
    },
  },
  _count: { select: { attachments: true } },
} satisfies Prisma.FinanceExpenseInclude;

type ExpenseRow = Prisma.FinanceExpenseGetPayload<{
  include: typeof expenseInclude;
}>;

const DUPLICATE_WINDOW_DAYS = 3;
const EXPORT_LIMIT = 5000;

/** A payment from someone's own money that is to be paid back — the only basis for a claim. */
function isReimbursablePersonal(p: {
  payerType: string;
  personalTreatment?: string | null;
}): boolean {
  return p.payerType === 'PERSON' && p.personalTreatment === 'REIMBURSABLE';
}

/**
 * The type a new expense is saved as. When a payer is given it decides: paid personally and "to be
 * reimbursed" is a claim; a company account, a founder loan or a contribution is a company expense.
 * With no payer yet (a bill to pay later) the explicit choice stands; the default is a company expense.
 */
export function createdAsReimbursement(input: FinanceExpenseInput): boolean {
  if (input.paidByMe) return true;
  if (input.paidBy) return isReimbursablePersonal(input.paidBy);
  return input.reimbursementRequired;
}

function activePaid(e: ExpenseRow): Prisma.Decimal {
  return e.payments
    .filter((p) => !p.voidedAt)
    .reduce((t, p) => t.plus(p.amount), new Prisma.Decimal(0));
}

/** Snapshot of the editable fields, for the audit trail. */
function snapshot(e: {
  expenseDate: Date;
  categoryId: string;
  subcategoryId: string | null;
  customSubcategory: string | null;
  description: string;
  amount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  vendorId: string | null;
  department: string | null;
  city: string | null;
  project: string | null;
  reimbursementRequired: boolean;
  isRecurring: boolean;
  notes: string | null;
  status: FinanceExpenseStatus;
}) {
  return {
    expenseDate: isoDay(e.expenseDate),
    categoryId: e.categoryId,
    subcategoryId: e.subcategoryId,
    customSubcategory: e.customSubcategory,
    description: e.description,
    amount: e.amount,
    taxAmount: e.taxAmount,
    vendorId: e.vendorId,
    department: e.department,
    city: e.city,
    project: e.project,
    reimbursementRequired: e.reimbursementRequired,
    isRecurring: e.isRecurring,
    notes: e.notes,
    status: e.status,
  };
}

/** CSV cell, with spreadsheet formula injection neutralised. */
function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class FinanceExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: FinanceSetupService,
    private readonly files: PrivateObjectStorageService,
  ) {}

  // ------------------------------------------------------------ access

  private async ownContributorId(userId: string): Promise<string | null> {
    const c = await this.prisma.financeContributor.findUnique({
      where: { userId },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  /** Non-finance roles see only expenses they created or paid personally. */
  private async scope(
    actor: FinanceActor,
  ): Promise<Prisma.FinanceExpenseWhereInput> {
    if (actor.viewCompany) return {};
    const contributorId = await this.ownContributorId(actor.userId);
    return {
      OR: [
        { createdByUserId: actor.userId },
        ...(contributorId ? [{ payments: { some: { contributorId } } }] : []),
      ],
    };
  }

  private async loadVisible(
    actor: FinanceActor,
    id: string,
  ): Promise<ExpenseRow> {
    const row = await this.prisma.financeExpense.findFirst({
      where: { AND: [{ id }, await this.scope(actor)] },
      include: expenseInclude,
    });
    if (!row) throw notFound('That expense');
    return row;
  }

  private permissions(
    actor: FinanceActor,
    e: ExpenseRow,
  ): FinanceExpenseDto['can'] {
    const own = e.createdByUserId === actor.userId;
    const hasActivePayments = e.payments.some((p) => !p.voidedAt);
    const editable = FINANCE_EDITABLE_STATUSES.includes(e.status);
    return {
      edit:
        editable &&
        (actor.manage ||
          (own && (e.status === 'DRAFT' || e.status === 'SUBMITTED'))),
      reclassify:
        actor.manage && FINANCE_RECLASSIFIABLE_STATUSES.includes(e.status),
      submit: e.status === 'DRAFT' && (own || actor.manage),
      review:
        actor.approve &&
        FINANCE_PENDING_STATUSES.includes(e.status) &&
        (!own || actor.isPlatformAdmin),
      cancel:
        !['PAID', 'CANCELLED', 'REJECTED'].includes(e.status) &&
        !hasActivePayments &&
        (actor.manage ||
          (own && (e.status === 'DRAFT' || e.status === 'SUBMITTED'))),
      pay:
        actor.manage &&
        FINANCE_PAYABLE_STATUSES.includes(e.status) &&
        activePaid(e).lessThan(e.amount),
      delete:
        e.status === 'DRAFT' &&
        !hasActivePayments &&
        e.payments.length === 0 &&
        (own || actor.manage),
    };
  }

  private async names(
    userIds: Array<string | null>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((v): v is string => !!v))];
    if (!ids.length) return new Map();
    const [users, contributors] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          email: true,
          phone: true,
          employeeProfile: { select: { fullName: true } },
        },
      }),
      this.prisma.financeContributor.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, name: true },
      }),
    ]);
    const byContributor = new Map(contributors.map((c) => [c.userId!, c.name]));
    return new Map(
      users.map((u) => [
        u.id,
        byContributor.get(u.id) ??
          u.employeeProfile?.fullName ??
          u.email ??
          u.phone ??
          'FastQue user',
      ]),
    );
  }

  private toDto(
    actor: FinanceActor,
    e: ExpenseRow,
    names: Map<string, string>,
  ): FinanceExpenseDto {
    const active = e.payments.filter((p) => !p.voidedAt);
    const paidBy = [
      ...new Set(
        active.map((p) =>
          p.contributor
            ? p.contributor.name
            : `Company: ${p.account?.name ?? 'account'}`,
        ),
      ),
    ];
    const lastPaid = active.reduce<Date | null>(
      (d, p) => (!d || p.paidOn > d ? p.paidOn : d),
      null,
    );
    return {
      id: e.id,
      number: e.number,
      expenseDate: isoDay(e.expenseDate),
      category: e.category,
      subcategory: e.subcategory,
      customSubcategory: e.customSubcategory,
      description: e.description,
      amount: money(e.amount),
      taxAmount: money(e.taxAmount),
      currency: e.currency,
      vendor: e.vendor,
      department: e.department,
      city: e.city,
      project: e.project,
      reimbursementRequired: e.reimbursementRequired,
      isRecurring: e.isRecurring,
      notes: e.notes,
      status: e.status,
      paidAmount: money(activePaid(e)),
      paidBy,
      lastPaidOn: lastPaid ? isoDay(lastPaid) : null,
      attachmentCount: e._count.attachments,
      createdBy: {
        id: e.createdByUserId,
        name: names.get(e.createdByUserId) ?? 'FastQue user',
      },
      approvedBy:
        e.reviewedByUserId && FINANCE_RECOGNISED_STATUSES.includes(e.status)
          ? {
              id: e.reviewedByUserId,
              name: names.get(e.reviewedByUserId) ?? 'FastQue user',
            }
          : null,
      approvedAt:
        e.reviewedAt && FINANCE_RECOGNISED_STATUSES.includes(e.status)
          ? e.reviewedAt.toISOString()
          : null,
      reviewNote: e.reviewNote,
      createdAt: e.createdAt.toISOString(),
      can: this.permissions(actor, e),
    };
  }

  // ------------------------------------------------------------ read

  private listWhere(
    query: FinanceExpenseListQuery,
  ): Prisma.FinanceExpenseWhereInput {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.city
        ? { city: { equals: query.city, mode: 'insensitive' } }
        : {}),
      ...(query.department
        ? { department: { equals: query.department, mode: 'insensitive' } }
        : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.type
        ? { reimbursementRequired: query.type === 'REIMBURSEMENT' }
        : {}),
      ...(query.paidByContributorId
        ? {
            payments: {
              some: {
                contributorId: query.paidByContributorId,
                voidedAt: null,
              },
            },
          }
        : {}),
      ...(query.from || query.to
        ? {
            expenseDate: {
              ...(query.from ? { gte: dateOnly(query.from) } : {}),
              ...(query.to ? { lte: dateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { description: { contains: query.q, mode: 'insensitive' } },
              { number: { contains: query.q, mode: 'insensitive' } },
              { notes: { contains: query.q, mode: 'insensitive' } },
              { project: { contains: query.q, mode: 'insensitive' } },
              { customSubcategory: { contains: query.q, mode: 'insensitive' } },
              { vendor: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private orderBy(
    sort: FinanceExpenseListQuery['sort'],
  ): Prisma.FinanceExpenseOrderByWithRelationInput[] {
    switch (sort) {
      case 'date_asc':
        return [{ expenseDate: 'asc' }, { createdAt: 'asc' }];
      case 'amount_desc':
        return [{ amount: 'desc' }, { expenseDate: 'desc' }];
      case 'amount_asc':
        return [{ amount: 'asc' }, { expenseDate: 'desc' }];
      default:
        return [{ expenseDate: 'desc' }, { createdAt: 'desc' }];
    }
  }

  async list(
    actor: FinanceActor,
    query: FinanceExpenseListQuery,
  ): Promise<FinanceExpensePageDto> {
    const where: Prisma.FinanceExpenseWhereInput = {
      AND: [await this.scope(actor), this.listWhere(query)],
    };
    const [rows, total, sum] = await Promise.all([
      this.prisma.financeExpense.findMany({
        where,
        include: expenseInclude,
        orderBy: this.orderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.financeExpense.count({ where }),
      this.prisma.financeExpense.aggregate({ where, _sum: { amount: true } }),
    ]);
    const names = await this.names(
      rows.flatMap((r) => [r.createdByUserId, r.reviewedByUserId]),
    );
    return {
      items: rows.map((r) => this.toDto(actor, r, names)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalAmount: money(sum._sum.amount),
    };
  }

  async detail(
    actor: FinanceActor,
    id: string,
  ): Promise<FinanceExpenseDetailDto> {
    const e = await this.loadVisible(actor, id);
    const attachments = await this.prisma.financeAttachment.findMany({
      where: { expenseId: id },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.names([
      e.createdByUserId,
      e.reviewedByUserId,
      ...e.payments.map((p) => p.createdByUserId),
    ]);
    return {
      ...this.toDto(actor, e, names),
      payments: e.payments.map((p) => ({
        id: p.id,
        amount: money(p.amount),
        paidOn: isoDay(p.paidOn),
        payerType: p.payerType,
        account: p.account,
        contributor: p.contributor
          ? { id: p.contributor.id, name: p.contributor.name }
          : null,
        personalTreatment: p.personalTreatment,
        method: p.method,
        reference: p.reference,
        voided: !!p.voidedAt,
        voidReason: p.voidReason,
        createdAt: p.createdAt.toISOString(),
        createdBy: names.get(p.createdByUserId) ?? null,
        reimbursementId: p.reimbursements[0]?.id ?? null,
      })),
      attachments: attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        uploadedAt: a.createdAt.toISOString(),
      })),
    };
  }

  async audit(
    actor: FinanceActor,
    id: string,
  ): Promise<FinanceAuditEventDto[]> {
    const e = await this.loadVisible(actor, id);
    const attachmentIds = (
      await this.prisma.financeAttachment.findMany({
        where: { expenseId: id },
        select: { id: true },
      })
    ).map((a) => a.id);
    const events = await this.prisma.financeAuditEvent.findMany({
      where: {
        entityId: {
          in: [id, ...e.payments.map((p) => p.id), ...attachmentIds],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const names = await this.names(events.map((ev) => ev.actorUserId));
    return events.map((ev) => ({
      id: ev.id,
      action: `${ev.entityType === 'EXPENSE' ? '' : `${ev.entityType.replace(/_/g, ' ').toLowerCase()} `}${ev.action.replace(/_/g, ' ').toLowerCase()}`,
      actor: ev.actorUserId
        ? (names.get(ev.actorUserId) ?? 'FastQue user')
        : null,
      note: ev.note,
      changes: (ev.changes as FinanceAuditEventDto['changes']) ?? null,
      createdAt: ev.createdAt.toISOString(),
    }));
  }

  async exportCsv(
    actor: FinanceActor,
    query: FinanceExpenseListQuery,
  ): Promise<{ filename: string; body: string }> {
    const where: Prisma.FinanceExpenseWhereInput = {
      AND: [await this.scope(actor), this.listWhere(query)],
    };
    const rows = await this.prisma.financeExpense.findMany({
      where,
      include: expenseInclude,
      orderBy: this.orderBy(query.sort),
      take: EXPORT_LIMIT,
    });
    const names = await this.names(
      rows.flatMap((r) => [r.createdByUserId, r.reviewedByUserId]),
    );
    const header = [
      'Expense ID',
      'Expense date',
      'Main category',
      'Subcategory',
      'Type',
      'Description',
      'Amount (INR)',
      'Tax (INR)',
      'Paid (INR)',
      'Paid by',
      'Last payment date',
      'Vendor',
      'Department',
      'City',
      'Project',
      'Status',
      'Receipts',
      'Entered by',
      'Approved by',
    ];
    const filters = Object.entries(query)
      .filter(([k, v]) => v !== undefined && !['page', 'pageSize'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const lines = [
      `# FastQue expenses export; currency INR; generated ${new Date().toISOString()}; filters: ${filters || 'none'}`,
      header.map(csvCell).join(','),
      ...rows.map((r) => {
        const d = this.toDto(actor, r, names);
        return [
          d.number,
          d.expenseDate,
          d.category.name,
          d.subcategory?.name ?? d.customSubcategory ?? '',
          FINANCE_EXPENSE_TYPE_LABEL[financeExpenseType(d)],
          d.description,
          d.amount,
          d.taxAmount,
          d.paidAmount,
          d.paidBy.join(' + '),
          d.lastPaidOn ?? '',
          d.vendor?.name ?? '',
          d.department ?? '',
          d.city ?? '',
          d.project ?? '',
          FINANCE_EXPENSE_STATUS_LABEL[d.status],
          d.attachmentCount,
          d.createdBy?.name ?? '',
          d.approvedBy?.name ?? '',
        ]
          .map(csvCell)
          .join(',');
      }),
    ];
    return {
      filename: `fastque-expenses-${new Date().toISOString().slice(0, 10)}.csv`,
      body: `${lines.join('\r\n')}\r\n`,
    };
  }

  // ------------------------------------------------------------ write

  private async validateRefs(input: FinanceExpenseInput) {
    const category = await this.prisma.financeCategory.findUnique({
      where: { id: input.categoryId },
    });
    if (!category || category.parentId)
      throw invalid('Choose a main category.');
    if (!category.isActive) throw invalid('That category is inactive.');
    if (input.subcategoryId) {
      const sub = await this.prisma.financeCategory.findUnique({
        where: { id: input.subcategoryId },
      });
      if (!sub || sub.parentId !== category.id)
        throw invalid('That subcategory does not belong to the main category.');
    }
    if (input.vendorId) {
      const vendor = await this.prisma.financeVendor.findUnique({
        where: { id: input.vendorId },
      });
      if (!vendor) throw invalid('That vendor does not exist.');
    }
  }

  /** Same amount within a few days and the same vendor (or same category when no vendor). */
  async findDuplicates(
    input: Pick<
      FinanceExpenseInput,
      'amount' | 'expenseDate' | 'vendorId' | 'categoryId'
    >,
    excludeId?: string,
  ): Promise<FinanceDuplicateCandidateDto[]> {
    const day = dateOnly(input.expenseDate).getTime();
    const window = DUPLICATE_WINDOW_DAYS * 86_400_000;
    const rows = await this.prisma.financeExpense.findMany({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        amount: new Prisma.Decimal(input.amount),
        status: { notIn: ['CANCELLED', 'REJECTED'] },
        expenseDate: {
          gte: new Date(day - window),
          lte: new Date(day + window),
        },
        ...(input.vendorId
          ? { vendorId: input.vendorId }
          : { categoryId: input.categoryId }),
      },
      take: 5,
      orderBy: { expenseDate: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      expenseDate: isoDay(r.expenseDate),
      amount: money(r.amount),
      description: r.description,
      status: r.status,
    }));
  }

  private data(input: FinanceExpenseInput, reimbursementRequired: boolean) {
    return {
      expenseDate: dateOnly(input.expenseDate),
      categoryId: input.categoryId,
      subcategoryId: input.subcategoryId ?? null,
      customSubcategory: input.subcategoryId
        ? null
        : (input.customSubcategory ?? null),
      description: input.description,
      amount: new Prisma.Decimal(input.amount),
      taxAmount: new Prisma.Decimal(input.taxAmount),
      vendorId: input.vendorId ?? null,
      department: input.department ?? null,
      city: input.city ?? null,
      project: input.project ?? null,
      reimbursementRequired,
      isRecurring: input.isRecurring,
      notes: input.notes ?? null,
    };
  }

  async create(
    actor: FinanceActor,
    input: FinanceExpenseInput,
  ): Promise<{ id: string }> {
    if (input.clientRequestId) {
      const replay = await this.prisma.financeExpense.findUnique({
        where: { clientRequestId: input.clientRequestId },
        select: { id: true, createdByUserId: true },
      });
      if (replay) {
        if (replay.createdByUserId !== actor.userId) throw forbidden();
        return { id: replay.id };
      }
    }
    // Recording that SOMEONE ELSE (or a company account) paid is a finance-manager action; anyone
    // may record that they paid themselves (paidByMe).
    if (input.paidBy && !actor.manage)
      throw forbidden(
        'Only finance managers can record who paid for an expense.',
      );
    await this.validateRefs(input);
    if (!input.confirmDuplicate) {
      const candidates = await this.findDuplicates(input);
      if (candidates.length)
        throw new AppException(
          FinanceErrorCode.DUPLICATE_SUSPECTED,
          'This looks like an expense that is already recorded. Check it, then save again to confirm.',
          HttpStatus.CONFLICT,
          { candidates },
        );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeExpense.create({
          data: {
            ...this.data(input, createdAsReimbursement(input)),
            status: 'DRAFT',
            createdByUserId: actor.userId,
            clientRequestId: input.clientRequestId ?? null,
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'EXPENSE',
          entityId: row.id,
          action: 'CREATED',
          actorUserId: actor.userId,
          after: snapshot(row),
          note: input.confirmDuplicate
            ? 'Saved after a possible-duplicate warning.'
            : null,
        });
        if (input.paidByMe) {
          const contributorId = await this.setup.ensureOwnContributor(
            tx,
            actor.userId,
          );
          const payment = await tx.financeExpensePayment.create({
            data: {
              expenseId: row.id,
              amount: row.amount,
              paidOn: row.expenseDate,
              payerType: 'PERSON',
              contributorId,
              personalTreatment: 'REIMBURSABLE',
              method: 'OTHER',
              createdByUserId: actor.userId,
            },
          });
          await recordFinanceAudit(tx, {
            entityType: 'EXPENSE_PAYMENT',
            entityId: payment.id,
            action: 'RECORDED',
            actorUserId: actor.userId,
            after: {
              amount: payment.amount,
              payerType: 'PERSON',
              contributorId,
              personalTreatment: 'REIMBURSABLE',
            },
            note: 'Paid personally by the person who entered the expense.',
          });
        }
        if (input.paidBy) {
          const paidBy = input.paidBy;
          if (paidBy.payerType === 'COMPANY_ACCOUNT')
            await this.setup.assertActiveAccount(tx, paidBy.accountId!);
          else {
            const contributor = await tx.financeContributor.findUnique({
              where: { id: paidBy.contributorId! },
            });
            if (!contributor) throw notFound('That contributor');
            if (!contributor.isActive)
              throw invalid('That contributor is inactive.');
          }
          const payment = await tx.financeExpensePayment.create({
            data: {
              expenseId: row.id,
              amount: row.amount,
              paidOn: row.expenseDate,
              payerType: paidBy.payerType,
              accountId:
                paidBy.payerType === 'COMPANY_ACCOUNT'
                  ? paidBy.accountId!
                  : null,
              contributorId:
                paidBy.payerType === 'PERSON' ? paidBy.contributorId! : null,
              personalTreatment:
                paidBy.payerType === 'PERSON'
                  ? paidBy.personalTreatment!
                  : null,
              method: paidBy.method,
              reference: paidBy.reference ?? null,
              createdByUserId: actor.userId,
            },
          });
          await recordFinanceAudit(tx, {
            entityType: 'EXPENSE_PAYMENT',
            entityId: payment.id,
            action: 'RECORDED',
            actorUserId: actor.userId,
            after: {
              amount: payment.amount,
              payerType: payment.payerType,
              accountId: payment.accountId,
              contributorId: payment.contributorId,
              personalTreatment: payment.personalTreatment,
              method: payment.method,
              reference: payment.reference,
            },
            note: 'Who paid was recorded when the expense was entered.',
          });
        }
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'clientRequestId')) {
        const row = await this.prisma.financeExpense.findUnique({
          where: { clientRequestId: input.clientRequestId },
        });
        if (row) return { id: row.id };
      }
      throw error;
    }
  }

  async update(
    actor: FinanceActor,
    id: string,
    input: FinanceExpenseInput,
  ): Promise<{ id: string }> {
    const e = await this.loadVisible(actor, id);
    const can = this.permissions(actor, e);
    if (!can.edit && !can.reclassify)
      throw forbidden('This expense can no longer be edited by you.');
    if (input.paidByMe || input.paidBy)
      throw invalid(
        'Record a payment instead of changing who paid when editing.',
      );
    await this.validateRefs(input);
    if (!can.edit) {
      // Approved / paid: the money is settled, only the classification may be corrected.
      const moneyChanged =
        input.amount !== money(e.amount) ||
        input.taxAmount !== money(e.taxAmount) ||
        input.expenseDate !== isoDay(e.expenseDate) ||
        input.description !== e.description ||
        (input.vendorId ?? null) !== e.vendorId;
      if (moneyChanged)
        throw invalidState(
          'This expense is already approved. Only its category, department, city, project, notes and type can be changed.',
        );
    } else {
      const paid = activePaid(e);
      if (new Prisma.Decimal(input.amount).lessThan(paid))
        throw invalid(
          `The amount cannot be less than what is already paid (${money(paid)}).`,
        );
      if (
        !input.confirmDuplicate &&
        (input.amount !== money(e.amount) ||
          input.expenseDate !== isoDay(e.expenseDate))
      ) {
        const candidates = await this.findDuplicates(input, id);
        if (candidates.length)
          throw new AppException(
            FinanceErrorCode.DUPLICATE_SUSPECTED,
            'This looks like an expense that is already recorded. Check it, then save again to confirm.',
            HttpStatus.CONFLICT,
            { candidates },
          );
      }
    }

    // Type change: company expense <-> reimbursement claim.
    const toCompany = e.reimbursementRequired && !input.reimbursementRequired;
    const toReimbursement =
      !e.reimbursementRequired && input.reimbursementRequired;
    const active = e.payments.filter((p) => !p.voidedAt);
    const personal = active.filter(isReimbursablePersonal);
    if (toReimbursement && active.length && !personal.length)
      throw invalid(
        "Only an expense paid from someone's own money can be a reimbursement claim. This one was paid by the company or is not to be paid back — void that payment first.",
      );
    if (
      toCompany &&
      !actor.manage &&
      personal.some((p) => p.createdByUserId !== actor.userId)
    )
      throw forbidden(
        'Only finance managers can change who is owed for this expense.',
      );

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "finance_expenses" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const row = await tx.financeExpense.update({
        where: { id },
        data: this.data(input, input.reimbursementRequired),
      });
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE',
        entityId: id,
        action: can.edit ? 'EDITED' : 'RECLASSIFIED',
        actorUserId: actor.userId,
        before: snapshot(e),
        after: snapshot(row),
        note: toCompany
          ? 'Changed to a company expense (not a reimbursement claim).'
          : toReimbursement
            ? 'Changed to a reimbursement claim.'
            : null,
      });
      if (toCompany && personal.length) {
        // The personal "to be reimbursed" payment no longer stands: cancel its open claim and void
        // it, so the expense waits for the real (company) payment and leaves the Reimbursements tab.
        for (const p of personal)
          await this.withdrawPersonalPayment(tx, actor, p);
        const left = await tx.financeExpensePayment.aggregate({
          where: { expenseId: id, voidedAt: null },
          _sum: { amount: true },
        });
        const next = expenseStatusAfterPayments(
          row.status,
          money(row.amount),
          money(left._sum.amount),
        );
        if (next !== row.status) {
          await tx.financeExpense.update({
            where: { id },
            data: { status: next },
          });
          await recordFinanceAudit(tx, {
            entityType: 'EXPENSE',
            entityId: id,
            action: 'PAYMENT_STATUS_CHANGED',
            actorUserId: actor.userId,
            before: { status: row.status },
            after: { status: next },
          });
        }
      }
      if (toReimbursement && e.status !== 'DRAFT')
        await this.openClaims(
          tx,
          actor,
          e,
          `Created when ${e.number} was changed to a reimbursement claim.`,
        );
      return { id };
    });
  }

  /** Cancels a personal payment's open claims (none may be paid out) and voids the payment. */
  private async withdrawPersonalPayment(
    tx: Tx,
    actor: FinanceActor,
    p: ExpenseRow['payments'][number],
  ) {
    const claimIds = p.reimbursements.map((r) => r.id);
    if (claimIds.length) {
      const paidOut = await tx.financeReimbursementPayout.count({
        where: { reimbursementId: { in: claimIds }, voidedAt: null },
      });
      if (paidOut)
        throw invalidState(
          'This expense has already been reimbursed. Void the reimbursement payout first.',
        );
      for (const claimId of claimIds) {
        await tx.financeReimbursement.update({
          where: { id: claimId },
          data: { status: 'CANCELLED' },
        });
        await recordFinanceAudit(tx, {
          entityType: 'REIMBURSEMENT',
          entityId: claimId,
          action: 'CANCELLED',
          actorUserId: actor.userId,
          after: { status: 'CANCELLED' },
          note: 'The expense was changed to a company expense.',
        });
      }
    }
    const reason =
      'The expense was changed to a company expense — not to be reimbursed.';
    const { count } = await tx.financeExpensePayment.updateMany({
      where: { id: p.id, voidedAt: null },
      data: {
        voidedAt: new Date(),
        voidReason: reason,
        voidedByUserId: actor.userId,
      },
    });
    if (count !== 1)
      throw invalidState(
        'This expense was changed by someone else. Reload and try again.',
      );
    await recordFinanceAudit(tx, {
      entityType: 'EXPENSE_PAYMENT',
      entityId: p.id,
      action: 'VOIDED',
      actorUserId: actor.userId,
      note: reason,
    });
  }

  /** Opens a reimbursement claim for each personal "to be reimbursed" payment that has none. */
  private async openClaims(
    tx: Tx,
    actor: FinanceActor,
    e: ExpenseRow,
    note: string,
  ) {
    for (const p of e.payments) {
      if (p.voidedAt || !isReimbursablePersonal(p)) continue;
      if (p.reimbursements.length) continue;
      const claim = await tx.financeReimbursement.create({
        data: {
          expensePaymentId: p.id,
          contributorId: p.contributorId!,
          amountRequested: p.amount,
          createdByUserId: actor.userId,
        },
      });
      await recordFinanceAudit(tx, {
        entityType: 'REIMBURSEMENT',
        entityId: claim.id,
        action: 'SUBMITTED',
        actorUserId: actor.userId,
        after: {
          amountRequested: claim.amountRequested,
          expensePaymentId: p.id,
        },
        note,
      });
    }
  }

  async submit(actor: FinanceActor, id: string): Promise<{ id: string }> {
    const e = await this.loadVisible(actor, id);
    if (!this.permissions(actor, e).submit)
      throw invalidState('Only a draft can be submitted.');
    return this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, 'DRAFT', {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      });
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE',
        entityId: id,
        action: 'SUBMITTED',
        actorUserId: actor.userId,
        before: { status: 'DRAFT' },
        after: { status: 'SUBMITTED' },
      });
      // A personal reimbursable payment on a reimbursement-claim expense becomes a claim now.
      if (e.reimbursementRequired)
        await this.openClaims(
          tx,
          actor,
          e,
          `Created when ${e.number} was submitted.`,
        );
      return { id };
    });
  }

  /** Optimistic status change: fails if another request changed the status first. */
  private async transition(
    tx: Tx,
    id: string,
    from: FinanceExpenseStatus | readonly FinanceExpenseStatus[],
    data: Prisma.FinanceExpenseUpdateManyMutationInput,
  ) {
    const { count } = await tx.financeExpense.updateMany({
      where: {
        id,
        status: typeof from === 'string' ? from : { in: [...from] },
      },
      data,
    });
    if (count !== 1)
      throw invalidState(
        'This expense was changed by someone else. Reload and try again.',
      );
  }

  async review(
    actor: FinanceActor,
    id: string,
    input: FinanceExpenseReviewInput,
  ): Promise<{ id: string }> {
    const e = await this.loadVisible(actor, id);
    if (!actor.approve) throw forbidden();
    if (e.createdByUserId === actor.userId && !actor.isPlatformAdmin)
      throw new AppException(
        FinanceErrorCode.SELF_APPROVAL,
        'Someone else has to review an expense you entered.',
        HttpStatus.FORBIDDEN,
      );
    if (!FINANCE_PENDING_STATUSES.includes(e.status))
      throw invalidState('Only a submitted expense can be reviewed.');
    if (input.action === 'REJECT' && !input.note)
      throw invalid('Give a reason for rejecting.');
    return this.prisma.$transaction(async (tx) => {
      let next: FinanceExpenseStatus;
      if (input.action === 'START_REVIEW') next = 'UNDER_REVIEW';
      else if (input.action === 'REJECT') next = 'REJECTED';
      // Approval never marks it paid: the status follows the payments already recorded.
      else
        next = expenseStatusAfterPayments(
          'APPROVED',
          money(e.amount),
          money(activePaid(e)),
        );
      await this.transition(tx, id, FINANCE_PENDING_STATUSES, {
        status: next,
        ...(input.action === 'START_REVIEW'
          ? {}
          : {
              reviewedByUserId: actor.userId,
              reviewedAt: new Date(),
              reviewNote: input.note ?? null,
            }),
      });
      if (next === 'REJECTED')
        await this.cancelOpenClaims(
          tx,
          e,
          actor.userId,
          `${e.number} was rejected.`,
        );
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE',
        entityId: id,
        action:
          input.action === 'START_REVIEW'
            ? 'REVIEW_STARTED'
            : input.action === 'APPROVE'
              ? 'APPROVED'
              : 'REJECTED',
        actorUserId: actor.userId,
        before: { status: e.status },
        after: { status: next },
        note:
          input.note ??
          (e.createdByUserId === actor.userId
            ? 'Self-approved by a platform admin.'
            : null),
      });
      return { id };
    });
  }

  private async cancelOpenClaims(
    tx: Tx,
    e: ExpenseRow,
    actorUserId: string,
    note: string,
  ) {
    const claimIds = e.payments.flatMap((p) =>
      p.reimbursements.map((r) => r.id),
    );
    if (!claimIds.length) return;
    const withPayouts = await tx.financeReimbursementPayout.count({
      where: { reimbursementId: { in: claimIds }, voidedAt: null },
    });
    if (withPayouts)
      throw invalidState(
        'A reimbursement has already been paid out for this expense. Void that payout first.',
      );
    for (const claimId of claimIds) {
      await tx.financeReimbursement.update({
        where: { id: claimId },
        data: { status: 'CANCELLED' },
      });
      await recordFinanceAudit(tx, {
        entityType: 'REIMBURSEMENT',
        entityId: claimId,
        action: 'CANCELLED',
        actorUserId,
        after: { status: 'CANCELLED' },
        note,
      });
    }
  }

  async cancel(
    actor: FinanceActor,
    id: string,
    reason: string,
  ): Promise<{ id: string }> {
    const e = await this.loadVisible(actor, id);
    if (!this.permissions(actor, e).cancel)
      throw invalidState(
        'This expense cannot be cancelled (void its payments first, or ask a finance admin).',
      );
    return this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, e.status, {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      });
      await this.cancelOpenClaims(
        tx,
        e,
        actor.userId,
        `${e.number} was cancelled.`,
      );
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE',
        entityId: id,
        action: 'CANCELLED',
        actorUserId: actor.userId,
        before: { status: e.status },
        after: { status: 'CANCELLED' },
        note: reason,
      });
      return { id };
    });
  }

  /** Only an unpaid draft can be deleted; anything else is cancelled so its history stays. */
  async remove(actor: FinanceActor, id: string): Promise<{ id: string }> {
    const e = await this.loadVisible(actor, id);
    if (!this.permissions(actor, e).delete)
      throw invalidState(
        'Only a draft without payments can be deleted. Cancel it instead.',
      );
    const keys = (
      await this.prisma.financeAttachment.findMany({
        where: { expenseId: id, storageKey: { not: null } },
        select: { storageKey: true },
      })
    ).map((r) => r.storageKey as string);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.financeAttachment.deleteMany({ where: { expenseId: id } });
      const { count } = await tx.financeExpense.deleteMany({
        where: { id, status: 'DRAFT' },
      });
      if (count !== 1)
        throw invalidState(
          'This expense was changed by someone else. Reload and try again.',
        );
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE',
        entityId: id,
        action: 'DRAFT_DELETED',
        actorUserId: actor.userId,
        before: snapshot(e),
      });
      return { id };
    });
    for (const k of keys) await this.files.delete(k);
    return result;
  }

  // ------------------------------------------------------------ payments

  async addPayment(
    actor: FinanceActor,
    id: string,
    input: FinanceExpensePaymentInput,
  ): Promise<{ id: string }> {
    if (!actor.manage) throw forbidden();
    if (input.clientRequestId) {
      const replay = await this.prisma.financeExpensePayment.findUnique({
        where: { clientRequestId: input.clientRequestId },
      });
      if (replay) return { id: replay.id };
    }
    await this.loadVisible(actor, id);
    return this.prisma.$transaction(async (tx) => {
      // Lock the expense row so two simultaneous payments cannot together overpay it.
      await tx.$queryRaw`SELECT "id" FROM "finance_expenses" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const e = await tx.financeExpense.findUniqueOrThrow({
        where: { id },
        include: {
          payments: { where: { voidedAt: null }, select: { amount: true } },
        },
      });
      if (!FINANCE_PAYABLE_STATUSES.includes(e.status))
        throw invalidState(
          'Payments cannot be recorded on a rejected or cancelled expense.',
        );
      const paid = e.payments.reduce(
        (t, p) => t.plus(p.amount),
        new Prisma.Decimal(0),
      );
      const remaining = e.amount.minus(paid);
      const amount = new Prisma.Decimal(input.amount);
      if (amount.greaterThan(remaining))
        throw new AppException(
          FinanceErrorCode.OVERPAYMENT,
          `Only ${money(remaining)} is left to pay on this expense.`,
          HttpStatus.CONFLICT,
        );
      if (input.payerType === 'COMPANY_ACCOUNT')
        await this.setup.assertActiveAccount(tx, input.accountId!);
      else {
        const c = await tx.financeContributor.findUnique({
          where: { id: input.contributorId! },
        });
        if (!c) throw notFound('That contributor');
      }
      const payment = await tx.financeExpensePayment.create({
        data: {
          expenseId: id,
          amount,
          paidOn: dateOnly(input.paidOn),
          payerType: input.payerType,
          accountId:
            input.payerType === 'COMPANY_ACCOUNT' ? input.accountId! : null,
          contributorId:
            input.payerType === 'PERSON' ? input.contributorId! : null,
          personalTreatment:
            input.payerType === 'PERSON' ? input.personalTreatment! : null,
          method: input.method,
          reference: input.reference ?? null,
          createdByUserId: actor.userId,
          clientRequestId: input.clientRequestId ?? null,
        },
      });
      const next = expenseStatusAfterPayments(
        e.status,
        money(e.amount),
        money(paid.plus(amount)),
      );
      if (next !== e.status)
        await tx.financeExpense.update({
          where: { id },
          data: { status: next },
        });
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE_PAYMENT',
        entityId: payment.id,
        action: 'RECORDED',
        actorUserId: actor.userId,
        after: {
          expenseId: id,
          amount: payment.amount,
          paidOn: input.paidOn,
          payerType: payment.payerType,
          accountId: payment.accountId,
          contributorId: payment.contributorId,
          personalTreatment: payment.personalTreatment,
          method: payment.method,
          reference: payment.reference,
        },
      });
      if (next !== e.status)
        await recordFinanceAudit(tx, {
          entityType: 'EXPENSE',
          entityId: id,
          action: 'PAYMENT_STATUS_CHANGED',
          actorUserId: actor.userId,
          before: { status: e.status },
          after: { status: next },
        });
      // Someone paid it from their own money and is to be paid back: that makes it a claim.
      if (isReimbursablePersonal(payment) && !e.reimbursementRequired) {
        await tx.financeExpense.update({
          where: { id },
          data: { reimbursementRequired: true },
        });
        await recordFinanceAudit(tx, {
          entityType: 'EXPENSE',
          entityId: id,
          action: 'EDITED',
          actorUserId: actor.userId,
          before: { reimbursementRequired: false },
          after: { reimbursementRequired: true },
          note: 'Changed to a reimbursement claim: a personal payment to be reimbursed was recorded.',
        });
      }
      return { id: payment.id };
    });
  }

  async voidPayment(
    actor: FinanceActor,
    paymentId: string,
    reason: string,
  ): Promise<{ id: string }> {
    if (!actor.manage) throw forbidden();
    const payment = await this.prisma.financeExpensePayment.findUnique({
      where: { id: paymentId },
      include: {
        reimbursements: {
          where: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
          select: { id: true },
        },
      },
    });
    if (!payment) throw notFound('That payment');
    if (payment.voidedAt) throw invalidState('That payment is already voided.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "finance_expenses" WHERE "id" = ${payment.expenseId}::uuid FOR UPDATE`;
      const claimIds = payment.reimbursements.map((r) => r.id);
      if (claimIds.length) {
        const paidOut = await tx.financeReimbursementPayout.count({
          where: { reimbursementId: { in: claimIds }, voidedAt: null },
        });
        if (paidOut)
          throw invalidState(
            'This payment has been reimbursed. Void the reimbursement payout first.',
          );
        for (const claimId of claimIds) {
          await tx.financeReimbursement.update({
            where: { id: claimId },
            data: { status: 'CANCELLED' },
          });
          await recordFinanceAudit(tx, {
            entityType: 'REIMBURSEMENT',
            entityId: claimId,
            action: 'CANCELLED',
            actorUserId: actor.userId,
            after: { status: 'CANCELLED' },
            note: 'The payment it claimed was voided.',
          });
        }
      }
      const { count } = await tx.financeExpensePayment.updateMany({
        where: { id: paymentId, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidReason: reason,
          voidedByUserId: actor.userId,
        },
      });
      if (count !== 1) throw invalidState('That payment is already voided.');
      const e = await tx.financeExpense.findUniqueOrThrow({
        where: { id: payment.expenseId },
        include: {
          payments: { where: { voidedAt: null }, select: { amount: true } },
        },
      });
      const paid = e.payments.reduce(
        (t, p) => t.plus(p.amount),
        new Prisma.Decimal(0),
      );
      const next = expenseStatusAfterPayments(
        e.status,
        money(e.amount),
        money(paid),
      );
      if (next !== e.status)
        await tx.financeExpense.update({
          where: { id: e.id },
          data: { status: next },
        });
      await recordFinanceAudit(tx, {
        entityType: 'EXPENSE_PAYMENT',
        entityId: paymentId,
        action: 'VOIDED',
        actorUserId: actor.userId,
        before: { voided: false },
        after: { voided: true },
        note: reason,
      });
      return { id: paymentId };
    });
  }

  // ------------------------------------------------------------ attachments

  async addAttachment(
    actor: FinanceActor,
    id: string,
    file: Express.Multer.File | undefined,
    confirmDuplicate: boolean,
  ): Promise<{ id: string }> {
    const e = await this.loadVisible(actor, id);
    if (e.status === 'CANCELLED')
      throw invalidState('Receipts cannot be added to a cancelled expense.');
    if (!actor.manage && e.createdByUserId !== actor.userId) throw forbidden();
    if (!file?.buffer?.length) throw invalid('Choose a receipt file.');
    if (file.size > FINANCE_ATTACHMENT_MAX_BYTES)
      throw invalid('Receipts can be up to 5 MB.');
    if (
      !(FINANCE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(
        file.mimetype,
      )
    )
      throw invalid('Upload a JPG, PNG, WebP image or a PDF.');
    if (!this.contentMatchesType(file.buffer, file.mimetype))
      throw invalid('That file is not the kind of file its name says.');
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const same = await this.prisma.financeAttachment.findFirst({
      where: { sha256, expenseId: { not: null } },
      include: { expense: { select: { id: true, number: true } } },
    });
    if (same?.expenseId === id)
      throw new AppException(
        FinanceErrorCode.DUPLICATE_ATTACHMENT,
        'This receipt is already attached to this expense.',
        HttpStatus.CONFLICT,
      );
    if (same && !confirmDuplicate)
      throw new AppException(
        FinanceErrorCode.DUPLICATE_ATTACHMENT,
        `The same file is already attached to ${same.expense?.number}. Upload again to confirm it belongs to both.`,
        HttpStatus.CONFLICT,
        { expenseId: same.expense?.id, expenseNumber: same.expense?.number },
      );
    // Private object storage (Cloudflare R2) when configured; the database keeps only the key.
    const storageKey = this.files.isConfigured
      ? `finance/receipts/${id}/${randomUUID()}`
      : null;
    if (storageKey)
      await this.files.put(storageKey, file.buffer, file.mimetype);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.financeAttachment.create({
          data: {
            expenseId: id,
            fileName: file.originalname.slice(0, 200) || 'receipt',
            mimeType: file.mimetype,
            sizeBytes: file.size,
            sha256,
            ...(storageKey ? { storageKey } : { data: file.buffer }),
            uploadedByUserId: actor.userId,
          },
        });
        await recordFinanceAudit(tx, {
          entityType: 'ATTACHMENT',
          entityId: row.id,
          action: 'UPLOADED',
          actorUserId: actor.userId,
          after: {
            expenseId: id,
            fileName: row.fileName,
            sizeBytes: row.sizeBytes,
            sha256,
          },
        });
        return { id: row.id };
      });
    } catch (err) {
      if (storageKey) await this.files.delete(storageKey);
      throw err;
    }
  }

  private contentMatchesType(buffer: Buffer, mime: string): boolean {
    const head = buffer.subarray(0, 12);
    if (mime === 'application/pdf')
      return head.subarray(0, 4).toString('latin1') === '%PDF';
    if (mime === 'image/png')
      return (
        head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG'
      );
    if (mime === 'image/jpeg') return head[0] === 0xff && head[1] === 0xd8;
    if (mime === 'image/webp')
      return (
        head.subarray(0, 4).toString('latin1') === 'RIFF' &&
        head.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    return false;
  }

  async attachment(actor: FinanceActor, attachmentId: string) {
    const a = await this.prisma.financeAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!a?.expenseId) throw notFound('That receipt');
    await this.loadVisible(actor, a.expenseId);
    const data = a.storageKey
      ? await this.files.get(a.storageKey)
      : a.data
        ? Buffer.from(a.data)
        : null;
    if (!data) throw notFound('That receipt');
    return {
      fileName: a.fileName,
      mimeType: a.mimeType,
      data,
    };
  }

  async removeAttachment(
    actor: FinanceActor,
    attachmentId: string,
  ): Promise<{ id: string }> {
    const a = await this.prisma.financeAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        expenseId: true,
        fileName: true,
        sha256: true,
        storageKey: true,
      },
    });
    if (!a?.expenseId) throw notFound('That receipt');
    const e = await this.loadVisible(actor, a.expenseId);
    if (!this.permissions(actor, e).edit)
      throw forbidden(
        'Receipts can only be removed while the expense is still editable.',
      );
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.financeAttachment.delete({ where: { id: attachmentId } });
      await recordFinanceAudit(tx, {
        entityType: 'ATTACHMENT',
        entityId: attachmentId,
        action: 'REMOVED',
        actorUserId: actor.userId,
        before: {
          expenseId: a.expenseId,
          fileName: a.fileName,
          sha256: a.sha256,
        },
      });
      return { id: attachmentId };
    });
    if (a.storageKey) await this.files.delete(a.storageKey);
    return removed;
  }
}
