import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Chart of accounts. Amounts are signed integer paise: positive = debit, negative = credit.
 *
 *   PROVIDER_HELD                 asset      money the payment provider holds for the platform
 *   EMPLOYER_PREFUND:<orgId>      liability  employer money funded but not yet earned or released
 *   WORKER_PAYABLE:<userId>       liability  earned pay owed to a worker, not yet paid out
 *   PLATFORM_FEE_REVENUE          revenue    the platform's disclosed employer-side fee
 *
 * Postings (each journal sums to zero; a deferred trigger enforces it at commit):
 *   FUNDING_RECEIVED   +PROVIDER_HELD            −EMPLOYER_PREFUND
 *   WORK_APPROVED      +EMPLOYER_PREFUND (pay+fee) −WORKER_PAYABLE (pay) −PLATFORM_FEE_REVENUE (fee)
 *   PAYOUT_SETTLED     +WORKER_PAYABLE           −PROVIDER_HELD
 *   FUNDS_RELEASED     +EMPLOYER_PREFUND         −PROVIDER_HELD
 *
 * A failed payout posts nothing: the worker's payable balance simply stays, which is exactly the
 * "never lose a payment obligation" rule. Balances are always computed by summing entries; no
 * balance column exists anywhere to drift.
 */
export const WorkAccount = {
  providerHeld: 'PROVIDER_HELD',
  platformFees: 'PLATFORM_FEE_REVENUE',
  employerPrefund: (orgId: string) => `EMPLOYER_PREFUND:${orgId}`,
  workerPayable: (userId: string) => `WORKER_PAYABLE:${userId}`,
} as const;

export type WorkJournalKind = 'FUNDING_RECEIVED' | 'WORK_APPROVED' | 'PAYOUT_SETTLED' | 'FUNDS_RELEASED';

export interface WorkJournalInput {
  kind: WorkJournalKind;
  /** Deterministic per business event, e.g. `approve:<assignmentId>`. A repeat is a no-op. */
  idempotencyKey: string;
  memo?: string;
  jobId?: string | null;
  assignmentId?: string | null;
  entries: { account: string; amountPaise: number }[];
}

@Injectable()
export class WorkLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Posts a balanced journal on the caller's transaction. Returns false (and writes nothing) when
   * a journal with the same idempotency key already exists, so retried webhooks, sweeps and
   * double-clicks can never double-post. Zero-amount lines are dropped; the journal must still
   * balance and have at least two lines.
   */
  async post(db: Db, input: WorkJournalInput): Promise<boolean> {
    const entries = input.entries.filter((e) => e.amountPaise !== 0);
    for (const e of entries) {
      if (!Number.isSafeInteger(e.amountPaise)) throw new Error('ledger amounts must be integers');
    }
    const sum = entries.reduce((acc, e) => acc + e.amountPaise, 0);
    if (sum !== 0 || entries.length < 2) {
      throw new Error(`unbalanced ${input.kind} journal (sum ${sum}, ${entries.length} lines)`);
    }
    const journalId = randomUUID();
    // ON CONFLICT DO NOTHING rather than catching a unique violation: inside a Postgres
    // transaction a failed INSERT aborts the whole transaction.
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "work_ledger_journals" ("id", "kind", "idempotencyKey", "memo", "jobId", "assignmentId")
      VALUES (${journalId}, ${input.kind}, ${input.idempotencyKey}, ${input.memo ?? null}, ${input.jobId ?? null}, ${input.assignmentId ?? null})
      ON CONFLICT ("idempotencyKey") DO NOTHING
      RETURNING "id"`;
    if (inserted.length === 0) return false;
    await db.workLedgerEntry.createMany({
      data: entries.map((e) => ({
        id: randomUUID(),
        journalId,
        accountCode: e.account,
        amountPaise: e.amountPaise,
      })),
    });
    return true;
  }

  /** Signed balance (debit positive) of one account. */
  async balance(db: Db, account: string): Promise<number> {
    const agg = await db.workLedgerEntry.aggregate({
      where: { accountCode: account },
      _sum: { amountPaise: true },
    });
    return agg._sum.amountPaise ?? 0;
  }

  /** What the employer still has committed to one job (positive = unused prefund). */
  async jobPrefundRemaining(db: Db, orgId: string, jobId: string): Promise<number> {
    const rows = await db.$queryRaw<{ total: bigint | null }[]>`
      SELECT SUM(e."amountPaise")::bigint AS total
      FROM "work_ledger_entries" e JOIN "work_ledger_journals" j ON j."id" = e."journalId"
      WHERE j."jobId" = ${jobId} AND e."accountCode" = ${WorkAccount.employerPrefund(orgId)}`;
    return -Number(rows[0]?.total ?? 0);
  }

  /** Sum per journal kind of one account's movements for a set of journals filtered by job ids. */
  async orgTotals(db: Db, orgId: string): Promise<{ funded: number; approvedPay: number; fees: number; released: number; paidOut: number; owedToWorkers: number }> {
    const rows = await db.$queryRaw<{ kind: string; account: string; total: bigint }[]>`
      SELECT j."kind" AS kind, e."accountCode" AS account, SUM(e."amountPaise")::bigint AS total
      FROM "work_ledger_entries" e
      JOIN "work_ledger_journals" j ON j."id" = e."journalId"
      JOIN "work_jobs" w ON w."id" = j."jobId"
      WHERE w."orgId" = ${orgId}
      GROUP BY j."kind", e."accountCode"`;
    const pick = (kind: string, pred: (a: string) => boolean) =>
      rows.filter((r) => r.kind === kind && pred(r.account)).reduce((acc, r) => acc + Number(r.total), 0);
    const funded = pick('FUNDING_RECEIVED', (a) => a === WorkAccount.providerHeld);
    const approvedPay = -pick('WORK_APPROVED', (a) => a.startsWith('WORKER_PAYABLE:'));
    const fees = -pick('WORK_APPROVED', (a) => a === WorkAccount.platformFees);
    const released = -pick('FUNDS_RELEASED', (a) => a === WorkAccount.providerHeld);
    const paidOut = -pick('PAYOUT_SETTLED', (a) => a === WorkAccount.providerHeld);
    return { funded, approvedPay, fees, released, paidOut, owedToWorkers: approvedPay - paidOut };
  }

  /** Trial balance across every account plus the list of any journal that does not sum to zero. */
  async trialBalance(): Promise<{ accounts: { accountCode: string; balancePaise: number }[]; unbalancedJournals: string[] }> {
    const accounts = await this.prisma.$queryRaw<{ accountCode: string; total: bigint }[]>`
      SELECT "accountCode", SUM("amountPaise")::bigint AS total FROM "work_ledger_entries" GROUP BY "accountCode" ORDER BY "accountCode"`;
    const unbalanced = await this.prisma.$queryRaw<{ journalId: string }[]>`
      SELECT "journalId" FROM "work_ledger_entries" GROUP BY "journalId" HAVING SUM("amountPaise") <> 0 OR COUNT(*) < 2`;
    return {
      accounts: accounts.map((a) => ({ accountCode: a.accountCode, balancePaise: Number(a.total) })),
      unbalancedJournals: unbalanced.map((u) => u.journalId),
    };
  }
}
