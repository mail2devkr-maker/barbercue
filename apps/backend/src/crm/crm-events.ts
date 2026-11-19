import { Prisma, type PrismaClient } from '@prisma/client';
import { CRM_LEAD_STATUS_META, type CrmLeadStatus } from '@barbercue/shared';

type Db = Prisma.TransactionClient | PrismaClient;

/** One row on the lead's timeline. Call inside the same transaction as the change it records. */
export async function logLeadActivity(
  db: Db,
  leadId: string,
  actorUserId: string | null,
  type: string,
  summary: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.crmLeadActivity.create({
    data: {
      leadId,
      actorUserId,
      type: type.slice(0, 40),
      summary: summary.slice(0, 500),
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export type CrmNotificationType =
  | 'crm.lead_assigned'
  | 'crm.task_assigned'
  | 'crm.task_overdue'
  | 'crm.call_due'
  | 'crm.meeting_reminder'
  | 'crm.follow_up_missed'
  | 'crm.onboarding_incomplete'
  | 'crm.onboarding_decision'
  | 'crm.ticket_update'
  | 'crm.analysis_completed';

/**
 * In-app CRM notification for the employee's CRM inbox. `dedupeKey` prevents the same reminder
 * twice: an unread notification with the same type and key is reused instead of duplicated.
 * Email / SMS / WhatsApp delivery is a later, optional integration.
 */
export async function notifyCrm(
  db: Db,
  userId: string,
  type: CrmNotificationType,
  title: string,
  body: string | null,
  deepLink: string | null,
  dedupeKey: string,
): Promise<boolean> {
  const existing = await db.notification.findFirst({
    where: {
      userId,
      type,
      readAt: null,
      payload: { path: ['dedupeKey'], equals: dedupeKey },
    },
    select: { id: true },
  });
  if (existing) return false;
  await db.notification.create({
    data: {
      userId,
      channel: 'IN_APP',
      type,
      payload: {
        title: title.slice(0, 200),
        body: body?.slice(0, 500) ?? null,
        dedupeKey,
      },
      status: 'SENT',
      sentAt: new Date(),
      deepLink,
    },
  });
  return true;
}

/** Lead status that mirrors an onboarding application status (null = leave the lead alone). */
export function leadStatusForOnboarding(status: string): CrmLeadStatus | null {
  switch (status) {
    case 'DRAFT':
    case 'CHANGES_REQUESTED':
      return 'ONBOARDING_STARTED';
    case 'SUBMITTED':
    case 'RESUBMITTED':
    case 'UNDER_REVIEW':
      return 'PENDING_APPROVAL';
    case 'APPROVED':
    case 'OWNER_INVITED':
    case 'AWAITING_OWNER_ACTIVATION':
    case 'READY_TO_PUBLISH':
      return 'APPROVED';
    case 'ACTIVE':
      return 'ONBOARDED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return null;
  }
}

/**
 * Keeps the lead in step with its onboarding application (onboarding is the source of truth for
 * approval/activation; the lead shows where the salon is in the journey) and writes the timeline
 * entry and the employee's notification. Called from every onboarding status change.
 */
export async function syncLeadFromOnboarding(
  db: Db,
  applicationId: string,
  previous: string | null,
  next: string,
  actorUserId: string | null,
  reason?: string | null,
): Promise<void> {
  const app = await db.salonOnboardingApplication.findUnique({
    where: { id: applicationId },
    select: {
      leadId: true,
      reference: true,
      salonName: true,
      assignedEmployee: { select: { userId: true } },
    },
  });
  if (!app) return;
  const status = leadStatusForOnboarding(next);
  if (status) {
    await db.employeeCrmLead.update({
      where: { id: app.leadId },
      data: {
        status,
        ...(status === 'ONBOARDED' ? { onboardedAt: new Date() } : {}),
      },
    });
  }
  await logLeadActivity(
    db,
    app.leadId,
    actorUserId,
    'ONBOARDING_STATUS',
    `Onboarding ${app.reference}: ${previous ? `${previous.toLowerCase()} → ` : ''}${next.toLowerCase().replace(/_/g, ' ')}${status ? ` (lead: ${CRM_LEAD_STATUS_META[status].label})` : ''}`,
    {
      applicationId,
      previous,
      next,
      reason: reason ?? null,
    },
  );
  if (
    ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'ACTIVE'].includes(next) &&
    app.assignedEmployee.userId !== actorUserId
  ) {
    const verb =
      next === 'APPROVED'
        ? 'was approved'
        : next === 'ACTIVE'
          ? 'is now live'
          : next === 'REJECTED'
            ? 'was rejected'
            : 'needs changes';
    await notifyCrm(
      db,
      app.assignedEmployee.userId,
      'crm.onboarding_decision',
      `${app.salonName} ${verb}`,
      reason ?? null,
      `/employee/onboarding/${applicationId}`,
      `onboarding:${applicationId}:${next}`,
    );
  }
}
