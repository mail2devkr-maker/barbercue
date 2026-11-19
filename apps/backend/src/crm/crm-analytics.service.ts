import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CRM_CONNECTED_OUTCOMES,
  CRM_KPI_DEFINITIONS,
  SUPPORT_OPEN_STATUSES,
  crmRange,
  type CrmAnalyticsDto,
  type CrmAnalyticsQuery,
  type CrmDashboardDto,
  type CrmKpis,
  type CrmNotificationDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CrmAccessService, type CrmActor } from './crm-access.service';
import {
  callInclude,
  meetingInclude,
  taskInclude,
  toCallDto,
  toMeetingDto,
  toTaskDto,
} from './crm-activity.service';
import { employeeSelect, toEmployeeRef } from './crm-leads.service';
import { salesCoachProvider } from './sales-coach.provider';

const IN_ONBOARDING_OR_LATER = [
  'ONBOARDING_STARTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'ONBOARDED',
] as const;
const pct = (num: number, den: number) =>
  den ? Math.round((num / den) * 1000) / 10 : 0;

interface Scope {
  lead: Prisma.EmployeeCrmLeadWhereInput;
  employeeId: string | undefined;
  start: Date;
  end: Date;
}

/**
 * Every CRM number (dashboard and analytics) comes from here, computed from persisted rows with
 * the formulas in CRM_KPI_DEFINITIONS. Field employees get their own numbers; managers/admins the
 * team (optionally filtered by employee, territory, city or source).
 */
@Injectable()
export class CrmAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CrmAccessService,
  ) {}

  private scope(
    a: CrmActor,
    q: Partial<CrmAnalyticsQuery>,
    start: Date,
    end: Date,
  ): Scope {
    const employeeId = this.access.employeeScope(a, q.employeeId);
    return {
      employeeId,
      start,
      end,
      lead: {
        ...(employeeId ? { employeeProfileId: employeeId } : {}),
        ...(q.territory
          ? { territory: { equals: q.territory, mode: 'insensitive' } }
          : {}),
        ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
        ...(q.source ? { source: q.source } : {}),
      },
    };
  }

  async kpis(s: Scope): Promise<CrmKpis> {
    const inRange = { gte: s.start, lt: s.end };
    const now = new Date();
    const emp = s.employeeId ? { employeeProfileId: s.employeeId } : {};
    const app = {
      lead: s.lead,
      ...(s.employeeId ? { assignedEmployeeId: s.employeeId } : {}),
    };
    const [
      leadsAssigned,
      newLeads,
      contactedRows,
      callsCompleted,
      callsConnected,
      callsPending,
      meetingsScheduled,
      meetingsCompleted,
      visitsCompleted,
      onboardingInProgress,
      onboardingSubmitted,
      approved,
      activated,
      rejected,
      followUpsOpen,
      followUpLeads,
      overdueTasks,
      openTickets,
      scopeLeads,
      onboardingLeads,
      submittedAll,
      activatedAll,
    ] = await Promise.all([
      this.prisma.employeeCrmLead.count({
        where: {
          ...s.lead,
          OR: [
            { assignedAt: inRange },
            { assignedAt: null, createdAt: inRange },
          ],
        },
      }),
      this.prisma.employeeCrmLead.count({
        where: { ...s.lead, status: { in: ['NEW', 'ASSIGNED'] } },
      }),
      this.prisma.crmCall.findMany({
        where: { ...emp, lead: s.lead, calledAt: inRange },
        distinct: ['leadId'],
        select: { leadId: true },
      }),
      this.prisma.crmCall.count({
        where: { ...emp, lead: s.lead, calledAt: inRange },
      }),
      this.prisma.crmCall.count({
        where: {
          ...emp,
          lead: s.lead,
          calledAt: inRange,
          outcome: { in: [...CRM_CONNECTED_OUTCOMES] },
        },
      }),
      this.prisma.crmCall.count({
        where: {
          ...emp,
          lead: s.lead,
          outcome: null,
          scheduledAt: { lt: s.end },
        },
      }),
      this.prisma.crmMeeting.count({
        where: {
          ...emp,
          lead: s.lead,
          startsAt: inRange,
          status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
        },
      }),
      this.prisma.crmMeeting.count({
        where: { ...emp, lead: s.lead, startsAt: inRange, status: 'COMPLETED' },
      }),
      this.prisma.employeeCrmVisit.count({
        where: {
          ...emp,
          visitedAt: inRange,
          ...(Object.keys(s.lead).length > (s.employeeId ? 1 : 0)
            ? { lead: s.lead }
            : {}),
        },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...app, status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...app, firstSubmittedAt: inRange },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...app, approvedAt: inRange },
      }),
      this.prisma.employeeCrmLead.count({
        where: { ...s.lead, status: 'ONBOARDED', onboardedAt: inRange },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...app, rejectedAt: inRange },
      }),
      this.prisma.employeeCrmFollowUp.count({
        where: { ...emp, status: 'OPEN', lead: s.lead },
      }),
      this.prisma.employeeCrmLead.count({
        where: {
          ...s.lead,
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
      }),
      this.prisma.crmTask.count({
        where: {
          ...(s.employeeId ? { assigneeEmployeeId: s.employeeId } : {}),
          status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'] },
          dueAt: { lt: now },
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          status: { in: [...SUPPORT_OPEN_STATUSES] },
          ...(s.employeeId
            ? { createdBy: { employeeProfile: { id: s.employeeId } } }
            : {}),
        },
      }),
      this.prisma.employeeCrmLead.count({ where: s.lead }),
      this.prisma.employeeCrmLead.count({
        where: { ...s.lead, status: { in: [...IN_ONBOARDING_OR_LATER] } },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...app, firstSubmittedAt: { not: null } },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...app, status: 'ACTIVE' },
      }),
    ]);
    return {
      leadsAssigned,
      newLeads,
      leadsContacted: contactedRows.length,
      callsCompleted,
      callsConnected,
      callsPending,
      meetingsScheduled,
      meetingsCompleted,
      visitsCompleted,
      onboardingInProgress,
      onboardingSubmitted,
      approved,
      activated,
      rejected,
      pendingFollowUps: followUpsOpen + followUpLeads,
      overdueTasks,
      openTickets,
      leadToOnboarding: pct(onboardingLeads, scopeLeads),
      onboardingToActivation: pct(activatedAll, submittedAll),
    };
  }

  async dashboard(
    a: CrmActor,
    q: Partial<CrmAnalyticsQuery>,
  ): Promise<CrmDashboardDto> {
    const range = crmRange({
      preset: q.preset ?? 'today',
      from: q.from,
      to: q.to,
    });
    const s = this.scope(a, q, range.start, range.end);
    const now = new Date();
    const emp = s.employeeId ? { employeeProfileId: s.employeeId } : {};
    const [kpis, meetings, callbacks, tasks, activity, onboarding] =
      await Promise.all([
        this.kpis(s),
        this.prisma.crmMeeting.findMany({
          where: {
            ...emp,
            startsAt: { gte: now },
            status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] },
          },
          include: meetingInclude,
          orderBy: { startsAt: 'asc' },
          take: 8,
        }),
        this.prisma.crmCall.findMany({
          where: {
            ...emp,
            outcome: null,
            scheduledAt: { not: null, lt: new Date(now.getTime() + 864e5) },
          },
          include: callInclude,
          orderBy: { scheduledAt: 'asc' },
          take: 8,
        }),
        this.prisma.crmTask.findMany({
          where: {
            ...(s.employeeId ? { assigneeEmployeeId: s.employeeId } : {}),
            status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED'] },
            dueAt: { lt: now },
          },
          include: taskInclude,
          orderBy: { dueAt: 'asc' },
          take: 8,
        }),
        this.prisma.crmLeadActivity.findMany({
          where: { lead: s.lead },
          orderBy: { createdAt: 'desc' },
          take: 12,
          include: {
            lead: { select: { id: true, shopName: true } },
            actor: {
              select: {
                email: true,
                employeeProfile: { select: { fullName: true } },
              },
            },
          },
        }),
        this.prisma.salonOnboardingApplication.findMany({
          where: {
            ...(s.employeeId ? { assignedEmployeeId: s.employeeId } : {}),
            status: { notIn: ['ACTIVE', 'REJECTED'] },
          },
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: {
            id: true,
            reference: true,
            salonName: true,
            status: true,
            updatedAt: true,
          },
        }),
      ]);
    return {
      range: { from: range.from, to: range.to },
      kpis,
      upcomingMeetings: meetings.map(toMeetingDto),
      pendingCallbacks: callbacks.map((c) => toCallDto(c, now)),
      overdueTasks: tasks.map((t) => toTaskDto(t, now)),
      recentActivity: activity.map((r) => ({
        id: r.id,
        type: r.type,
        summary: r.summary,
        actor: r.actor?.employeeProfile?.fullName ?? r.actor?.email ?? null,
        metadata: null,
        createdAt: r.createdAt.toISOString(),
        lead: r.lead,
      })),
      onboarding: onboarding.map((o) => ({
        ...o,
        updatedAt: o.updatedAt.toISOString(),
      })),
    };
  }

  async analytics(a: CrmActor, q: CrmAnalyticsQuery): Promise<CrmAnalyticsDto> {
    const range = crmRange(q);
    const s = this.scope(a, q, range.start, range.end);
    const inRange = { gte: s.start, lt: s.end };
    const kpis = await this.kpis(s);
    const leadsGenerated = await this.prisma.employeeCrmLead.count({
      where: { ...s.lead, createdAt: inRange },
    });

    // Funnel: unique leads (created in range) that reached each milestone (documented definitions).
    const cohort = { ...s.lead, createdAt: inRange };
    const [
      imported,
      assigned,
      contacted,
      met,
      onboarding,
      approvedF,
      activatedF,
    ] = await Promise.all([
      this.prisma.employeeCrmLead.count({ where: cohort }),
      this.prisma.employeeCrmLead.count({
        where: { ...cohort, assignedAt: { not: null } },
      }),
      this.prisma.employeeCrmLead.count({
        where: {
          ...cohort,
          OR: [
            { calls: { some: { outcome: { not: null } } } },
            { visits: { some: {} } },
            { lastContactedAt: { not: null } },
          ],
        },
      }),
      this.prisma.employeeCrmLead.count({
        where: { ...cohort, meetings: { some: {} } },
      }),
      this.prisma.employeeCrmLead.count({
        where: {
          ...cohort,
          OR: [
            { onboardingApplication: { isNot: null } },
            { status: { in: [...IN_ONBOARDING_OR_LATER] } },
          ],
        },
      }),
      this.prisma.employeeCrmLead.count({
        where: {
          ...cohort,
          OR: [
            { onboardingApplication: { approvedAt: { not: null } } },
            { status: { in: ['APPROVED', 'ONBOARDED'] } },
          ],
        },
      }),
      this.prisma.employeeCrmLead.count({
        where: { ...cohort, status: 'ONBOARDED' },
      }),
    ]);

    // Employee ranking (team views only).
    const employees = a.team
      ? await this.prisma.employeeProfile.findMany({
          where: s.employeeId
            ? { id: s.employeeId }
            : { user: { status: 'ACTIVE' } },
          select: employeeSelect,
          orderBy: { fullName: 'asc' },
          take: 300,
        })
      : await this.prisma.employeeProfile.findMany({
          where: { id: a.employeeProfileId! },
          select: employeeSelect,
        });
    const ranking = await Promise.all(
      employees.map(async (e) => {
        const es: Scope = {
          ...s,
          employeeId: e.id,
          lead: { ...s.lead, employeeProfileId: e.id },
        };
        const [
          leadsAssigned,
          callsCompleted,
          callsConnected,
          meetingsCompleted,
          visits,
          submitted,
          approvedN,
          activatedN,
          scored,
        ] = await Promise.all([
          this.prisma.employeeCrmLead.count({
            where: {
              ...es.lead,
              OR: [
                { assignedAt: inRange },
                { assignedAt: null, createdAt: inRange },
              ],
            },
          }),
          this.prisma.crmCall.count({
            where: { employeeProfileId: e.id, calledAt: inRange },
          }),
          this.prisma.crmCall.count({
            where: {
              employeeProfileId: e.id,
              calledAt: inRange,
              outcome: { in: [...CRM_CONNECTED_OUTCOMES] },
            },
          }),
          this.prisma.crmMeeting.count({
            where: {
              employeeProfileId: e.id,
              startsAt: inRange,
              status: 'COMPLETED',
            },
          }),
          this.prisma.employeeCrmVisit.count({
            where: { employeeProfileId: e.id, visitedAt: inRange },
          }),
          this.prisma.salonOnboardingApplication.count({
            where: { assignedEmployeeId: e.id, firstSubmittedAt: inRange },
          }),
          this.prisma.salonOnboardingApplication.count({
            where: { assignedEmployeeId: e.id, approvedAt: inRange },
          }),
          this.prisma.employeeCrmLead.count({
            where: {
              employeeProfileId: e.id,
              status: 'ONBOARDED',
              onboardedAt: inRange,
            },
          }),
          this.prisma.salesRecordingAnalysis.aggregate({
            where: {
              status: 'COMPLETED',
              recording: { employeeProfileId: e.id, createdAt: inRange },
            },
            _avg: { overallScore: true },
          }),
        ]);
        return {
          employee: toEmployeeRef(e),
          leadsAssigned,
          callsCompleted,
          callsConnected,
          meetingsCompleted,
          visits,
          onboardingsSubmitted: submitted,
          approved: approvedN,
          activated: activatedN,
          conversion: pct(activatedN, leadsAssigned),
          aiPitchScore:
            scored._avg.overallScore != null
              ? Math.round(scored._avg.overallScore)
              : null,
        };
      }),
    );

    // Trend (IST days).
    const empFilter = s.employeeId
      ? Prisma.sql`AND x."employeeProfileId" = ${s.employeeId}`
      : Prisma.empty;
    const day = (col: string) =>
      Prisma.raw(
        `to_char((x."${col}" AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD')`,
      );
    const series = async (
      table: string,
      col: string,
      extra: Prisma.Sql = Prisma.empty,
      empCol = 'employeeProfileId',
    ) => {
      const ef = s.employeeId
        ? Prisma.sql`AND x.${Prisma.raw(`"${empCol}"`)} = ${s.employeeId}`
        : Prisma.empty;
      const rows = await this.prisma.$queryRaw<
        Array<{ d: string; n: bigint }>
      >(Prisma.sql`
        SELECT ${day(col)} AS "d", COUNT(*)::bigint AS "n" FROM ${Prisma.raw(`"${table}"`)} x
        WHERE x.${Prisma.raw(`"${col}"`)} >= ${s.start} AND x.${Prisma.raw(`"${col}"`)} < ${s.end} ${ef} ${extra}
        GROUP BY 1`);
      return new Map(rows.map((r) => [r.d, Number(r.n)]));
    };
    void empFilter;
    const [calls, meetingsT, visitsT, onboardingsT, approvalsT, activationsT] =
      await Promise.all([
        series('crm_calls', 'calledAt'),
        series(
          'crm_meetings',
          'startsAt',
          Prisma.sql`AND x."status" = 'COMPLETED'`,
        ),
        series('employee_crm_visits', 'visitedAt'),
        series(
          'salon_onboarding_applications',
          'firstSubmittedAt',
          Prisma.empty,
          'assignedEmployeeId',
        ),
        series(
          'salon_onboarding_applications',
          'approvedAt',
          Prisma.empty,
          'assignedEmployeeId',
        ),
        series(
          'employee_crm_leads',
          'onboardedAt',
          Prisma.sql`AND x."status" = 'ONBOARDED'`,
        ),
      ]);
    const trend: CrmAnalyticsDto['trend'] = [];
    for (
      let t = Date.parse(`${range.from}T00:00:00Z`);
      t <= Date.parse(`${range.to}T00:00:00Z`) && trend.length < 400;
      t += 864e5
    ) {
      const d = new Date(t).toISOString().slice(0, 10);
      trend.push({
        day: d,
        calls: calls.get(d) ?? 0,
        meetings: meetingsT.get(d) ?? 0,
        visits: visitsT.get(d) ?? 0,
        onboardings: onboardingsT.get(d) ?? 0,
        approvals: approvalsT.get(d) ?? 0,
        activations: activationsT.get(d) ?? 0,
      });
    }

    const [sourceRows, territoryRows] = await Promise.all([
      this.prisma.employeeCrmLead.groupBy({
        by: ['source', 'status'],
        where: { ...s.lead, createdAt: inRange },
        _count: { _all: true },
      }),
      this.prisma.employeeCrmLead.groupBy({
        by: ['territory', 'status'],
        where: { ...s.lead, createdAt: inRange },
        _count: { _all: true },
      }),
    ]);
    const roll = <K extends string>(
      rows: Array<
        { status: string; _count: { _all: number } } & Record<K, string | null>
      >,
      key: K,
    ) => {
      const m = new Map<
        string,
        { leads: number; onboarded: number; activated: number }
      >();
      for (const r of rows) {
        const k = r[key] ?? 'Unassigned';
        const v = m.get(k) ?? { leads: 0, onboarded: 0, activated: 0 };
        v.leads += r._count._all;
        if ((IN_ONBOARDING_OR_LATER as readonly string[]).includes(r.status))
          v.onboarded += r._count._all;
        if (r.status === 'ONBOARDED') v.activated += r._count._all;
        m.set(k, v);
      }
      return m;
    };
    const sources = [...roll(sourceRows, 'source')]
      .map(([source, v]) => ({
        source,
        leads: v.leads,
        onboarded: v.onboarded,
      }))
      .sort((x, y) => y.leads - x.leads);
    const territories = [...roll(territoryRows, 'territory')]
      .map(([territory, v]) => ({ territory, ...v }))
      .sort((x, y) => y.leads - x.leads);

    // Onboarding quality (current, in scope).
    const appScope: Prisma.SalonOnboardingApplicationWhereInput = {
      lead: s.lead,
      ...(s.employeeId ? { assignedEmployeeId: s.employeeId } : {}),
    };
    const [
      missingPhotos,
      missingMenu,
      gpsUnverified,
      incomplete,
      approvedApps,
      rejections,
    ] = await Promise.all([
      this.prisma.salonOnboardingApplication.count({
        where: {
          ...appScope,
          status: { notIn: ['REJECTED'] },
          media: {
            none: {
              deletedAt: null,
              category: {
                in: [
                  'EXTERIOR',
                  'INTERIOR',
                  'STATIONS',
                  'RECEPTION',
                  'ENTRANCE',
                  'INTERIOR_LEFT',
                  'INTERIOR_RIGHT',
                ],
              },
            },
          },
        },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: {
          ...appScope,
          status: { notIn: ['REJECTED'] },
          services: { none: {} },
        },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: {
          ...appScope,
          status: { notIn: ['REJECTED'] },
          OR: [{ latitude: null }, { locationVerified: false }],
        },
      }),
      this.prisma.salonOnboardingApplication.count({
        where: { ...appScope, status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
      }),
      this.prisma.salonOnboardingApplication.findMany({
        where: {
          ...appScope,
          approvedAt: inRange,
          firstSubmittedAt: { not: null },
        },
        select: { approvedAt: true, firstSubmittedAt: true },
        take: 2000,
      }),
      this.prisma.salonOnboardingApplication.groupBy({
        by: ['rejectionReason'],
        where: { ...appScope, rejectedAt: inRange },
        _count: { _all: true },
      }),
    ]);
    const hours = approvedApps.map(
      (x) =>
        (x.approvedAt!.getTime() - x.firstSubmittedAt!.getTime()) / 3600_000,
    );

    // AI (only real reports) and support.
    const ai = salesCoachProvider();
    const recScope: Prisma.SalesRecordingWhereInput = {
      ...(s.employeeId ? { employeeProfileId: s.employeeId } : {}),
      createdAt: inRange,
    };
    const [aiAgg, ticketRows, overdueTickets, resolved] = await Promise.all([
      this.prisma.salesRecordingAnalysis.aggregate({
        where: { status: 'COMPLETED', recording: recScope },
        _avg: { overallScore: true },
        _count: { _all: true },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['category'],
        where: {
          createdAt: inRange,
          ...(a.team ? {} : { createdByUserId: a.userId }),
        },
        _count: { _all: true },
      }),
      this.prisma.supportTicket.count({
        where: {
          status: { in: [...SUPPORT_OPEN_STATUSES] },
          slaDueAt: { lt: new Date() },
          ...(a.team ? {} : { createdByUserId: a.userId }),
        },
      }),
      this.prisma.supportTicket.findMany({
        where: {
          resolvedAt: inRange,
          ...(a.team ? {} : { createdByUserId: a.userId }),
        },
        select: { createdAt: true, resolvedAt: true },
        take: 2000,
      }),
    ]);
    const resHours = resolved.map(
      (t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3600_000,
    );
    const avg = (xs: number[]) =>
      xs.length
        ? Math.round((xs.reduce((x, y) => x + y, 0) / xs.length) * 10) / 10
        : null;

    return {
      range: { from: range.from, to: range.to },
      kpis: {
        ...kpis,
        leadsGenerated,
        leadConversion: pct(activatedF, imported),
        meetingConversion: pct(onboarding, met),
        approvalRate: pct(kpis.approved, kpis.approved + kpis.rejected),
        activationRate: kpis.onboardingToActivation,
      },
      funnel: [
        { stage: 'Imported / created', leads: imported },
        { stage: 'Assigned', leads: assigned },
        { stage: 'Contacted', leads: contacted },
        { stage: 'Meeting', leads: met },
        { stage: 'Onboarding', leads: onboarding },
        { stage: 'Approved', leads: approvedF },
        { stage: 'Activated', leads: activatedF },
      ],
      employees: ranking.sort(
        (x, y) =>
          y.activated - x.activated ||
          y.approved - x.approved ||
          y.callsCompleted - x.callsCompleted,
      ),
      trend,
      sources,
      territories,
      onboardingQuality: {
        missingPhotos,
        missingMenu,
        gpsUnverified,
        incomplete,
        averageApprovalHours: avg(hours),
        rejectionReasons: rejections
          .map((r) => ({
            reason: r.rejectionReason ?? 'Not given',
            count: r._count._all,
          }))
          .sort((x, y) => y.count - x.count)
          .slice(0, 10),
      },
      ai: {
        configured: ai.configured,
        analysed: aiAgg._count._all,
        averageScore:
          aiAgg._avg.overallScore != null
            ? Math.round(aiAgg._avg.overallScore)
            : null,
      },
      support: {
        open: kpis.openTickets,
        overdue: overdueTickets,
        averageResolutionHours: avg(resHours),
        byCategory: ticketRows
          .map((r) => ({ category: r.category, count: r._count._all }))
          .sort((x, y) => y.count - x.count),
      },
      definitions: CRM_KPI_DEFINITIONS,
    };
  }

  // ---------- Notifications (the CRM's own in-app inbox) ----------

  async notifications(
    a: CrmActor,
  ): Promise<{ items: CrmNotificationDto[]; unread: number }> {
    const where = { userId: a.userId, type: { startsWith: 'crm.' } };
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      unread,
      items: rows.map((n) => {
        const p = (n.payload ?? {}) as { title?: string; body?: string | null };
        return {
          id: n.id,
          type: n.type,
          title: p.title ?? n.type,
          body: p.body ?? null,
          deepLink: n.deepLink,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        };
      }),
    };
  }

  /** `id` is a notification id or the literal 'all'. */
  async markRead(a: CrmActor, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        userId: a.userId,
        type: { startsWith: 'crm.' },
        readAt: null,
        ...(id === 'all' ? {} : { id }),
      },
      data: { readAt: new Date() },
    });
  }
}
