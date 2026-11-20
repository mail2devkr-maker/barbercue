import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WorkOrgMemberRole,
  type WorkOrganization,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { workForbidden, workNotFound } from './work-errors';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Organization-level tenant isolation for the marketplace. Every employer route resolves the
 * caller's membership here at request time (never from a token claim, which could be stale) and
 * every query below it is additionally scoped by orgId. A non-member gets the same 404 as a
 * missing organization, so organization ids cannot be probed.
 */
@Injectable()
export class WorkAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireOrgRole(
    userId: string,
    orgId: string,
    allowed: WorkOrgMemberRole[] = [
      WorkOrgMemberRole.OWNER,
      WorkOrgMemberRole.MANAGER,
      WorkOrgMemberRole.BILLING,
    ],
    db: Db = this.prisma,
  ): Promise<{ org: WorkOrganization; role: WorkOrgMemberRole }> {
    const member = await db.workOrgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { org: true },
    });
    if (!member) throw workNotFound('Organization not found.');
    if (!allowed.includes(member.role)) {
      throw workForbidden(
        'Your role in this organization does not allow this action.',
      );
    }
    return { org: member.org, role: member.role };
  }

  async memberOrgIds(userId: string, db: Db = this.prisma): Promise<string[]> {
    const rows = await db.workOrgMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    return rows.map((r) => r.orgId);
  }

  async isOrgMember(
    userId: string,
    orgId: string,
    db: Db = this.prisma,
  ): Promise<boolean> {
    const row = await db.workOrgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { id: true },
    });
    return !!row;
  }
}

export const JOB_EDITORS: WorkOrgMemberRole[] = [
  WorkOrgMemberRole.OWNER,
  WorkOrgMemberRole.MANAGER,
];
export const JOB_FUNDERS: WorkOrgMemberRole[] = [
  WorkOrgMemberRole.OWNER,
  WorkOrgMemberRole.BILLING,
];
