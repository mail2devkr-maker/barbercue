import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CrmErrorCode,
  CrmFollowUpStatus,
  CrmLeadStatus,
  type AdminCrmAnalyticsDto,
  type AdminCrmAnalyticsQuery,
  type AdminCrmFollowUpPageQuery,
  type AdminCrmLeadPageQuery,
  type AdminCrmPageDto,
  type AdminCrmEmployeePerformanceDto,
  type AdminCrmFollowUpDto,
  type AdminCrmLeadDto,
  type AdminCrmOverviewDto,
  type AdminCrmVisitPageQuery,
  type AdminCrmVisitDto,
  type EmployeeProfileDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_LIST_LIMIT = 500;
const OVERVIEW_ACTIVITY_LIMIT = 50;
const ADMIN_CRM_PAGE_LIMIT = 100;

type AdminCrmCursorKind = 'leads' | 'visits' | 'follow-ups';
interface AdminCrmCursor {
  kind: AdminCrmCursorKind;
  date: Date;
  id: string;
}

@Injectable()
export class AdminCrmService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<AdminCrmOverviewDto> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const employees = await this.prisma.employeeProfile.findMany({
      orderBy: { employeeCode: 'asc' },
      include: { user: { select: { status: true } } },
    });

    const [
      leads,
      onboarded,
      visitsLast30Days,
      openFollowUps,
      overdueFollowUps,
      performance,
      recentLeadRows,
      recentVisitRows,
      dueFollowUpRows,
    ] = await Promise.all([
      this.prisma.employeeCrmLead.count(),
      this.prisma.employeeCrmLead.count({ where: { status: CrmLeadStatus.ONBOARDED } }),
      this.prisma.employeeCrmVisit.count({ where: { visitedAt: { gte: thirtyDaysAgo } } }),
      this.prisma.employeeCrmFollowUp.count({ where: { status: CrmFollowUpStatus.OPEN } }),
      this.prisma.employeeCrmFollowUp.count({
        where: { status: CrmFollowUpStatus.OPEN, dueAt: { lt: now } },
      }),
      Promise.all(
        employees.map(async (employee): Promise<AdminCrmEmployeePerformanceDto> => {
          const [employeeLeads, employeeOnboarded, employeeVisits, employeeOpen, employeeOverdue] =
            await Promise.all([
              this.prisma.employeeCrmLead.count({
                where: { employeeProfileId: employee.id },
              }),
              this.prisma.employeeCrmLead.count({
                where: {
                  employeeProfileId: employee.id,
                  status: CrmLeadStatus.ONBOARDED,
                },
              }),
              this.prisma.employeeCrmVisit.count({
                where: {
                  employeeProfileId: employee.id,
                  visitedAt: { gte: thirtyDaysAgo },
                },
              }),
              this.prisma.employeeCrmFollowUp.count({
                where: {
                  employeeProfileId: employee.id,
                  status: CrmFollowUpStatus.OPEN,
                },
              }),
              this.prisma.employeeCrmFollowUp.count({
                where: {
                  employeeProfileId: employee.id,
                  status: CrmFollowUpStatus.OPEN,
                  dueAt: { lt: now },
                },
              }),
            ]);
          return {
            employee: {
              id: employee.id,
              employeeCode: employee.employeeCode,
              fullName: employee.fullName,
              territory: employee.territory,
              joinedAt: employee.joinedAt.toISOString(),
              status: employee.user.status,
            },
            leads: employeeLeads,
            onboarded: employeeOnboarded,
            visitsLast30Days: employeeVisits,
            openFollowUps: employeeOpen,
            overdueFollowUps: employeeOverdue,
            conversionRatePercent:
              employeeLeads > 0
                ? Math.round((employeeOnboarded / employeeLeads) * 1000) / 10
                : 0,
          };
        }),
      ),
      this.prisma.employeeCrmLead.findMany({
        orderBy: { updatedAt: 'desc' },
        take: OVERVIEW_ACTIVITY_LIMIT,
        include: {
          employeeProfile: true,
          onboardedSalon: { select: { id: true, publicId: true, name: true } },
        },
      }),
      this.prisma.employeeCrmVisit.findMany({
        orderBy: { visitedAt: 'desc' },
        take: OVERVIEW_ACTIVITY_LIMIT,
        include: { employeeProfile: true, lead: { select: { shopName: true } } },
      }),
      this.prisma.employeeCrmFollowUp.findMany({
        where: { status: CrmFollowUpStatus.OPEN },
        orderBy: { dueAt: 'asc' },
        take: OVERVIEW_ACTIVITY_LIMIT,
        include: { employeeProfile: true, lead: { select: { shopName: true } } },
      }),
    ]);

    return {
      counts: {
        employees: employees.length,
        leads,
        onboarded,
        visitsLast30Days,
        openFollowUps,
        overdueFollowUps,
      },
      conversionRatePercent: leads > 0 ? Math.round((onboarded / leads) * 1000) / 10 : 0,
      performance,
      recentLeads: recentLeadRows.map((row) => this.leadDto(row)),
      recentVisits: recentVisitRows.map((row) => this.visitDto(row)),
      dueFollowUps: dueFollowUpRows.map((row) => this.followUpDto(row)),
    };
  }

  async listLeads(employeeProfileId?: string, status?: string): Promise<AdminCrmLeadDto[]> {
    const normalizedStatus =
      status && Object.values(CrmLeadStatus).includes(status as CrmLeadStatus)
        ? (status as CrmLeadStatus)
        : undefined;
    const rows = await this.prisma.employeeCrmLead.findMany({
      where: {
        ...(employeeProfileId ? { employeeProfileId } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: ADMIN_LIST_LIMIT,
      include: {
        employeeProfile: true,
        onboardedSalon: { select: { id: true, publicId: true, name: true } },
      },
    });
    return rows.map((row) => this.leadDto(row));
  }

  async listVisits(employeeProfileId?: string): Promise<AdminCrmVisitDto[]> {
    const rows = await this.prisma.employeeCrmVisit.findMany({
      where: employeeProfileId ? { employeeProfileId } : undefined,
      orderBy: { visitedAt: 'desc' },
      take: ADMIN_LIST_LIMIT,
      include: { employeeProfile: true, lead: { select: { shopName: true } } },
    });
    return rows.map((row) => this.visitDto(row));
  }

  async listFollowUps(
    employeeProfileId?: string,
    status?: string,
  ): Promise<AdminCrmFollowUpDto[]> {
    const normalizedStatus =
      status && Object.values(CrmFollowUpStatus).includes(status as CrmFollowUpStatus)
        ? (status as CrmFollowUpStatus)
        : undefined;
    const rows = await this.prisma.employeeCrmFollowUp.findMany({
      where: {
        ...(employeeProfileId ? { employeeProfileId } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: ADMIN_LIST_LIMIT,
      include: { employeeProfile: true, lead: { select: { shopName: true } } },
    });
    return rows.map((row) => this.followUpDto(row));
  }

  async pageLeads(
    actorId: string,
    query: AdminCrmLeadPageQuery,
  ): Promise<AdminCrmPageDto<AdminCrmLeadDto>> {
    const filters = {
      employeeId: query.employeeId,
      status: query.status,
      source: query.source,
      from: query.from,
      to: query.to,
      q: query.q,
    };
    const where: Prisma.EmployeeCrmLeadWhereInput = {
      AND: [
        {
          ...(query.employeeId ? { employeeProfileId: query.employeeId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.source ? { source: query.source } : {}),
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lt: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(query.q
            ? {
                OR: [
                  { shopName: { contains: query.q, mode: 'insensitive' } },
                  { city: { contains: query.q, mode: 'insensitive' } },
                  { locality: { contains: query.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        ...(query.cursor
          ? [
              this.leadCursorWhere(
                this.decodeCursor(query.cursor, 'leads', actorId, filters),
              ),
            ]
          : []),
      ],
    };
    const rows = await this.prisma.employeeCrmLead.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(query.limit, ADMIN_CRM_PAGE_LIMIT) + 1,
      include: {
        employeeProfile: true,
        onboardedSalon: { select: { id: true, publicId: true, name: true } },
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => this.leadDto(row)),
      nextCursor:
        hasMore && page.length
          ? this.encodeCursor(
              'leads',
              actorId,
              filters,
              page[page.length - 1].createdAt,
              page[page.length - 1].id,
            )
          : null,
      limit: query.limit,
    };
  }

  async pageVisits(
    actorId: string,
    query: AdminCrmVisitPageQuery,
  ): Promise<AdminCrmPageDto<AdminCrmVisitDto>> {
    const filters = {
      employeeId: query.employeeId,
      outcome: query.outcome,
      from: query.from,
      to: query.to,
      q: query.q,
    };
    const where: Prisma.EmployeeCrmVisitWhereInput = {
      AND: [
        {
          ...(query.employeeId ? { employeeProfileId: query.employeeId } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.from || query.to
            ? {
                visitedAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lt: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(query.q
            ? {
                OR: [
                  { shopName: { contains: query.q, mode: 'insensitive' } },
                  {
                    lead: {
                      is: {
                        shopName: { contains: query.q, mode: 'insensitive' },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        ...(query.cursor
          ? [
              this.visitCursorWhere(
                this.decodeCursor(query.cursor, 'visits', actorId, filters),
              ),
            ]
          : []),
      ],
    };
    const rows = await this.prisma.employeeCrmVisit.findMany({
      where,
      orderBy: [{ visitedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(query.limit, ADMIN_CRM_PAGE_LIMIT) + 1,
      include: { employeeProfile: true, lead: { select: { shopName: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => this.visitDto(row)),
      nextCursor:
        hasMore && page.length
          ? this.encodeCursor(
              'visits',
              actorId,
              filters,
              page[page.length - 1].visitedAt,
              page[page.length - 1].id,
            )
          : null,
      limit: query.limit,
    };
  }

  async pageFollowUps(
    actorId: string,
    query: AdminCrmFollowUpPageQuery,
  ): Promise<AdminCrmPageDto<AdminCrmFollowUpDto>> {
    const filters = {
      employeeId: query.employeeId,
      status: query.status,
      channel: query.channel,
      from: query.from,
      to: query.to,
      q: query.q,
    };
    const where: Prisma.EmployeeCrmFollowUpWhereInput = {
      AND: [
        {
          ...(query.employeeId ? { employeeProfileId: query.employeeId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.channel ? { channel: query.channel } : {}),
          ...(query.from || query.to
            ? {
                dueAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lt: new Date(query.to) } : {}),
                },
              }
            : {}),
          ...(query.q
            ? {
                lead: {
                  is: { shopName: { contains: query.q, mode: 'insensitive' } },
                },
              }
            : {}),
        },
        ...(query.cursor
          ? [
              this.followUpCursorWhere(
                this.decodeCursor(query.cursor, 'follow-ups', actorId, filters),
              ),
            ]
          : []),
      ],
    };
    const rows = await this.prisma.employeeCrmFollowUp.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: Math.min(query.limit, ADMIN_CRM_PAGE_LIMIT) + 1,
      include: { employeeProfile: true, lead: { select: { shopName: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => this.followUpDto(row)),
      nextCursor:
        hasMore && page.length
          ? this.encodeCursor(
              'follow-ups',
              actorId,
              filters,
              page[page.length - 1].dueAt,
              page[page.length - 1].id,
            )
          : null,
      limit: query.limit,
    };
  }

  async getAnalytics(
    query: AdminCrmAnalyticsQuery,
  ): Promise<AdminCrmAnalyticsDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      throw new AppException(
        CrmErrorCode.ADMIN_DATE_RANGE_TOO_LARGE,
        'The requested CRM analytics range cannot exceed 366 days.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const now = new Date();
    const overdueEnd = to < now ? to : now;
    const [
      employees,
      leadsCreatedRows,
      convertedRows,
      onboardedRows,
      visitRows,
      completedRows,
      overdueRows,
    ] = await this.prisma.$transaction(
      [
        this.prisma.employeeProfile.findMany({
          where: query.employeeId ? { id: query.employeeId } : undefined,
          select: {
            id: true,
            employeeCode: true,
            territory: true,
            user: { select: { status: true } },
          },
          orderBy: { employeeCode: 'asc' },
        }),
        this.prisma.employeeCrmLead.groupBy({
          by: ['employeeProfileId'],
          orderBy: { employeeProfileId: 'asc' },
          where: {
            ...(query.employeeId
              ? { employeeProfileId: query.employeeId }
              : {}),
            createdAt: { gte: from, lt: to },
          },
          _count: { _all: true },
        }),
        this.prisma.employeeCrmLead.groupBy({
          by: ['employeeProfileId'],
          orderBy: { employeeProfileId: 'asc' },
          where: {
            ...(query.employeeId
              ? { employeeProfileId: query.employeeId }
              : {}),
            createdAt: { gte: from, lt: to },
            status: CrmLeadStatus.ONBOARDED,
          },
          _count: { _all: true },
        }),
        this.prisma.employeeCrmLead.groupBy({
          by: ['employeeProfileId'],
          orderBy: { employeeProfileId: 'asc' },
          where: {
            ...(query.employeeId
              ? { employeeProfileId: query.employeeId }
              : {}),
            onboardedAt: { gte: from, lt: to },
            status: CrmLeadStatus.ONBOARDED,
          },
          _count: { _all: true },
        }),
        this.prisma.employeeCrmVisit.groupBy({
          by: ['employeeProfileId'],
          orderBy: { employeeProfileId: 'asc' },
          where: {
            ...(query.employeeId
              ? { employeeProfileId: query.employeeId }
              : {}),
            visitedAt: { gte: from, lt: to },
          },
          _count: { _all: true },
        }),
        this.prisma.employeeCrmFollowUp.groupBy({
          by: ['employeeProfileId'],
          orderBy: { employeeProfileId: 'asc' },
          where: {
            ...(query.employeeId
              ? { employeeProfileId: query.employeeId }
              : {}),
            status: CrmFollowUpStatus.COMPLETED,
            completedAt: { gte: from, lt: to },
          },
          _count: { _all: true },
        }),
        this.prisma.employeeCrmFollowUp.groupBy({
          by: ['employeeProfileId'],
          orderBy: { employeeProfileId: 'asc' },
          where: {
            ...(query.employeeId
              ? { employeeProfileId: query.employeeId }
              : {}),
            status: CrmFollowUpStatus.OPEN,
            dueAt: { gte: from, lt: overdueEnd },
          },
          _count: { _all: true },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const countMap = (
      rows: Array<{
        employeeProfileId: string;
        _count?: true | { _all?: number };
      }>,
    ) =>
      new Map(
        rows.map((row) => [
          row.employeeProfileId,
          typeof row._count === 'object' ? (row._count._all ?? 0) : 0,
        ]),
      );
    const created = countMap(leadsCreatedRows);
    const converted = countMap(convertedRows);
    const onboardedInPeriod = countMap(onboardedRows);
    const visits = countMap(visitRows);
    const completedFollowUps = countMap(completedRows);
    const overdueFollowUps = countMap(overdueRows);

    const employeeMetrics = employees.map((employee) => {
      const leadsCreated = created.get(employee.id) ?? 0;
      const onboardedFromPeriodLeads = converted.get(employee.id) ?? 0;
      return {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        territory: employee.territory,
        status: employee.user.status,
        leadsCreated,
        onboardedFromPeriodLeads,
        leadsOnboardedInPeriod: onboardedInPeriod.get(employee.id) ?? 0,
        visits: visits.get(employee.id) ?? 0,
        followUpsCompleted: completedFollowUps.get(employee.id) ?? 0,
        openFollowUpsOverdueInPeriod: overdueFollowUps.get(employee.id) ?? 0,
        conversionPercent:
          leadsCreated > 0
            ? Math.round((onboardedFromPeriodLeads / leadsCreated) * 1000) / 10
            : 0,
      };
    });
    const aggregate = (rows: typeof employeeMetrics) => {
      const leadsCreated = rows.reduce((sum, row) => sum + row.leadsCreated, 0);
      const onboardedFromPeriodLeads = rows.reduce(
        (sum, row) => sum + row.onboardedFromPeriodLeads,
        0,
      );
      return {
        employees: rows.length,
        leadsCreated,
        onboardedFromPeriodLeads,
        leadsOnboardedInPeriod: rows.reduce(
          (sum, row) => sum + row.leadsOnboardedInPeriod,
          0,
        ),
        visits: rows.reduce((sum, row) => sum + row.visits, 0),
        followUpsCompleted: rows.reduce(
          (sum, row) => sum + row.followUpsCompleted,
          0,
        ),
        openFollowUpsOverdueInPeriod: rows.reduce(
          (sum, row) => sum + row.openFollowUpsOverdueInPeriod,
          0,
        ),
        conversionPercent:
          leadsCreated > 0
            ? Math.round((onboardedFromPeriodLeads / leadsCreated) * 1000) / 10
            : 0,
      };
    };
    const territoryMap = new Map<string, typeof employeeMetrics>();
    for (const employee of employeeMetrics) {
      const key = employee.territory ?? '';
      const group = territoryMap.get(key) ?? [];
      group.push(employee);
      territoryMap.set(key, group);
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: now.toISOString(),
      totals: {
        leadsCreated: employeeMetrics.reduce(
          (sum, row) => sum + row.leadsCreated,
          0,
        ),
        onboardedFromPeriodLeads: employeeMetrics.reduce(
          (sum, row) => sum + row.onboardedFromPeriodLeads,
          0,
        ),
        leadsOnboardedInPeriod: employeeMetrics.reduce(
          (sum, row) => sum + row.leadsOnboardedInPeriod,
          0,
        ),
        visits: employeeMetrics.reduce((sum, row) => sum + row.visits, 0),
        followUpsCompleted: employeeMetrics.reduce(
          (sum, row) => sum + row.followUpsCompleted,
          0,
        ),
        openFollowUpsOverdueInPeriod: employeeMetrics.reduce(
          (sum, row) => sum + row.openFollowUpsOverdueInPeriod,
          0,
        ),
      },
      employees: employeeMetrics,
      territories: [...territoryMap.entries()]
        .map(([territory, rows]) => ({
          territory: territory || null,
          ...aggregate(rows),
        }))
        .sort((a, b) => (a.territory ?? '').localeCompare(b.territory ?? '')),
    };
  }

  private cursorFilterHash(
    kind: AdminCrmCursorKind,
    actorId: string,
    filters: Record<string, unknown>,
  ): string {
    const normalizedFilters = Object.fromEntries(
      Object.entries(filters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => {
          if ((key === 'from' || key === 'to') && typeof value === 'string') {
            return [key, new Date(value).toISOString()];
          }
          if (key === 'employeeId' && typeof value === 'string') {
            return [key, value.toLowerCase()];
          }
          if (key === 'q' && typeof value === 'string') {
            return [key, value.trim()];
          }
          return [key, value];
        }),
    );
    return createHash('sha256')
      .update(JSON.stringify({ kind, actorId, filters: normalizedFilters }))
      .digest('hex');
  }

  private encodeCursor(
    kind: AdminCrmCursorKind,
    actorId: string,
    filters: Record<string, unknown>,
    date: Date,
    id: string,
  ): string {
    const secret = this.cursorSecret();
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        kind,
        filterHash: this.cursorFilterHash(kind, actorId, filters),
        date: date.toISOString(),
        id,
      }),
    ).toString('base64url');
    const signature = createHmac(
      'sha256',
      createHmac('sha256', secret)
        .update('fastque:admin-crm-cursor:v1')
        .digest(),
    )
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private decodeCursor(
    value: string,
    kind: AdminCrmCursorKind,
    actorId: string,
    filters: Record<string, unknown>,
  ): AdminCrmCursor {
    const [payload, suppliedSignature, extra] = value.split('.');
    if (!payload || !suppliedSignature || extra !== undefined) {
      throw this.invalidCursor();
    }
    const secret = this.cursorSecret();
    const expectedSignature = createHmac(
      'sha256',
      createHmac('sha256', secret)
        .update('fastque:admin-crm-cursor:v1')
        .digest(),
    )
      .update(payload)
      .digest();
    let receivedSignature: Buffer;
    try {
      receivedSignature = Buffer.from(suppliedSignature, 'base64url');
    } catch {
      throw this.invalidCursor();
    }
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      throw this.invalidCursor();
    }
    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as {
        version?: number;
        kind?: AdminCrmCursorKind;
        filterHash?: string;
        date?: string;
        id?: string;
      };
      const date = decoded.date ? new Date(decoded.date) : null;
      if (
        decoded.version !== 1 ||
        decoded.kind !== kind ||
        decoded.filterHash !== this.cursorFilterHash(kind, actorId, filters) ||
        !decoded.id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          decoded.id,
        ) ||
        !date ||
        !Number.isFinite(date.getTime())
      ) {
        throw this.invalidCursor();
      }
      return { kind, date, id: decoded.id };
    } catch {
      throw this.invalidCursor();
    }
  }

  private leadCursorWhere(
    cursor: AdminCrmCursor,
  ): Prisma.EmployeeCrmLeadWhereInput {
    return {
      OR: [
        { createdAt: { lt: cursor.date } },
        { createdAt: cursor.date, id: { lt: cursor.id } },
      ],
    };
  }

  private visitCursorWhere(
    cursor: AdminCrmCursor,
  ): Prisma.EmployeeCrmVisitWhereInput {
    return {
      OR: [
        { visitedAt: { lt: cursor.date } },
        { visitedAt: cursor.date, id: { lt: cursor.id } },
      ],
    };
  }

  private followUpCursorWhere(
    cursor: AdminCrmCursor,
  ): Prisma.EmployeeCrmFollowUpWhereInput {
    return {
      OR: [
        { dueAt: { gt: cursor.date } },
        { dueAt: cursor.date, id: { gt: cursor.id } },
      ],
    };
  }

  private invalidCursor(): AppException {
    return new AppException(
      CrmErrorCode.ADMIN_CURSOR_INVALID,
      'This CRM cursor is invalid or belongs to different filters.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private cursorSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret.length < 32) {
      throw new AppException(
        CrmErrorCode.ADMIN_CURSOR_UNAVAILABLE,
        'CRM pagination is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return secret;
  }

  private employeeSummary(profile: {
    id: string;
    employeeCode: string;
    fullName: string;
    territory: string | null;
    joinedAt: Date;
  }): Pick<EmployeeProfileDto, 'id' | 'employeeCode' | 'fullName' | 'territory'> {
    return {
      id: profile.id,
      employeeCode: profile.employeeCode,
      fullName: profile.fullName,
      territory: profile.territory,
    };
  }

  private leadDto(row: {
    id: string;
    shopName: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    city: string | null;
    locality: string | null;
    addressLine: string | null;
    source: AdminCrmLeadDto['source'];
    status: AdminCrmLeadDto['status'];
    notes: string | null;
    lostReason: string | null;
    onboardedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    employeeProfile: {
      id: string;
      employeeCode: string;
      fullName: string;
      territory: string | null;
      joinedAt: Date;
    };
    onboardedSalon: { id: string; publicId: string; name: string } | null;
  }): AdminCrmLeadDto {
    return {
      id: row.id,
      shopName: row.shopName,
      contactName: row.contactName,
      phone: row.phone,
      email: row.email,
      city: row.city,
      locality: row.locality,
      addressLine: row.addressLine,
      source: row.source,
      status: row.status,
      notes: row.notes,
      lostReason: row.lostReason,
      onboardedAt: row.onboardedAt?.toISOString() ?? null,
      onboardedSalon: row.onboardedSalon,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      employee: this.employeeSummary(row.employeeProfile),
    };
  }

  private visitDto(row: {
    id: string;
    leadId: string | null;
    shopName: string;
    visitedAt: Date;
    outcome: AdminCrmVisitDto['outcome'];
    notes: string | null;
    createdAt: Date;
    lead: { shopName: string } | null;
    employeeProfile: {
      id: string;
      employeeCode: string;
      fullName: string;
      territory: string | null;
      joinedAt: Date;
    };
  }): AdminCrmVisitDto {
    return {
      id: row.id,
      leadId: row.leadId,
      leadShopName: row.lead?.shopName ?? null,
      shopName: row.shopName,
      visitedAt: row.visitedAt.toISOString(),
      outcome: row.outcome,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      employee: this.employeeSummary(row.employeeProfile),
    };
  }

  private followUpDto(row: {
    id: string;
    leadId: string;
    dueAt: Date;
    channel: AdminCrmFollowUpDto['channel'];
    status: AdminCrmFollowUpDto['status'];
    notes: string | null;
    outcome: string | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lead: { shopName: string };
    employeeProfile: {
      id: string;
      employeeCode: string;
      fullName: string;
      territory: string | null;
      joinedAt: Date;
    };
  }): AdminCrmFollowUpDto {
    return {
      id: row.id,
      leadId: row.leadId,
      leadShopName: row.lead.shopName,
      dueAt: row.dueAt.toISOString(),
      channel: row.channel,
      status: row.status,
      notes: row.notes,
      outcome: row.outcome,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      employee: this.employeeSummary(row.employeeProfile),
    };
  }
}
