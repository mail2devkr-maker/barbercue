import { randomInt } from 'crypto';
import {
  Prisma,
  WorkAssignmentStatus,
  WorkJobStatus,
  WorkOrgStatus,
  type WorkAssignment,
  type WorkCategory,
  type WorkJob,
  type WorkOrganization,
} from '@prisma/client';
import {
  WORK_ASSIGNMENT_ACTIVE_STATUSES,
  workCancellationTermsSchema,
  workChecklistItemSchema,
  type WorkCancellationTerms,
  type WorkChecklistItem,
  type WorkEmployerTrustDto,
  type WorkJobCardDto,
  type WorkJobDetailDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

export type Db = PrismaService | Prisma.TransactionClient;

export type JobWithRefs = WorkJob & {
  org: WorkOrganization;
  category: WorkCategory;
};
export const JOB_REFS = { org: true, category: true } as const;

export const ACTIVE_ASSIGNMENT_STATUSES =
  WORK_ASSIGNMENT_ACTIVE_STATUSES as WorkAssignmentStatus[];

/** Row lock on a job for the rest of the transaction — serializes capacity changes. */
export async function lockJob(
  tx: Prisma.TransactionClient,
  jobId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "work_jobs" WHERE "id" = ${jobId} FOR UPDATE`;
}

export async function lockAssignment(
  tx: Prisma.TransactionClient,
  assignmentId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "work_assignments" WHERE "id" = ${assignmentId} FOR UPDATE`;
}

export async function lockPayout(
  tx: Prisma.TransactionClient,
  payoutId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "work_payouts" WHERE "id" = ${payoutId} FOR UPDATE`;
}

export async function lockFunding(
  tx: Prisma.TransactionClient,
  fundingId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "work_fundings" WHERE "id" = ${fundingId} FOR UPDATE`;
}

/** Six digits, shown by the employer on site for QR / code check-in. Not a secret credential. */
export function newCheckInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Case, spacing and punctuation-insensitive form used to detect a repeated answer (e.g. a shop phone). */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function maskVpa(vpa: string | null): string | null {
  if (!vpa) return null;
  const [name, handle] = vpa.split('@');
  if (!handle) return '••••';
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(2, name.length - 2))}@${handle}`;
}

export function parseChecklist(raw: Prisma.JsonValue): WorkChecklistItem[] {
  return workChecklistItemSchema.array().parse(raw);
}

export function parseTerms(raw: Prisma.JsonValue): WorkCancellationTerms {
  return workCancellationTermsSchema.parse(raw);
}

export function isPubliclyVisible(job: JobWithRefs): boolean {
  return (
    job.org.status === WorkOrgStatus.VERIFIED &&
    (
      [
        WorkJobStatus.OPEN,
        WorkJobStatus.PARTIALLY_FILLED,
        WorkJobStatus.FILLED,
        WorkJobStatus.IN_PROGRESS,
      ] as WorkJobStatus[]
    ).includes(job.status)
  );
}

/** A job only reaches OPEN through a provider-confirmed funding webhook, so OPEN-or-later means funded. */
export function isFunded(job: WorkJob): boolean {
  return (
    !(
      [
        WorkJobStatus.DRAFT,
        WorkJobStatus.PENDING_VERIFICATION,
        WorkJobStatus.FUNDING_REQUIRED,
        WorkJobStatus.REJECTED,
      ] as WorkJobStatus[]
    ).includes(job.status) && job.publishedAt !== null
  );
}

export async function employerTrust(
  db: Db,
  orgs: WorkOrganization[],
): Promise<Map<string, WorkEmployerTrustDto>> {
  const ids = orgs.map((o) => o.id);
  const out = new Map<string, WorkEmployerTrustDto>();
  if (!ids.length) return out;
  const stats = await db.$queryRaw<
    { orgId: string; paid: bigint; reviewed: bigint; onTime: bigint }[]
  >`
    SELECT j."orgId" AS "orgId",
      COUNT(*) FILTER (WHERE a."status" = 'PAID')::bigint AS paid,
      COUNT(*) FILTER (WHERE a."reviewedAt" IS NOT NULL AND a."reviewDueAt" IS NOT NULL)::bigint AS reviewed,
      COUNT(*) FILTER (WHERE a."reviewedAt" IS NOT NULL AND a."reviewDueAt" IS NOT NULL AND a."reviewedAt" <= a."reviewDueAt")::bigint AS "onTime"
    FROM "work_assignments" a JOIN "work_jobs" j ON j."id" = a."jobId"
    WHERE j."orgId" IN (${Prisma.join(ids)})
    GROUP BY j."orgId"`;
  const cancels = await db.workAuditEvent.groupBy({
    by: ['orgId'],
    where: { orgId: { in: ids }, action: 'EMPLOYER_CANCELLED_ASSIGNMENT' },
    _count: { _all: true },
  });
  for (const org of orgs) {
    const s = stats.find((x) => x.orgId === org.id);
    const reviewed = Number(s?.reviewed ?? 0);
    out.set(org.id, {
      orgId: org.id,
      displayName: org.displayName,
      verified: org.status === WorkOrgStatus.VERIFIED,
      completedAssignments: Number(s?.paid ?? 0),
      onTimeReviewRate: reviewed ? Number(s?.onTime ?? 0) / reviewed : null,
      employerCancellations:
        cancels.find((c) => c.orgId === org.id)?._count._all ?? 0,
    });
  }
  return out;
}

export function toJobCard(
  job: JobWithRefs,
  trust: WorkEmployerTrustDto,
): WorkJobCardDto {
  return {
    id: job.id,
    title: job.title,
    categorySlug: job.category.slug,
    categoryName: job.category.name,
    employer: trust,
    city: job.city,
    locality: job.locality,
    locationType: job.locationType,
    startsAt: job.startsAt.toISOString(),
    endsAt: job.endsAt.toISOString(),
    payType: job.payType,
    payPerWorkerPaise: job.payPerWorkerPaise,
    bonusDescription: job.bonusDescription,
    positions: job.positions,
    slotsLeft: Math.max(0, job.positions - job.filledCount),
    hiringMode: job.hiringMode,
    status: job.status,
    funded: isFunded(job),
    minAge: job.minAge,
    minVerificationLevel: job.minVerificationLevel,
    requiredSkills: job.requiredSkills,
  };
}

export function toJobDetail(
  job: JobWithRefs,
  trust: WorkEmployerTrustDto,
): WorkJobDetailDto {
  return {
    ...toJobCard(job, trust),
    description: job.description,
    addressLine: job.addressLine,
    applicationDeadline: job.applicationDeadline?.toISOString() ?? null,
    languages: job.languages,
    requiresCheckIn: job.requiresCheckIn,
    checklist: parseChecklist(job.checklist),
    completionCriteria: job.completionCriteria,
    cancellationTerms: parseTerms(job.cancellationTerms),
    reviewWindowHours: job.reviewWindowHours,
  };
}

/** Terms frozen onto an assignment at the moment the worker accepts. */
export function termsSnapshot(job: WorkJob): Prisma.InputJsonValue {
  return {
    jobVersion: job.version,
    payType: job.payType,
    payPerWorkerPaise: job.payPerWorkerPaise,
    bonusDescription: job.bonusDescription,
    startsAt: job.startsAt.toISOString(),
    endsAt: job.endsAt.toISOString(),
    checklist: job.checklist as Prisma.InputJsonValue,
    completionCriteria: job.completionCriteria,
    cancellationTerms: job.cancellationTerms as Prisma.InputJsonValue,
    reviewWindowHours: job.reviewWindowHours,
    feeBps: job.feeBps,
  };
}

export function snapshotChecklist(a: WorkAssignment): WorkChecklistItem[] {
  return parseChecklist(
    (a.termsSnapshot as unknown as { checklist: Prisma.JsonValue }).checklist,
  );
}

export function snapshotTerms(a: WorkAssignment): WorkCancellationTerms {
  return parseTerms(
    (a.termsSnapshot as unknown as { cancellationTerms: Prisma.JsonValue })
      .cancellationTerms,
  );
}

export function snapshotFeeBps(a: WorkAssignment): number {
  return (a.termsSnapshot as unknown as { feeBps: number }).feeBps;
}

export function snapshotReviewHours(a: WorkAssignment): number {
  return (a.termsSnapshot as unknown as { reviewWindowHours: number })
    .reviewWindowHours;
}
