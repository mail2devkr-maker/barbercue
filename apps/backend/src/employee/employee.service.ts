import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuthErrorCode,
  CrmErrorCode,
  CrmFollowUpStatus,
  CrmLeadStatus,
  CrmVisitOutcome,
  type CreateCrmFollowUpInput,
  type CreateCrmLeadInput,
  type CreateCrmVisitInput,
  type EmployeeCrmDashboardDto,
  type EmployeeCrmFollowUpDto,
  type EmployeeCrmLeadDto,
  type EmployeeCrmVisitDto,
  type EmployeeProfileDto,
  type OnboardCrmLeadInput,
  type UpdateCrmFollowUpInput,
  type UpdateCrmLeadInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

const LIST_LIMIT = 200;
const DASHBOARD_LIMIT = 8;

function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<EmployeeProfileDto> {
    const profile = await this.getProfileEntity(userId);
    return this.profileDto(profile);
  }

  async getDashboard(userId: string): Promise<EmployeeCrmDashboardDto> {
    const profile = await this.getProfileEntity(userId);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      leads,
      onboarded,
      visitsLast30Days,
      openFollowUps,
      overdueFollowUps,
      recentLeadRows,
      recentVisitRows,
      upcomingFollowUpRows,
    ] = await Promise.all([
      this.prisma.employeeCrmLead.count({ where: { employeeProfileId: profile.id } }),
      this.prisma.employeeCrmLead.count({
        where: { employeeProfileId: profile.id, status: CrmLeadStatus.ONBOARDED },
      }),
      this.prisma.employeeCrmVisit.count({
        where: { employeeProfileId: profile.id, visitedAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.employeeCrmFollowUp.count({
        where: { employeeProfileId: profile.id, status: CrmFollowUpStatus.OPEN },
      }),
      this.prisma.employeeCrmFollowUp.count({
        where: {
          employeeProfileId: profile.id,
          status: CrmFollowUpStatus.OPEN,
          dueAt: { lt: now },
        },
      }),
      this.prisma.employeeCrmLead.findMany({
        where: { employeeProfileId: profile.id },
        orderBy: { updatedAt: 'desc' },
        take: DASHBOARD_LIMIT,
        include: { onboardedSalon: { select: { id: true, publicId: true, name: true } } },
      }),
      this.prisma.employeeCrmVisit.findMany({
        where: { employeeProfileId: profile.id },
        orderBy: { visitedAt: 'desc' },
        take: DASHBOARD_LIMIT,
        include: { lead: { select: { shopName: true } } },
      }),
      this.prisma.employeeCrmFollowUp.findMany({
        where: { employeeProfileId: profile.id, status: CrmFollowUpStatus.OPEN },
        orderBy: { dueAt: 'asc' },
        take: DASHBOARD_LIMIT,
        include: { lead: { select: { shopName: true } } },
      }),
    ]);

    return {
      profile: this.profileDto(profile),
      counts: { leads, onboarded, visitsLast30Days, openFollowUps, overdueFollowUps },
      conversionRatePercent: leads > 0 ? Math.round((onboarded / leads) * 1000) / 10 : 0,
      recentLeads: recentLeadRows.map((row) => this.leadDto(row)),
      recentVisits: recentVisitRows.map((row) => this.visitDto(row)),
      upcomingFollowUps: upcomingFollowUpRows.map((row) => this.followUpDto(row)),
    };
  }

  async listLeads(userId: string, status?: string): Promise<EmployeeCrmLeadDto[]> {
    const profile = await this.getProfileEntity(userId);
    const normalizedStatus =
      status && Object.values(CrmLeadStatus).includes(status as CrmLeadStatus)
        ? (status as CrmLeadStatus)
        : undefined;

    const rows = await this.prisma.employeeCrmLead.findMany({
      where: {
        employeeProfileId: profile.id,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
      include: { onboardedSalon: { select: { id: true, publicId: true, name: true } } },
    });
    return rows.map((row) => this.leadDto(row));
  }

  async createLead(userId: string, input: CreateCrmLeadInput): Promise<EmployeeCrmLeadDto> {
    const profile = await this.getProfileEntity(userId);
    const row = await this.prisma.employeeCrmLead.create({
      data: {
        employeeProfileId: profile.id,
        shopName: input.shopName.trim(),
        contactName: emptyToNull(input.contactName) ?? null,
        phone: emptyToNull(input.phone) ?? null,
        email: emptyToNull(input.email)?.toLowerCase() ?? null,
        city: emptyToNull(input.city) ?? null,
        locality: emptyToNull(input.locality) ?? null,
        addressLine: emptyToNull(input.addressLine) ?? null,
        source: input.source,
        notes: emptyToNull(input.notes) ?? null,
      },
      include: { onboardedSalon: { select: { id: true, publicId: true, name: true } } },
    });
    return this.leadDto(row);
  }

  async updateLead(
    userId: string,
    leadId: string,
    input: UpdateCrmLeadInput,
  ): Promise<EmployeeCrmLeadDto> {
    const { profile, lead } = await this.requireOwnedLead(userId, leadId);
    if (input.status === CrmLeadStatus.ONBOARDED) {
      throw new AppException(
        CrmErrorCode.INVALID_LEAD_TRANSITION,
        'Use the onboarding action with a real FastQue Shop ID to mark a lead onboarded.',
        HttpStatus.CONFLICT,
      );
    }

    const row = await this.prisma.employeeCrmLead.update({
      where: { id: lead.id },
      data: {
        ...(input.shopName !== undefined ? { shopName: input.shopName.trim() } : {}),
        ...(input.contactName !== undefined ? { contactName: emptyToNull(input.contactName) ?? null } : {}),
        ...(input.phone !== undefined ? { phone: emptyToNull(input.phone) ?? null } : {}),
        ...(input.email !== undefined
          ? { email: input.email === null ? null : emptyToNull(input.email)?.toLowerCase() ?? null }
          : {}),
        ...(input.city !== undefined ? { city: emptyToNull(input.city) ?? null } : {}),
        ...(input.locality !== undefined ? { locality: emptyToNull(input.locality) ?? null } : {}),
        ...(input.addressLine !== undefined
          ? { addressLine: emptyToNull(input.addressLine) ?? null }
          : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: emptyToNull(input.notes) ?? null } : {}),
        ...(input.lostReason !== undefined
          ? { lostReason: emptyToNull(input.lostReason) ?? null }
          : input.status !== undefined && input.status !== CrmLeadStatus.LOST
            ? { lostReason: null }
            : {}),
      },
      include: { onboardedSalon: { select: { id: true, publicId: true, name: true } } },
    });

    // Keep the profile lookup materially used: it protects ownership before the write.
    void profile;
    return this.leadDto(row);
  }

  async onboardLead(
    userId: string,
    leadId: string,
    input: OnboardCrmLeadInput,
  ): Promise<EmployeeCrmLeadDto> {
    const { profile, lead } = await this.requireOwnedLead(userId, leadId);
    if (lead.status === CrmLeadStatus.ONBOARDED && lead.onboardedSalonId) {
      const existing = await this.getLeadById(profile.id, lead.id);
      if (existing.onboardedSalon?.publicId === input.salonPublicId) {
        return existing;
      }
      throw new AppException(
        CrmErrorCode.INVALID_LEAD_TRANSITION,
        `This lead is already attributed to ${existing.onboardedSalon?.publicId ?? 'another FastQue shop'}.`,
        HttpStatus.CONFLICT,
      );
    }

    const salon = await this.prisma.salon.findUnique({
      where: { publicId: input.salonPublicId },
      select: { id: true, publicId: true, name: true },
    });
    if (!salon) {
      throw new AppException(
        CrmErrorCode.SALON_NOT_FOUND,
        'No FastQue shop exists with that Shop ID.',
        HttpStatus.NOT_FOUND,
      );
    }

    const existingAttribution = await this.prisma.employeeCrmLead.findFirst({
      where: { onboardedSalonId: salon.id, NOT: { id: lead.id } },
      select: { id: true },
    });
    if (existingAttribution) {
      throw new AppException(
        CrmErrorCode.SALON_ALREADY_ATTRIBUTED,
        'This FastQue shop is already attributed to another CRM lead.',
        HttpStatus.CONFLICT,
      );
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeCrmLead.update({
          where: { id: lead.id },
          data: {
            status: CrmLeadStatus.ONBOARDED,
            onboardedSalonId: salon.id,
            onboardedAt: new Date(),
            lostReason: null,
          },
        });
        await tx.employeeCrmFollowUp.updateMany({
          where: { leadId: lead.id, status: CrmFollowUpStatus.OPEN },
          data: {
            status: CrmFollowUpStatus.COMPLETED,
            completedAt: new Date(),
            outcome: 'Shop onboarded on FastQue',
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'CRM_LEAD_ONBOARDED',
            entityType: 'EmployeeCrmLead',
            entityId: lead.id,
            metadata: {
              employeeCode: profile.employeeCode,
              shopPublicId: salon.publicId,
              shopName: salon.name,
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          CrmErrorCode.SALON_ALREADY_ATTRIBUTED,
          'This FastQue shop is already attributed to another CRM lead.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    return this.getLeadById(profile.id, lead.id);
  }

  async listVisits(userId: string): Promise<EmployeeCrmVisitDto[]> {
    const profile = await this.getProfileEntity(userId);
    const rows = await this.prisma.employeeCrmVisit.findMany({
      where: { employeeProfileId: profile.id },
      orderBy: { visitedAt: 'desc' },
      take: LIST_LIMIT,
      include: { lead: { select: { shopName: true } } },
    });
    return rows.map((row) => this.visitDto(row));
  }

  async createVisit(userId: string, input: CreateCrmVisitInput): Promise<EmployeeCrmVisitDto> {
    const profile = await this.getProfileEntity(userId);
    let lead: { id: string; shopName: string; status: CrmLeadStatus } | null = null;
    if (input.leadId) {
      const owned = await this.requireOwnedLead(userId, input.leadId, profile);
      lead = {
        id: owned.lead.id,
        shopName: owned.lead.shopName,
        status: owned.lead.status,
      };
    }

    const visitedAt = input.visitedAt ? new Date(input.visitedAt) : new Date();
    if (visitedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new AppException(
        CrmErrorCode.INVALID_LEAD_TRANSITION,
        'A completed field visit cannot be recorded in the future. Schedule a follow-up instead.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const shopName = (emptyToNull(input.shopName) ?? lead?.shopName)?.trim();
    if (!shopName) {
      throw new AppException(
        CrmErrorCode.LEAD_NOT_FOUND,
        'Choose a lead or enter the shop name.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeCrmVisit.create({
        data: {
          employeeProfileId: profile.id,
          leadId: lead?.id ?? null,
          shopName,
          visitedAt,
          outcome: input.outcome,
          notes: emptyToNull(input.notes) ?? null,
        },
        include: { lead: { select: { shopName: true } } },
      });

      if (lead && lead.status !== CrmLeadStatus.ONBOARDED && lead.status !== CrmLeadStatus.LOST) {
        const nextStatus =
          input.outcome === CrmVisitOutcome.INTERESTED ||
          input.outcome === CrmVisitOutcome.DEMO_COMPLETED
            ? CrmLeadStatus.INTERESTED
            : input.outcome === CrmVisitOutcome.FOLLOW_UP_REQUIRED
              ? CrmLeadStatus.FOLLOW_UP
              : lead.status === CrmLeadStatus.NEW
                ? CrmLeadStatus.CONTACTED
                : null;
        if (nextStatus && nextStatus !== lead.status) {
          await tx.employeeCrmLead.update({ where: { id: lead.id }, data: { status: nextStatus } });
        }
      }
      return created;
    });

    return this.visitDto(row);
  }

  async listFollowUps(userId: string, status?: string): Promise<EmployeeCrmFollowUpDto[]> {
    const profile = await this.getProfileEntity(userId);
    const normalizedStatus =
      status && Object.values(CrmFollowUpStatus).includes(status as CrmFollowUpStatus)
        ? (status as CrmFollowUpStatus)
        : undefined;
    const rows = await this.prisma.employeeCrmFollowUp.findMany({
      where: {
        employeeProfileId: profile.id,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: LIST_LIMIT,
      include: { lead: { select: { shopName: true } } },
    });
    return rows.map((row) => this.followUpDto(row));
  }

  async createFollowUp(
    userId: string,
    input: CreateCrmFollowUpInput,
  ): Promise<EmployeeCrmFollowUpDto> {
    const { profile, lead } = await this.requireOwnedLead(userId, input.leadId);
    if (lead.status === CrmLeadStatus.ONBOARDED) {
      throw new AppException(
        CrmErrorCode.INVALID_LEAD_TRANSITION,
        'This lead is already onboarded.',
        HttpStatus.CONFLICT,
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeCrmFollowUp.create({
        data: {
          employeeProfileId: profile.id,
          leadId: lead.id,
          dueAt: new Date(input.dueAt),
          channel: input.channel,
          notes: emptyToNull(input.notes) ?? null,
        },
        include: { lead: { select: { shopName: true } } },
      });
      if (
        lead.status === CrmLeadStatus.NEW ||
        lead.status === CrmLeadStatus.CONTACTED
      ) {
        await tx.employeeCrmLead.update({
          where: { id: lead.id },
          data: { status: CrmLeadStatus.FOLLOW_UP },
        });
      }
      return created;
    });
    return this.followUpDto(row);
  }

  async updateFollowUp(
    userId: string,
    followUpId: string,
    input: UpdateCrmFollowUpInput,
  ): Promise<EmployeeCrmFollowUpDto> {
    const profile = await this.getProfileEntity(userId);
    const existing = await this.prisma.employeeCrmFollowUp.findFirst({
      where: { id: followUpId, employeeProfileId: profile.id },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new AppException(
        CrmErrorCode.FOLLOW_UP_NOT_FOUND,
        'Follow-up not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const nextStatus = input.status ?? existing.status;
    const terminal =
      nextStatus === CrmFollowUpStatus.COMPLETED ||
      nextStatus === CrmFollowUpStatus.CANCELLED;
    const row = await this.prisma.employeeCrmFollowUp.update({
      where: { id: existing.id },
      data: {
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: emptyToNull(input.notes) ?? null } : {}),
        ...(input.outcome !== undefined ? { outcome: emptyToNull(input.outcome) ?? null } : {}),
        ...(input.status !== undefined
          ? { completedAt: terminal ? new Date() : null }
          : {}),
      },
      include: { lead: { select: { shopName: true } } },
    });
    return this.followUpDto(row);
  }

  private async requireOwnedLead(
    userId: string,
    leadId: string,
    knownProfile?: Awaited<ReturnType<EmployeeService['getProfileEntity']>>,
  ) {
    const profile = knownProfile ?? (await this.getProfileEntity(userId));
    const lead = await this.prisma.employeeCrmLead.findFirst({
      where: { id: leadId, employeeProfileId: profile.id },
    });
    if (!lead) {
      throw new AppException(
        CrmErrorCode.LEAD_NOT_FOUND,
        'Lead not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { profile, lead };
  }

  private async getLeadById(profileId: string, leadId: string): Promise<EmployeeCrmLeadDto> {
    const row = await this.prisma.employeeCrmLead.findFirst({
      where: { id: leadId, employeeProfileId: profileId },
      include: { onboardedSalon: { select: { id: true, publicId: true, name: true } } },
    });
    if (!row) {
      throw new AppException(
        CrmErrorCode.LEAD_NOT_FOUND,
        'Lead not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.leadDto(row);
  }

  private async getProfileEntity(userId: string) {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        territory: true,
        joinedAt: true,
      },
    });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.FORBIDDEN_ROLE,
        'Employee profile is not configured.',
        HttpStatus.FORBIDDEN,
      );
    }
    return profile;
  }

  private profileDto(profile: {
    id: string;
    employeeCode: string;
    fullName: string;
    territory: string | null;
    joinedAt: Date;
  }): EmployeeProfileDto {
    return {
      ...profile,
      joinedAt: profile.joinedAt.toISOString(),
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
    source: EmployeeCrmLeadDto['source'];
    status: EmployeeCrmLeadDto['status'];
    notes: string | null;
    lostReason: string | null;
    onboardedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    onboardedSalon: { id: string; publicId: string; name: string } | null;
  }): EmployeeCrmLeadDto {
    return {
      ...row,
      onboardedAt: row.onboardedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private visitDto(row: {
    id: string;
    leadId: string | null;
    shopName: string;
    visitedAt: Date;
    outcome: EmployeeCrmVisitDto['outcome'];
    notes: string | null;
    createdAt: Date;
    lead: { shopName: string } | null;
  }): EmployeeCrmVisitDto {
    return {
      id: row.id,
      leadId: row.leadId,
      leadShopName: row.lead?.shopName ?? null,
      shopName: row.shopName,
      visitedAt: row.visitedAt.toISOString(),
      outcome: row.outcome,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private followUpDto(row: {
    id: string;
    leadId: string;
    dueAt: Date;
    channel: EmployeeCrmFollowUpDto['channel'];
    status: EmployeeCrmFollowUpDto['status'];
    notes: string | null;
    outcome: string | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lead: { shopName: string };
  }): EmployeeCrmFollowUpDto {
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
    };
  }
}
