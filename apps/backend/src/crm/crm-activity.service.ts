import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CRM_CALL_OUTCOME_LABEL,
  CRM_LEAD_STATUS_META,
  CRM_MEETING_STATUS_LABEL,
  CRM_TASK_STATUS_LABEL,
  leadStatusAfterCall,
  type CrmCallDto,
  type CrmCallInput,
  type CrmCallLogInput,
  type CrmCallQueueDto,
  type CrmMeetingDto,
  type CrmMeetingInput,
  type CrmMeetingUpdateInput,
  type CrmPageDto,
  type CrmRangeQuery,
  type CrmTaskDto,
  type CrmTaskInput,
  type CrmTaskListQuery,
  type CrmTaskStatus,
  type CrmTaskUpdateInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  CrmAccessService,
  notFound,
  type CrmActor,
} from './crm-access.service';
import { logLeadActivity, notifyCrm } from './crm-events';
import { employeeSelect, toEmployeeRef } from './crm-leads.service';

const taskInclude = {
  lead: { select: { id: true, shopName: true } },
  assignee: { select: employeeSelect },
  createdBy: {
    select: { email: true, employeeProfile: { select: { fullName: true } } },
  },
} satisfies Prisma.CrmTaskInclude;
const meetingInclude = {
  lead: { select: { id: true, shopName: true } },
  employeeProfile: { select: employeeSelect },
  recordings: { where: { deletedAt: null }, select: { id: true } },
} satisfies Prisma.CrmMeetingInclude;
const callInclude = {
  lead: {
    select: {
      id: true,
      shopName: true,
      phone: true,
      contactName: true,
      ownerName: true,
      status: true,
      contactAttempts: true,
    },
  },
  employeeProfile: { select: employeeSelect },
} satisfies Prisma.CrmCallInclude;

const OPEN_TASK: CrmTaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'];
const d = (v: string | null | undefined) => (v ? new Date(v) : null);

export function toTaskDto(
  t: Prisma.CrmTaskGetPayload<{ include: typeof taskInclude }>,
  now = new Date(),
): CrmTaskDto {
  return {
    id: t.id,
    number: t.number,
    code: `T-${String(t.number).padStart(5, '0')}`,
    subject: t.subject,
    description: t.description,
    type: t.type,
    priority: t.priority,
    status: t.status,
    lead: t.lead,
    onboardingApplicationId: t.onboardingApplicationId,
    assignee: toEmployeeRef(t.assignee),
    createdBy:
      t.createdBy.employeeProfile?.fullName ?? t.createdBy.email ?? null,
    dueAt: t.dueAt?.toISOString() ?? null,
    overdue: !!t.dueAt && t.dueAt < now && OPEN_TASK.includes(t.status),
    completedAt: t.completedAt?.toISOString() ?? null,
    blockedReason: t.blockedReason,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
export function toMeetingDto(
  m: Prisma.CrmMeetingGetPayload<{ include: typeof meetingInclude }>,
): CrmMeetingDto {
  return {
    id: m.id,
    lead: m.lead,
    employee: toEmployeeRef(m.employeeProfile),
    contactName: m.contactName,
    contactPhone: m.contactPhone,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt?.toISOString() ?? null,
    mode: m.mode,
    location: m.location,
    purpose: m.purpose,
    agenda: m.agenda,
    status: m.status,
    outcome: m.outcome,
    notes: m.notes,
    nextAction: m.nextAction,
    followUpAt: m.followUpAt?.toISOString() ?? null,
    recordingIds: m.recordings.map((r) => r.id),
  };
}
export function toCallDto(
  c: Prisma.CrmCallGetPayload<{ include: typeof callInclude }>,
  now = new Date(),
): CrmCallDto {
  return {
    id: c.id,
    lead: {
      id: c.lead.id,
      shopName: c.lead.shopName,
      phone: c.lead.phone,
      contactName: c.lead.contactName ?? c.lead.ownerName,
      status: c.lead.status,
      contactAttempts: c.lead.contactAttempts,
    },
    employee: toEmployeeRef(c.employeeProfile),
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    calledAt: c.calledAt?.toISOString() ?? null,
    outcome: c.outcome,
    durationSeconds: c.durationSeconds,
    notes: c.notes,
    nextCallbackAt: c.nextCallbackAt?.toISOString() ?? null,
    interestLevel: c.interestLevel,
    nextAction: c.nextAction,
    overdue: !c.outcome && !!c.scheduledAt && c.scheduledAt < now,
  };
}
export { taskInclude, meetingInclude, callInclude };

@Injectable()
export class CrmActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CrmAccessService,
  ) {}

  private async notifyEmployee(
    tx: Prisma.TransactionClient,
    employeeProfileId: string,
    actorUserId: string,
    ...args: Parameters<typeof notifyCrm> extends [unknown, unknown, ...infer R]
      ? R
      : never
  ) {
    const emp = await tx.employeeProfile.findUnique({
      where: { id: employeeProfileId },
      select: { userId: true },
    });
    if (emp && emp.userId !== actorUserId)
      await notifyCrm(tx, emp.userId, ...args);
  }

  // ---------- Tasks ----------

  async listTasks(
    a: CrmActor,
    q: CrmTaskListQuery,
  ): Promise<CrmPageDto<CrmTaskDto>> {
    const statuses = q.status
      ?.split(',')
      .filter((s) => s in CRM_TASK_STATUS_LABEL) as CrmTaskStatus[] | undefined;
    const now = new Date();
    const where: Prisma.CrmTaskWhereInput = {
      ...(this.access.employeeScope(a, q.employeeId)
        ? { assigneeEmployeeId: this.access.employeeScope(a, q.employeeId) }
        : {}),
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.overdue === 'true'
        ? { dueAt: { lt: now }, status: { in: OPEN_TASK } }
        : {}),
      ...(q.from || q.to
        ? {
            dueAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { subject: { contains: q.q, mode: 'insensitive' } },
              { lead: { shopName: { contains: q.q, mode: 'insensitive' } } },
              ...(/^t-?\d+$/i.test(q.q)
                ? [{ number: Number(q.q.replace(/\D/g, '')) }]
                : []),
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.crmTask.count({ where }),
      this.prisma.crmTask.findMany({
        where,
        include: taskInclude,
        orderBy: [
          { dueAt: { sort: 'asc', nulls: 'last' } },
          { number: 'desc' },
        ],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    return {
      items: rows.map((t) => toTaskDto(t, now)),
      total,
      page: q.page,
      pageSize: q.limit,
    };
  }

  private async taskFor(a: CrmActor, id: string) {
    const t = await this.prisma.crmTask.findUnique({ where: { id } });
    if (!t || (!a.team && t.assigneeEmployeeId !== a.employeeProfileId))
      throw notFound('Task');
    return t;
  }

  async createTask(a: CrmActor, input: CrmTaskInput): Promise<CrmTaskDto> {
    this.access.assertWrite(a);
    const lead = input.leadId ? await this.access.lead(a, input.leadId) : null;
    const assignee = await this.access.ownerFor(
      a,
      input.assigneeEmployeeId,
      lead?.employeeProfileId,
    );
    const row = await this.prisma.$transaction(async (tx) => {
      const t = await tx.crmTask.create({
        data: {
          subject: input.subject.trim(),
          description: input.description?.trim() || null,
          type: input.type,
          priority: input.priority,
          leadId: lead?.id ?? null,
          onboardingApplicationId: input.onboardingApplicationId ?? null,
          assigneeEmployeeId: assignee,
          createdByUserId: a.userId,
          dueAt: d(input.dueAt),
        },
        include: taskInclude,
      });
      if (lead)
        await logLeadActivity(
          tx,
          lead.id,
          a.userId,
          'TASK_CREATED',
          `Task ${`T-${String(t.number).padStart(5, '0')}`}: ${t.subject}`,
          { taskId: t.id },
        );
      await this.notifyEmployee(
        tx,
        assignee,
        a.userId,
        'crm.task_assigned',
        `New task: ${t.subject}`,
        t.dueAt ? `Due ${t.dueAt.toISOString()}` : null,
        `/employee/activity/tasks?task=${t.id}`,
        `task:${t.id}`,
      );
      return t;
    });
    return toTaskDto(row);
  }

  async updateTask(
    a: CrmActor,
    id: string,
    input: CrmTaskUpdateInput,
  ): Promise<CrmTaskDto> {
    this.access.assertWrite(a);
    const before = await this.taskFor(a, id);
    if (
      input.assigneeEmployeeId &&
      input.assigneeEmployeeId !== before.assigneeEmployeeId &&
      !a.team
    )
      throw new AppException(
        'CRM_FORBIDDEN',
        'Only managers can reassign tasks.',
        HttpStatus.FORBIDDEN,
      );
    if (input.leadId && input.leadId !== before.leadId)
      await this.access.lead(a, input.leadId);
    if (
      input.status === 'BLOCKED' &&
      !input.blockedReason &&
      !before.blockedReason
    )
      throw new AppException(
        'CRM_BLOCKED_REASON',
        'Say why the task is blocked.',
        HttpStatus.BAD_REQUEST,
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const t = await tx.crmTask.update({
        where: { id },
        data: {
          ...(input.subject !== undefined
            ? { subject: input.subject.trim() }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
          ...(input.dueAt !== undefined ? { dueAt: d(input.dueAt) } : {}),
          ...(input.assigneeEmployeeId
            ? { assigneeEmployeeId: input.assigneeEmployeeId }
            : {}),
          ...(input.status
            ? {
                status: input.status,
                completedAt: input.status === 'COMPLETED' ? new Date() : null,
              }
            : {}),
          ...(input.blockedReason !== undefined
            ? { blockedReason: input.blockedReason?.trim() || null }
            : {}),
        },
        include: taskInclude,
      });
      const what: string[] = [];
      if (input.status && input.status !== before.status)
        what.push(
          `${CRM_TASK_STATUS_LABEL[before.status]} → ${CRM_TASK_STATUS_LABEL[input.status]}`,
        );
      if (
        input.dueAt !== undefined &&
        d(input.dueAt)?.getTime() !== before.dueAt?.getTime()
      )
        what.push('rescheduled');
      if (
        input.assigneeEmployeeId &&
        input.assigneeEmployeeId !== before.assigneeEmployeeId
      )
        what.push(`reassigned to ${t.assignee.fullName}`);
      if (t.leadId && what.length)
        await logLeadActivity(
          tx,
          t.leadId,
          a.userId,
          'TASK_UPDATED',
          `Task T-${String(t.number).padStart(5, '0')} ${what.join(', ')}`,
          { taskId: t.id },
        );
      await tx.auditLog.create({
        data: {
          actorUserId: a.userId,
          action: 'CRM_TASK_UPDATED',
          entityType: 'CrmTask',
          entityId: id,
          metadata: { changes: Object.keys(input) },
        },
      });
      if (
        input.assigneeEmployeeId &&
        input.assigneeEmployeeId !== before.assigneeEmployeeId
      )
        await this.notifyEmployee(
          tx,
          input.assigneeEmployeeId,
          a.userId,
          'crm.task_assigned',
          `Task assigned: ${t.subject}`,
          null,
          `/employee/activity/tasks?task=${t.id}`,
          `task:${t.id}:${input.assigneeEmployeeId}`,
        );
      return t;
    });
    return toTaskDto(row);
  }

  async bulkTasks(
    a: CrmActor,
    ids: string[],
    status?: CrmTaskStatus,
    assigneeEmployeeId?: string,
  ): Promise<{ updated: number }> {
    this.access.assertWrite(a);
    if (assigneeEmployeeId && !a.team)
      throw new AppException(
        'CRM_FORBIDDEN',
        'Only managers can reassign tasks.',
        HttpStatus.FORBIDDEN,
      );
    if (status === 'BLOCKED')
      throw new AppException(
        'CRM_BLOCKED_REASON',
        'Block tasks one at a time with a reason.',
        HttpStatus.BAD_REQUEST,
      );
    let updated = 0;
    for (const id of ids) {
      try {
        await this.updateTask(a, id, {
          ...(status ? { status } : {}),
          ...(assigneeEmployeeId ? { assigneeEmployeeId } : {}),
        });
        updated += 1;
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
      }
    }
    return { updated };
  }

  // ---------- Meetings ----------

  async listMeetings(a: CrmActor, q: CrmRangeQuery): Promise<CrmMeetingDto[]> {
    const emp = this.access.employeeScope(a, q.employeeId);
    const rows = await this.prisma.crmMeeting.findMany({
      where: {
        ...(emp ? { employeeProfileId: emp } : {}),
        ...(q.leadId
          ? { leadId: q.leadId, lead: this.access.leadScope(a) }
          : {}),
        ...(q.status
          ? { status: { in: q.status.split(',') as CrmMeetingDto['status'][] } }
          : {}),
        ...(q.from || q.to
          ? {
              startsAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lt: new Date(q.to) } : {}),
              },
            }
          : {}),
      },
      include: meetingInclude,
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    return rows.map(toMeetingDto);
  }

  async createMeeting(
    a: CrmActor,
    input: CrmMeetingInput,
  ): Promise<CrmMeetingDto> {
    this.access.assertWrite(a);
    const lead = await this.access.lead(a, input.leadId);
    const employee = await this.access.ownerFor(
      a,
      input.employeeId,
      lead.employeeProfileId,
    );
    const startsAt = new Date(input.startsAt);
    const row = await this.prisma.$transaction(async (tx) => {
      const m = await tx.crmMeeting.create({
        data: {
          leadId: lead.id,
          employeeProfileId: employee,
          contactName:
            input.contactName?.trim() || lead.ownerName || lead.contactName,
          contactPhone: input.contactPhone?.trim() || lead.phone,
          startsAt,
          endsAt: d(input.endsAt),
          mode: input.mode,
          location: input.location?.trim() || lead.addressLine,
          purpose: input.purpose?.trim() || null,
          agenda: input.agenda?.trim() || null,
          createdByUserId: a.userId,
        },
        include: meetingInclude,
      });
      const promote = [
        'NEW',
        'ASSIGNED',
        'CALL_PENDING',
        'CONTACT_ATTEMPTED',
        'NO_ANSWER',
        'CALLBACK_REQUESTED',
        'CONTACTED',
        'INTERESTED',
        'FOLLOW_UP',
      ].includes(lead.status);
      await tx.employeeCrmLead.update({
        where: { id: lead.id },
        data: {
          meetingAt: startsAt,
          ...(promote ? { status: 'DEMO_SCHEDULED' } : {}),
        },
      });
      await logLeadActivity(
        tx,
        lead.id,
        a.userId,
        'MEETING_SCHEDULED',
        `${m.mode.toLowerCase()} meeting on ${startsAt.toISOString()}${m.purpose ? ` — ${m.purpose}` : ''}${promote ? ` (lead: ${CRM_LEAD_STATUS_META.DEMO_SCHEDULED.label})` : ''}`,
        { meetingId: m.id },
      );
      await this.notifyEmployee(
        tx,
        employee,
        a.userId,
        'crm.meeting_reminder',
        `Meeting with ${lead.shopName}`,
        startsAt.toISOString(),
        `/employee/activity/meetings?meeting=${m.id}`,
        `meeting:${m.id}`,
      );
      return m;
    });
    return toMeetingDto(row);
  }

  async updateMeeting(
    a: CrmActor,
    id: string,
    input: CrmMeetingUpdateInput,
  ): Promise<CrmMeetingDto> {
    this.access.assertWrite(a);
    const m = await this.prisma.crmMeeting.findUnique({
      where: { id },
      include: { lead: true },
    });
    if (!m || (!a.team && m.employeeProfileId !== a.employeeProfileId))
      throw notFound('Meeting');
    if (input.status === 'COMPLETED' && !input.outcome && !m.outcome)
      throw new AppException(
        'CRM_MEETING_OUTCOME',
        'Record the meeting outcome when completing it.',
        HttpStatus.BAD_REQUEST,
      );
    if (input.employeeId && !a.team)
      throw new AppException(
        'CRM_FORBIDDEN',
        'Only managers can reassign meetings.',
        HttpStatus.FORBIDDEN,
      );
    const rescheduled =
      input.startsAt &&
      new Date(input.startsAt).getTime() !== m.startsAt.getTime();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.crmMeeting.update({
        where: { id },
        data: {
          ...(input.startsAt ? { startsAt: new Date(input.startsAt) } : {}),
          ...(input.endsAt !== undefined ? { endsAt: d(input.endsAt) } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.location !== undefined
            ? { location: input.location?.trim() || null }
            : {}),
          ...(input.purpose !== undefined
            ? { purpose: input.purpose?.trim() || null }
            : {}),
          ...(input.agenda !== undefined
            ? { agenda: input.agenda?.trim() || null }
            : {}),
          ...(input.contactName !== undefined
            ? { contactName: input.contactName?.trim() || null }
            : {}),
          ...(input.contactPhone !== undefined
            ? { contactPhone: input.contactPhone?.trim() || null }
            : {}),
          ...(input.employeeId ? { employeeProfileId: input.employeeId } : {}),
          ...(input.status
            ? { status: input.status }
            : rescheduled
              ? { status: 'RESCHEDULED' as const }
              : {}),
          ...(input.outcome !== undefined
            ? { outcome: input.outcome?.trim() || null }
            : {}),
          ...(input.notes !== undefined
            ? { notes: input.notes?.trim() || null }
            : {}),
          ...(input.nextAction !== undefined
            ? { nextAction: input.nextAction?.trim() || null }
            : {}),
          ...(input.followUpAt !== undefined
            ? { followUpAt: d(input.followUpAt) }
            : {}),
        },
        include: meetingInclude,
      });
      const status = updated.status;
      if (status === 'COMPLETED' && m.status !== 'COMPLETED') {
        const promote = [
          'DEMO_SCHEDULED',
          'INTERESTED',
          'CONTACTED',
          'FOLLOW_UP',
        ].includes(m.lead.status);
        await tx.employeeCrmLead.update({
          where: { id: m.leadId },
          data: {
            lastContactedAt: new Date(),
            ...(promote ? { status: 'MEETING_COMPLETED' } : {}),
            ...(updated.nextAction ? { nextAction: updated.nextAction } : {}),
            ...(updated.followUpAt
              ? { nextFollowUpAt: updated.followUpAt }
              : {}),
          },
        });
        if (input.createFollowUpTask && updated.followUpAt)
          await tx.crmTask.create({
            data: {
              subject: `Follow up with ${m.lead.shopName}`,
              type: 'CALL_OWNER',
              leadId: m.leadId,
              assigneeEmployeeId: updated.employeeProfileId,
              createdByUserId: a.userId,
              dueAt: updated.followUpAt,
              description: updated.nextAction,
            },
          });
      }
      if (m.status !== status || rescheduled)
        await logLeadActivity(
          tx,
          m.leadId,
          a.userId,
          'MEETING_UPDATED',
          `Meeting ${rescheduled ? `rescheduled to ${updated.startsAt.toISOString()}` : CRM_MEETING_STATUS_LABEL[status].toLowerCase()}${updated.outcome && status === 'COMPLETED' ? ` — ${updated.outcome}` : ''}`,
          { meetingId: id },
        );
      return updated;
    });
    return toMeetingDto(row);
  }

  // ---------- Calls ----------

  async listCalls(a: CrmActor, q: CrmRangeQuery): Promise<CrmCallDto[]> {
    const emp = this.access.employeeScope(a, q.employeeId);
    const now = new Date();
    const rows = await this.prisma.crmCall.findMany({
      where: {
        ...(emp ? { employeeProfileId: emp } : {}),
        ...(q.leadId
          ? { leadId: q.leadId, lead: this.access.leadScope(a) }
          : {}),
        ...(q.from || q.to
          ? {
              OR: [
                {
                  calledAt: {
                    ...(q.from ? { gte: new Date(q.from) } : {}),
                    ...(q.to ? { lt: new Date(q.to) } : {}),
                  },
                },
                {
                  calledAt: null,
                  scheduledAt: {
                    ...(q.from ? { gte: new Date(q.from) } : {}),
                    ...(q.to ? { lt: new Date(q.to) } : {}),
                  },
                },
              ],
            }
          : {}),
      },
      include: callInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((c) => toCallDto(c, now));
  }

  async callQueue(a: CrmActor, employeeId?: string): Promise<CrmCallQueueDto> {
    const emp = this.access.employeeScope(a, employeeId);
    const now = new Date();
    const IST = 330 * 60_000;
    const endOfDay = new Date(
      Date.parse(
        new Date(now.getTime() + IST).toISOString().slice(0, 10) + 'T00:00:00Z',
      ) +
        864e5 -
        IST,
    );
    const scheduled = await this.prisma.crmCall.findMany({
      where: {
        outcome: null,
        scheduledAt: { not: null, lt: endOfDay },
        ...(emp ? { employeeProfileId: emp } : {}),
      },
      include: callInclude,
      orderBy: { scheduledAt: 'asc' },
      take: 300,
    });
    const scheduledLeadIds = new Set(
      (
        await this.prisma.crmCall.findMany({
          where: { outcome: null, ...(emp ? { employeeProfileId: emp } : {}) },
          select: { leadId: true },
        })
      ).map((c) => c.leadId),
    );
    const uncalled = await this.prisma.employeeCrmLead.findMany({
      where: {
        ...(emp ? { employeeProfileId: emp } : {}),
        status: {
          in: ['NEW', 'ASSIGNED', 'CALL_PENDING', 'CALLBACK_REQUESTED'],
        },
        id: { notIn: [...scheduledLeadIds] },
      },
      select: {
        id: true,
        shopName: true,
        phone: true,
        contactName: true,
        ownerName: true,
        status: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 100,
    });
    const dtos = scheduled.map((c) => toCallDto(c, now));
    return {
      overdue: dtos.filter((c) => c.overdue),
      due: dtos.filter((c) => !c.overdue),
      uncalledLeads: uncalled.map((l) => ({
        id: l.id,
        shopName: l.shopName,
        phone: l.phone,
        contactName: l.contactName ?? l.ownerName,
        status: l.status,
      })),
    };
  }

  /** Schedule a call, or log one straight away (outcome given). */
  async createCall(a: CrmActor, input: CrmCallInput): Promise<CrmCallDto> {
    this.access.assertWrite(a);
    const lead = await this.access.lead(a, input.leadId);
    const employee = await this.access.ownerFor(
      a,
      input.employeeId,
      lead.employeeProfileId,
    );
    if (!input.outcome && !input.scheduledAt)
      throw new AppException(
        'CRM_CALL_EMPTY',
        'Schedule the call or log its outcome.',
        HttpStatus.BAD_REQUEST,
      );
    const call = await this.prisma.crmCall.create({
      data: {
        leadId: lead.id,
        employeeProfileId: employee,
        scheduledAt: d(input.scheduledAt),
        createdByUserId: a.userId,
        notes: input.notes?.trim() || null,
      },
      include: callInclude,
    });
    if (input.outcome)
      return this.logCall(a, call.id, {
        outcome: input.outcome,
        calledAt: input.calledAt,
        durationSeconds: input.durationSeconds,
        notes: input.notes,
        nextCallbackAt: input.nextCallbackAt,
        interestLevel: input.interestLevel,
        nextAction: input.nextAction,
      });
    await this.prisma.$transaction(async (tx) => {
      if (['NEW', 'ASSIGNED'].includes(lead.status))
        await tx.employeeCrmLead.update({
          where: { id: lead.id },
          data: { status: 'CALL_PENDING' },
        });
      await logLeadActivity(
        tx,
        lead.id,
        a.userId,
        'CALL_SCHEDULED',
        `Call scheduled for ${call.scheduledAt!.toISOString()}`,
        { callId: call.id },
      );
      await this.notifyEmployee(
        tx,
        employee,
        a.userId,
        'crm.call_due',
        `Call ${lead.shopName}`,
        call.scheduledAt!.toISOString(),
        `/employee/activity/calls`,
        `call:${call.id}`,
      );
    });
    return toCallDto(
      await this.prisma.crmCall.findUniqueOrThrow({
        where: { id: call.id },
        include: callInclude,
      }),
    );
  }

  /** Log the outcome the employee reports (manual; FastQue does not record or monitor phone calls). */
  async logCall(
    a: CrmActor,
    id: string,
    input: CrmCallLogInput,
  ): Promise<CrmCallDto> {
    this.access.assertWrite(a);
    const call = await this.prisma.crmCall.findUnique({
      where: { id },
      include: { lead: true },
    });
    if (!call || (!a.team && call.employeeProfileId !== a.employeeProfileId))
      throw notFound('Call');
    if (call.outcome)
      throw new AppException(
        'CRM_CALL_LOGGED',
        'This call already has an outcome. Log a new call instead.',
        HttpStatus.CONFLICT,
      );
    if (input.outcome === 'MEETING_SCHEDULED' && !input.meetingAt)
      throw new AppException(
        'CRM_MEETING_TIME',
        'Pick the meeting time.',
        HttpStatus.BAD_REQUEST,
      );
    const calledAt = d(input.calledAt) ?? new Date();
    const next = leadStatusAfterCall(call.lead.status, input.outcome);
    await this.prisma.$transaction(async (tx) => {
      await tx.crmCall.update({
        where: { id },
        data: {
          outcome: input.outcome,
          calledAt,
          durationSeconds: input.durationSeconds ?? null,
          notes: input.notes?.trim() || call.notes,
          nextCallbackAt: d(input.nextCallbackAt),
          interestLevel: input.interestLevel ?? null,
          nextAction: input.nextAction?.trim() || null,
        },
      });
      await tx.employeeCrmLead.update({
        where: { id: call.leadId },
        data: {
          contactAttempts: { increment: 1 },
          lastContactedAt: calledAt,
          ...(next ? { status: next } : {}),
          ...(input.interestLevel
            ? { interestLevel: input.interestLevel }
            : {}),
          ...(input.nextAction ? { nextAction: input.nextAction.trim() } : {}),
          ...(input.nextCallbackAt
            ? { nextFollowUpAt: new Date(input.nextCallbackAt) }
            : {}),
        },
      });
      await logLeadActivity(
        tx,
        call.leadId,
        a.userId,
        'CALL_LOGGED',
        `Call: ${CRM_CALL_OUTCOME_LABEL[input.outcome]}${input.notes ? ` — ${input.notes.trim().slice(0, 200)}` : ''}${next ? ` (lead: ${CRM_LEAD_STATUS_META[next].label})` : ''}`,
        { callId: id, outcome: input.outcome },
      );
      if (input.nextCallbackAt) {
        const followUp = await tx.crmCall.create({
          data: {
            leadId: call.leadId,
            employeeProfileId: call.employeeProfileId,
            scheduledAt: new Date(input.nextCallbackAt),
            createdByUserId: a.userId,
            notes: 'Callback',
          },
        });
        await logLeadActivity(
          tx,
          call.leadId,
          a.userId,
          'CALL_SCHEDULED',
          `Callback scheduled for ${input.nextCallbackAt}`,
          { callId: followUp.id },
        );
      }
    });
    if (input.outcome === 'MEETING_SCHEDULED' && input.meetingAt)
      await this.createMeeting(a, {
        leadId: call.leadId,
        startsAt: input.meetingAt,
        mode: 'PHYSICAL',
        purpose: 'Sales meeting (from call)',
        employeeId: a.team ? call.employeeProfileId : undefined,
      });
    return toCallDto(
      await this.prisma.crmCall.findUniqueOrThrow({
        where: { id },
        include: callInclude,
      }),
    );
  }

  /**
   * Reminder sweep (call from the scheduler): overdue tasks, missed follow-ups, calls due, meetings
   * within the next hour. Deduplicated per item, so running it often never spams.
   */
  async remind(now = new Date()): Promise<number> {
    let sent = 0;
    const tasks = await this.prisma.crmTask.findMany({
      where: { status: { in: OPEN_TASK }, dueAt: { lt: now } },
      select: {
        id: true,
        subject: true,
        assignee: { select: { userId: true } },
      },
      take: 500,
    });
    for (const t of tasks)
      if (
        await notifyCrm(
          this.prisma,
          t.assignee.userId,
          'crm.task_overdue',
          `Overdue: ${t.subject}`,
          null,
          `/employee/activity/tasks?task=${t.id}`,
          `overdue:${t.id}`,
        )
      )
        sent += 1;
    const soon = new Date(now.getTime() + 3600_000);
    const meetings = await this.prisma.crmMeeting.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
        startsAt: { gte: now, lt: soon },
      },
      select: {
        id: true,
        startsAt: true,
        lead: { select: { shopName: true } },
        employeeProfile: { select: { userId: true } },
      },
      take: 500,
    });
    for (const m of meetings)
      if (
        await notifyCrm(
          this.prisma,
          m.employeeProfile.userId,
          'crm.meeting_reminder',
          `Meeting soon: ${m.lead.shopName}`,
          m.startsAt.toISOString(),
          `/employee/activity/meetings?meeting=${m.id}`,
          `soon:${m.id}`,
        )
      )
        sent += 1;
    const calls = await this.prisma.crmCall.findMany({
      where: { outcome: null, scheduledAt: { lt: now } },
      select: {
        id: true,
        lead: { select: { shopName: true } },
        employeeProfile: { select: { userId: true } },
      },
      take: 500,
    });
    for (const c of calls)
      if (
        await notifyCrm(
          this.prisma,
          c.employeeProfile.userId,
          'crm.call_due',
          `Call due: ${c.lead.shopName}`,
          null,
          '/employee/activity/calls',
          `calldue:${c.id}`,
        )
      )
        sent += 1;
    const missed = await this.prisma.employeeCrmLead.findMany({
      where: {
        nextFollowUpAt: { lt: now },
        status: {
          notIn: [
            'ONBOARDED',
            'LOST',
            'REJECTED',
            'DUPLICATE',
            'INVALID_CONTACT',
          ],
        },
      },
      select: {
        id: true,
        shopName: true,
        nextFollowUpAt: true,
        employeeProfile: { select: { userId: true } },
      },
      take: 500,
    });
    for (const l of missed)
      if (
        await notifyCrm(
          this.prisma,
          l.employeeProfile.userId,
          'crm.follow_up_missed',
          `Follow-up missed: ${l.shopName}`,
          null,
          `/employee/leads?lead=${l.id}`,
          `missed:${l.id}:${l.nextFollowUpAt!.toISOString().slice(0, 10)}`,
        )
      )
        sent += 1;
    const stale = await this.prisma.salonOnboardingApplication.findMany({
      where: {
        status: { in: ['DRAFT', 'CHANGES_REQUESTED'] },
        updatedAt: { lt: new Date(now.getTime() - 3 * 864e5) },
      },
      select: {
        id: true,
        salonName: true,
        assignedEmployee: { select: { userId: true } },
      },
      take: 500,
    });
    for (const s of stale)
      if (
        await notifyCrm(
          this.prisma,
          s.assignedEmployee.userId,
          'crm.onboarding_incomplete',
          `Onboarding not finished: ${s.salonName}`,
          null,
          `/employee/onboarding/${s.id}`,
          `stale:${s.id}`,
        )
      )
        sent += 1;
    return sent;
  }
}
