import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role, type AuthenticatedUser, type CrmMeDto } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { salesCoachProvider } from './sales-coach.provider';

/**
 * Who is calling and what they may see. The scope ALWAYS comes from the authenticated user's own
 * roles and employee profile — never from an id in the request:
 *   FIELD_EMPLOYEE  (FIELD_EXECUTIVE) — only leads/activity assigned to their own employee profile
 *   SALES_MANAGER   (SALES_ADMIN)     — the whole field team (FastQue has one sales team today)
 *   ADMIN           (PLATFORM_ADMIN, CO_FOUNDER) — organisation-wide, plus approvals and config
 *   VIEWER          (PLATFORM_VIEWER) — organisation-wide, read only
 */
export interface CrmActor {
  userId: string;
  kind: CrmMeDto['role'];
  employeeProfileId: string | null;
  /** May read everything (not just own records). */
  team: boolean;
  /** May change records. */
  write: boolean;
  /** May import/assign leads, manage tickets, review recordings. */
  manage: boolean;
}

export const CRM_ROLES = [
  Role.FIELD_EXECUTIVE,
  Role.SALES_ADMIN,
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.PLATFORM_VIEWER,
] as const;

export function forbidden(
  message = 'You do not have access to this record.',
): AppException {
  return new AppException('CRM_FORBIDDEN', message, HttpStatus.FORBIDDEN);
}
export function notFound(what = 'Record'): AppException {
  return new AppException(
    'CRM_NOT_FOUND',
    `${what} not found.`,
    HttpStatus.NOT_FOUND,
  );
}

@Injectable()
export class CrmAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async actor(user: AuthenticatedUser): Promise<CrmActor> {
    // Re-read roles from the database (defence in depth: the token says what the user had at login).
    const roles = new Set(
      (
        await this.prisma.userRole.findMany({
          where: { userId: user.id, salonId: null },
          select: { role: true },
        })
      ).map((r) => r.role),
    );
    const tokenRoles = new Set(user.roles);
    const has = (r: Role) => roles.has(r) && tokenRoles.has(r);
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (has(Role.PLATFORM_ADMIN) || has(Role.CO_FOUNDER))
      return {
        userId: user.id,
        kind: 'ADMIN',
        employeeProfileId: profile?.id ?? null,
        team: true,
        write: true,
        manage: true,
      };
    if (has(Role.SALES_ADMIN))
      return {
        userId: user.id,
        kind: 'SALES_MANAGER',
        employeeProfileId: profile?.id ?? null,
        team: true,
        write: true,
        manage: true,
      };
    if (has(Role.FIELD_EXECUTIVE)) {
      if (!profile)
        throw new AppException(
          'CRM_NO_EMPLOYEE_PROFILE',
          'Your employee profile is not set up yet. Ask an admin.',
          HttpStatus.FORBIDDEN,
        );
      return {
        userId: user.id,
        kind: 'FIELD_EMPLOYEE',
        employeeProfileId: profile.id,
        team: false,
        write: true,
        manage: false,
      };
    }
    if (has(Role.PLATFORM_VIEWER))
      return {
        userId: user.id,
        kind: 'VIEWER',
        employeeProfileId: null,
        team: true,
        write: false,
        manage: false,
      };
    throw forbidden('The CRM is for FastQue field and sales staff.');
  }

  /** Lead filter for the actor's scope. */
  leadScope(a: CrmActor): Prisma.EmployeeCrmLeadWhereInput {
    return a.team ? {} : { employeeProfileId: a.employeeProfileId! };
  }

  /** Employee-profile filter for activity rows (tasks/meetings/calls/recordings). */
  employeeScope(a: CrmActor, requested?: string | null): string | undefined {
    if (!a.team) return a.employeeProfileId!;
    return requested ?? undefined;
  }

  assertWrite(a: CrmActor): void {
    if (!a.write) throw forbidden('View-only access.');
  }

  assertManage(a: CrmActor): void {
    if (!a.manage)
      throw forbidden('Only sales managers and admins can do this.');
  }

  /** The lead, if the actor may see it. */
  async lead(a: CrmActor, leadId: string) {
    const lead = await this.prisma.employeeCrmLead.findFirst({
      where: { id: leadId, ...this.leadScope(a) },
    });
    if (!lead) throw notFound('Lead');
    return lead;
  }

  /** Which employee profile new work is owned by: the field employee themself, or (managers) whoever they name. */
  async ownerFor(
    a: CrmActor,
    requested?: string | null,
    fallback?: string,
  ): Promise<string> {
    if (!a.team) return a.employeeProfileId!;
    const id = requested ?? fallback ?? a.employeeProfileId;
    if (!id)
      throw new AppException(
        'CRM_EMPLOYEE_REQUIRED',
        'Choose the employee this is for.',
        HttpStatus.BAD_REQUEST,
      );
    const exists = await this.prisma.employeeProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw notFound('Employee');
    return id;
  }

  me(a: CrmActor, employee: CrmMeDto['employee']): CrmMeDto {
    const ai = salesCoachProvider();
    return {
      role: a.kind,
      employee,
      can: {
        importLeads: a.manage,
        assignLeads: a.manage,
        reviewRecordings: a.manage,
        manageTickets: a.manage,
        viewTeam: a.team,
        approveOnboarding: a.kind === 'ADMIN',
      },
      ai: { configured: ai.configured, enabled: ai.enabled, provider: ai.name },
    };
  }
}
