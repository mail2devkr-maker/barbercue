import { Injectable } from '@nestjs/common';
import { Prisma, WorkParty } from '@prisma/client';
import type { WorkAuditEventDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface WorkAuditInput {
  entityType:
    | 'ORG'
    | 'WORKER'
    | 'JOB'
    | 'APPLICATION'
    | 'ASSIGNMENT'
    | 'FUNDING'
    | 'PAYOUT'
    | 'DISPUTE'
    | 'WEBHOOK';
  entityId: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorUserId?: string | null;
  actorParty: WorkParty;
  orgId?: string | null;
  jobId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only marketplace history. Always written on the same transaction as the change it
 * describes, so a state change and its audit record commit or roll back together. The table has
 * a trigger that rejects UPDATE and DELETE (see the migration), so history cannot be rewritten.
 * Metadata must never contain document images, full UPI IDs or provider secrets.
 */
@Injectable()
export class WorkAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(db: Db, input: WorkAuditInput): Promise<void> {
    await db.workAuditEvent.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        actorUserId: input.actorUserId ?? null,
        actorParty: input.actorParty,
        orgId: input.orgId ?? null,
        jobId: input.jobId ?? null,
        note: input.note ?? null,
        metadata: (input.metadata ?? undefined) as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  async timeline(
    entityType: string,
    entityId: string,
  ): Promise<WorkAuditEventDto[]> {
    const rows = await this.prisma.workAuditEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      actorParty: r.actorParty,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
