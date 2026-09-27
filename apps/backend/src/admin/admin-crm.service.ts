import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CrmErrorCode,
  CrmFollowUpStatus,
  CrmLeadStatus,
  CrmTaskStatus,
  type AdminCrmEmployeePerformanceDto,
  type AdminCrmFollowUpDto,
  type AdminCrmLeadDto,
  type AdminCrmOverviewDto,
  type AdminCrmTaskDto,
  type AdminCrmVisitDto,
  type CreateCrmTaskInput,
  type EmployeeProfileDto,
  type UpdateAdminCrmTaskInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

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
      openTasks,
      overdueTasks,
      performance,
      recentLeadRows,
      recentVisitRows,
      dueFollowUpRows,
      dueTaskRows,
    ] = await Promise.all([
      this.prisma.employeeCrmLead.count(),
      this.prisma.employeeCrmLead.count({ where: { status: CrmLeadStatus.ONBOARDED } }),
      this.prisma.employeeCrmVisit.count({ where: { visitedAt: { gte: thirtyDaysAgo } } }),
      this.prisma.employeeCrmFollowUp.count({ where: { status: CrmFollowUpStatus.OPEN } }),
      this.prisma.employeeCrmFollowUp.count({
        where: { status: CrmFollowUpStatus.OPEN, dueAt: { lt: now } },
      }),
      this.prisma.employeeCrmTask.count({
        where: { status: { in: [CrmTaskStatus.TODO, CrmTaskStatus.IN_PROGRESS] } },
      }),
      this.prisma.employeeCrmTask.count({
        where: {
          status: { in: [CrmTaskStatus.TODO, CrmTaskStatus.IN_PROGRESS] },
          dueAt: { lt: now },
        },
      }),
      Promise.all(
        employees.map(async (employee): Promise<AdminCrmEmployeePerformanceDto> => {
          const [
            employeeLeads,
            employeeOnboarded,
            employeeVisits,
            employeeOpen,
            employeeOverdue,
            employeeOpenTasks,
            employeeOverdueTasks,
            employeeCompletedTasks,
          ] = await Promise.all([
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
              this.prisma.employeeCrmTask.count({
                where: {
                  employeeProfileId: employee.id,
                  status: { in: [CrmTaskStatus.TODO, CrmTaskStatus.IN_PROGRESS] },
                },
              }),
              this.prisma.employeeCrmTask.count({
                where: {
                  employeeProfileId: employee.id,
                  status: { in: [CrmTaskStatus.TODO, CrmTaskStatus.IN_PROGRESS] },
                  dueAt: { lt: now },
                },
              }),
              this.prisma.employeeCrmTask.count({
                where: {
                  employeeProfileId: employee.id,
                  status: CrmTaskStatus.COMPLETED,
                  completedAt: { gte: thirtyDaysAgo },
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
            openTasks: employeeOpenTasks,
            overdueTasks: employeeOverdueTasks,
            completedTasksLast30Days: employeeCompletedTasks,
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
      this.prisma.employeeCrmTask.findMany({
        where: { status: { in: [CrmTaskStatus.TODO, CrmTaskStatus.IN_PROGRESS] } },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        take: OVERVIEW_ACTIVITY_LIMIT,
        include: { employeeProfile: true },
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
        openTasks,
        overdueTasks,
      },
      conversionRatePercent: leads > 0 ? Math.round((onboarded / leads) * 1000) / 10 : 0,
      performance,
      recentLeads: recentLeadRows.map((row) => this.leadDto(row)),
      recentVisits: recentVisitRows.map((row) => this.visitDto(row)),
      dueFollowUps: dueFollowUpRows.map((row) => this.followUpDto(row)),
      dueTasks: dueTaskRows.map((row) => this.taskDto(row)),
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

  async listTasks(
    employeeProfileId?: string,
    status?: string,
  ): Promise<AdminCrmTaskDto[]> {
    const normalizedStatus =
      status && Object.values(CrmTaskStatus).includes(status as CrmTaskStatus)
        ? (status as CrmTaskStatus)
        : undefined;
    const rows = await this.prisma.employeeCrmTask.findMany({
      where: {
        ...(employeeProfileId ? { employeeProfileId } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: ADMIN_LIST_LIMIT,
      include: { employeeProfile: true },
    });
    return rows.map((row) => this.taskDto(row));
  }

  async createTask(
    actorUserId: string,
    input: CreateCrmTaskInput,
  ): Promise<AdminCrmTaskDto> {
    const employee = await this.prisma.employeeProfile.findUnique({
      where: { id: input.employeeProfileId },
    });
    if (!employee) {
      throw new AppException(
        'EMPLOYEE_NOT_FOUND',
        'Employee not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeCrmTask.create({
        data: {
          employeeProfileId: employee.id,
          createdByUserId: actorUserId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          priority: input.priority,
        },
        include: { employeeProfile: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CRM_TASK_ASSIGNED',
          entityType: 'EmployeeCrmTask',
          entityId: created.id,
          metadata: {
            employeeCode: employee.employeeCode,
            priority: created.priority,
            dueAt: created.dueAt?.toISOString() ?? null,
          },
        },
      });
      return created;
    });
    return this.taskDto(row);
  }

  async updateTask(
    actorUserId: string,
    taskId: string,
    input: UpdateAdminCrmTaskInput,
  ): Promise<AdminCrmTaskDto> {
    const existing = await this.prisma.employeeCrmTask.findUnique({
      where: { id: taskId },
    });
    if (!existing) {
      throw new AppException(
        CrmErrorCode.TASK_NOT_FOUND,
        'Task not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (input.employeeProfileId) {
      const employee = await this.prisma.employeeProfile.findUnique({
        where: { id: input.employeeProfileId },
        select: { id: true },
      });
      if (!employee) {
        throw new AppException(
          'EMPLOYEE_NOT_FOUND',
          'Employee not found.',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const nextStatus = input.status ?? existing.status;
    const completed = nextStatus === CrmTaskStatus.COMPLETED;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeCrmTask.update({
        where: { id: taskId },
        data: {
          ...(input.employeeProfileId !== undefined
            ? { employeeProfileId: input.employeeProfileId }
            : {}),
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.dueAt !== undefined
            ? { dueAt: input.dueAt ? new Date(input.dueAt) : null }
            : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.completionNotes !== undefined
            ? { completionNotes: input.completionNotes?.trim() || null }
            : {}),
          ...(input.status !== undefined ? { completedAt: completed ? new Date() : null } : {}),
        },
        include: { employeeProfile: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CRM_TASK_ADMIN_UPDATED',
          entityType: 'EmployeeCrmTask',
          entityId: updated.id,
          metadata: {
            previousStatus: existing.status,
            status: updated.status,
            employeeCode: updated.employeeProfile.employeeCode,
          },
        },
      });
      return updated;
    });
    return this.taskDto(row);
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

  private taskDto(row: {
    id: string;
    title: string;
    description: string | null;
    dueAt: Date | null;
    priority: AdminCrmTaskDto['priority'];
    status: AdminCrmTaskDto['status'];
    completedAt: Date | null;
    completionNotes: string | null;
    createdAt: Date;
    updatedAt: Date;
    employeeProfile: {
      id: string;
      employeeCode: string;
      fullName: string;
      territory: string | null;
      joinedAt: Date;
    };
  }): AdminCrmTaskDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt?.toISOString() ?? null,
      priority: row.priority,
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
      completionNotes: row.completionNotes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
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
