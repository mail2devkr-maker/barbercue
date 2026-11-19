import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type FinanceAuditEntity =
  | 'EXPENSE'
  | 'EXPENSE_PAYMENT'
  | 'ATTACHMENT'
  | 'FUNDING'
  | 'REIMBURSEMENT'
  | 'PAYOUT'
  | 'CATEGORY'
  | 'CONTRIBUTOR'
  | 'ACCOUNT'
  | 'VENDOR';

/** Field-by-field differences between two plain snapshots (only changed fields). */
export function diffSnapshots(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> | null {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    const from = normalise(before?.[key]);
    const to = normalise(after?.[key]);
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes[key] = { from, to };
  }
  return Object.keys(changes).length ? changes : null;
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Appends one immutable audit event (the table rejects updates and deletes). */
export async function recordFinanceAudit(
  tx: Tx,
  event: {
    entityType: FinanceAuditEntity;
    entityId: string;
    action: string;
    actorUserId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    note?: string | null;
  },
): Promise<void> {
  const changes = diffSnapshots(event.before ?? null, event.after ?? null);
  await tx.financeAuditEvent.create({
    data: {
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actorUserId: event.actorUserId,
      changes: (changes ?? undefined) as Prisma.InputJsonValue | undefined,
      note: event.note ?? null,
    },
  });
}
