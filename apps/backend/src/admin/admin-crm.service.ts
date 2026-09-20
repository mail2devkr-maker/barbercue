import { Injectable } from '@nestjs/common';
import {
  CrmFollowUpStatus,
  CrmLeadStatus,
  type AdminCrmEmployeePerformanceDto,
  type AdminCrmFollowUpDto,
  type AdminCrmLeadDto,
  type AdminCrmOverviewDto,
  type AdminCrmVisitDto,
  type EmployeeProfileDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_LIST_LIMIT = 500;
const OVERVIEW_ACTIVITY_LIMIT = 50;

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
