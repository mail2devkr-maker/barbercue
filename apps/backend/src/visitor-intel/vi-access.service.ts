import { Injectable } from '@nestjs/common';
import {
  Role,
  VI_STAFF_ROLES,
  viCapabilitiesFor,
  type AuthenticatedUser,
  type ViCapability,
  type ViScope,
  type ViStaffRole,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { viForbidden } from './vi-common';

/** Internal roles that may hold a Visitor Intelligence staff responsibility (vi_staff_roles). */
const INTERNAL = new Set<string>([
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.HR_ADMIN,
  Role.SALES_ADMIN,
  Role.PLATFORM_VIEWER,
]);
const PLATFORM_SCOPE = new Set<string>([
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.PLATFORM_VIEWER,
  Role.SALES_ADMIN,
]);

export interface ViActor {
  userId: string;
  roles: string[];
  staffRoles: ViStaffRole[];
  capabilities: Set<ViCapability>;
  scope: ViScope;
}

/**
 * Who may see what (docs/visitor-intelligence/README.md (RBAC)). Roles are the intersection of the session's
 * (audience-scoped) token roles and what the database says the user still holds, so a revoked role
 * stops working immediately and a customer-audience session can never gain admin rights here.
 */
@Injectable()
export class ViAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async actor(user: AuthenticatedUser): Promise<ViActor> {
    const dbRoles = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      select: { role: true, salonId: true },
    });
    const held = new Set(dbRoles.map((r) => r.role as string));
    const roles = (user.roles as string[]).filter((r) => held.has(r));
    const internal = roles.some((r) => INTERNAL.has(r));
    const staffRoles = internal
      ? (
          await this.prisma.viStaffRole.findMany({
            where: { userId: user.id },
            select: { role: true },
          })
        )
          .map((r) => r.role)
          .filter((r) => (VI_STAFF_ROLES as readonly string[]).includes(r))
      : [];
    const capabilities = viCapabilitiesFor([...roles, ...staffRoles]);

    let scope: ViScope;
    if (roles.some((r) => PLATFORM_SCOPE.has(r)) || staffRoles.length) {
      scope = { kind: 'platform' };
    } else if (roles.includes(Role.FIELD_EXECUTIVE)) {
      const profile = await this.prisma.employeeProfile.findUnique({
        where: { userId: user.id },
        select: { territory: true },
      });
      const cities = (profile?.territory ?? '')
        .split(/[,;/|]/)
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 50);
      scope = { kind: 'territory', cities };
    } else if (roles.includes(Role.SALON_OWNER)) {
      const salons = await this.prisma.salon.findMany({
        where: { ownerUserId: user.id },
        select: { id: true },
      });
      scope = { kind: 'salon', salonIds: salons.map((s) => s.id) };
    } else {
      scope = { kind: 'salon', salonIds: [] };
    }
    return { userId: user.id, roles, staffRoles, capabilities, scope };
  }

  async require(
    user: AuthenticatedUser,
    ...caps: ViCapability[]
  ): Promise<ViActor> {
    const a = await this.actor(user);
    if (!caps.every((c) => a.capabilities.has(c))) throw viForbidden();
    return a;
  }

  /** Salon owners: only salons they own. Admin-scope actors may read any salon. */
  async requireSalon(
    user: AuthenticatedUser,
    salonId: string,
  ): Promise<ViActor> {
    const a = await this.actor(user);
    if (a.scope.kind === 'platform' && a.capabilities.has('overview')) return a;
    if (a.scope.kind === 'salon' && a.scope.salonIds.includes(salonId))
      return a;
    throw viForbidden('You can only see analytics for your own salon.');
  }
}
