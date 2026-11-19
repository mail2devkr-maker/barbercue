import { Injectable } from '@nestjs/common';
import { WorkOrgMemberRole, WorkOrgStatus, WorkParty, type WorkOrganization } from '@prisma/client';
import type { WorkOrgDto, WorkOrgUpsertInput } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkAccessService } from './work-access.service';
import { WorkAuditService } from './work-audit.service';
import { workInvalidState, workNotFound, workValidation } from './work-errors';

/**
 * Employer organizations and their verification (business KYC). Verification here is a real,
 * human review by a platform administrator of the submitted business details. No automated
 * identity/GST lookup provider is connected yet — that is an integration in the backlog, and
 * nothing in the product claims it happened.
 */
@Injectable()
export class WorkOrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkAccessService,
    private readonly audit: WorkAuditService,
  ) {}

  toDto(org: WorkOrganization, myRole: WorkOrgMemberRole | null): WorkOrgDto {
    return {
      id: org.id,
      legalName: org.legalName,
      displayName: org.displayName,
      orgType: org.orgType,
      gstin: org.gstin,
      registeredAddress: org.registeredAddress,
      city: org.city,
      contactName: org.contactName,
      contactPhone: org.contactPhone,
      contactEmail: org.contactEmail,
      status: org.status,
      rejectionReason: org.rejectionReason,
      myRole,
      createdAt: org.createdAt.toISOString(),
    };
  }

  async mine(userId: string): Promise<WorkOrgDto[]> {
    const rows = await this.prisma.workOrgMember.findMany({ where: { userId }, include: { org: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => this.toDto(m.org, m.role));
  }

  async create(userId: string, input: WorkOrgUpsertInput): Promise<WorkOrgDto> {
    const existing = await this.prisma.workOrgMember.count({ where: { userId, role: WorkOrgMemberRole.OWNER } });
    if (existing >= 5) throw workValidation('You can own at most five organizations.');
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.workOrganization.create({
        data: { ...input, gstin: input.gstin ?? null, createdById: userId, members: { create: { userId, role: WorkOrgMemberRole.OWNER } } },
      });
      await this.audit.record(tx, { entityType: 'ORG', entityId: org.id, action: 'ORG_CREATED', toStatus: org.status, actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId: org.id });
      return this.toDto(org, WorkOrgMemberRole.OWNER);
    });
  }

  async update(userId: string, orgId: string, input: WorkOrgUpsertInput): Promise<WorkOrgDto> {
    const { org, role } = await this.access.requireOrgRole(userId, orgId, [WorkOrgMemberRole.OWNER]);
    if (!([WorkOrgStatus.DRAFT, WorkOrgStatus.REJECTED] as WorkOrgStatus[]).includes(org.status)) {
      throw workInvalidState('Business details can only be changed before submission or after a rejection.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.workOrganization.update({ where: { id: orgId }, data: { ...input, gstin: input.gstin ?? null } });
      await this.audit.record(tx, { entityType: 'ORG', entityId: orgId, action: 'ORG_UPDATED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId });
      return u;
    });
    return this.toDto(updated, role);
  }

  async submit(userId: string, orgId: string): Promise<WorkOrgDto> {
    const { org, role } = await this.access.requireOrgRole(userId, orgId, [WorkOrgMemberRole.OWNER]);
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.workOrganization.updateMany({
        where: { id: orgId, status: { in: [WorkOrgStatus.DRAFT, WorkOrgStatus.REJECTED] } },
        data: { status: WorkOrgStatus.SUBMITTED, submittedAt: new Date(), rejectionReason: null },
      });
      if (!res.count) throw workInvalidState('This organization has already been submitted.');
      await this.audit.record(tx, { entityType: 'ORG', entityId: orgId, action: 'KYC_SUBMITTED', fromStatus: org.status, toStatus: 'SUBMITTED', actorUserId: userId, actorParty: WorkParty.EMPLOYER, orgId });
      return tx.workOrganization.findUniqueOrThrow({ where: { id: orgId } });
    });
    return this.toDto(updated, role);
  }

  async adminList(status?: WorkOrgStatus): Promise<WorkOrgDto[]> {
    const rows = await this.prisma.workOrganization.findMany({
      where: status ? { status } : {},
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return rows.map((o) => this.toDto(o, null));
  }

  async adminReview(adminId: string, orgId: string, decision: 'MARK_UNDER_REVIEW' | 'VERIFY' | 'REJECT' | 'SUSPEND', reason?: string): Promise<WorkOrgDto> {
    const allowedFrom: Record<typeof decision, WorkOrgStatus[]> = {
      MARK_UNDER_REVIEW: [WorkOrgStatus.SUBMITTED],
      VERIFY: [WorkOrgStatus.SUBMITTED, WorkOrgStatus.UNDER_REVIEW, WorkOrgStatus.SUSPENDED],
      REJECT: [WorkOrgStatus.SUBMITTED, WorkOrgStatus.UNDER_REVIEW],
      SUSPEND: [WorkOrgStatus.VERIFIED],
    };
    const to: Record<typeof decision, WorkOrgStatus> = {
      MARK_UNDER_REVIEW: WorkOrgStatus.UNDER_REVIEW,
      VERIFY: WorkOrgStatus.VERIFIED,
      REJECT: WorkOrgStatus.REJECTED,
      SUSPEND: WorkOrgStatus.SUSPENDED,
    };
    if ((decision === 'REJECT' || decision === 'SUSPEND') && !reason?.trim()) {
      throw workValidation('A reason is required — the business is shown it.');
    }
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.workOrganization.findUnique({ where: { id: orgId } });
      if (!org) throw workNotFound('Organization not found.');
      const res = await tx.workOrganization.updateMany({
        where: { id: orgId, status: { in: allowedFrom[decision] } },
        data: {
          status: to[decision],
          reviewedAt: new Date(),
          reviewedById: adminId,
          rejectionReason: decision === 'REJECT' || decision === 'SUSPEND' ? reason!.trim() : null,
        },
      });
      if (!res.count) throw workInvalidState(`Cannot ${decision.toLowerCase().replace(/_/g, ' ')} an organization that is ${org.status}.`);
      await this.audit.record(tx, { entityType: 'ORG', entityId: orgId, action: `KYC_${decision}`, fromStatus: org.status, toStatus: to[decision], actorUserId: adminId, actorParty: WorkParty.PLATFORM, orgId, note: reason ?? null });
      return this.toDto(await tx.workOrganization.findUniqueOrThrow({ where: { id: orgId } }), null);
    });
  }
}
