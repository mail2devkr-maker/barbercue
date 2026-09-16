import { HttpStatus, Injectable } from '@nestjs/common';
import { BookingErrorCode, QueueErrorCode, Role, SalonStatus } from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../exceptions/app.exception';

export type SalonAccessActor = 'OWNER' | 'PLATFORM_ADMIN';

/**
 * "May this authenticated user operate the dashboard for salonId X" — checked against `UserRole`,
 * NOT `SalonStaff`. An owner has authority over their salon but no roster row (only barbers/
 * managers who can actually be assigned to serve customers get a `SalonStaff` entry) — see
 * prisma/seed.ts. Shared by both the queue module's REST endpoints and the realtime gateway's
 * `join:salon` handler, so the two never drift.
 */
@Injectable()
export class SalonAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAccess(userId: string, salonId: string): Promise<void> {
    await this.assertRoles(userId, salonId, [
      Role.SALON_STAFF,
      Role.SALON_OWNER,
    ]);
  }

  /**
   * Owner-only controllers still need a salon-scoped owner check. RolesGuard proves that the
   * caller owns *a* salon, not necessarily this one; accepting a SALON_STAFF membership here
   * would let an owner of salon A use owner-only routes at salon B where they are only staff.
   */
  async assertOwnerAccess(userId: string, salonId: string): Promise<void> {
    await this.assertRoles(userId, salonId, [Role.SALON_OWNER]);
  }

  /**
   * Part 2 (admin delegated shop management) — grants access to the salon's owner, OR a
   * PLATFORM_ADMIN performing explicit delegated management on a selected salon in any operational
   * status. Deliberately a NEW, opt-in
   * method rather than a change to assertOwnerAccess above: every existing owner-only call site
   * keeps its exact current behavior unless a service explicitly switches to this one, so admin
   * access only ever reaches the specific mutations that have been reviewed and wired for it (and
   * paired with an AuditLog write — see each caller) — never silently broadened everywhere
   * assertOwnerAccess happens to be used.
   *
   * PLATFORM_ADMIN is a global role (UserRole row with salonId: null — see auth.service.ts's own
   * `roles = user.roles.map(r => r.role)`), so RolesGuard's `@Roles(Role.PLATFORM_ADMIN)` already
   * proves "this caller is a real admin" from their JWT; this method's own DB read of the admin's
   * UserRole is a defense-in-depth re-check, not the only line of defense. Lifecycle transitions
   * apply their own server-side readiness and status rules.
   */
  async assertOwnerOrAdminAccess(
    userId: string,
    salonId: string,
  ): Promise<SalonAccessActor> {
    const ownerMembership = await this.prisma.userRole.findFirst({
      where: { userId, salonId, role: Role.SALON_OWNER },
    });
    if (ownerMembership) return 'OWNER';
    return this.assertGlobalAdminAccess(userId, salonId);
  }

  /**
   * Part 2 (admin delegated shop management) — the Live Queue equivalent of
   * assertOwnerOrAdminAccess above: queue operations (call/assign/reassign/no-show/cancel/
   * complete/getDashboardQueue/getCapacitySummary) are legitimately run by ordinary SALON_STAFF
   * too, not just the owner — see assertAccess above, which this mirrors — so the owner-only
   * variant would incorrectly reject a real barber. The delegated path still requires a global
   * admin role and a selected existing salon.
   */
  async assertAccessOrAdminAccess(
    userId: string,
    salonId: string,
  ): Promise<'STAFF_OR_OWNER' | 'PLATFORM_ADMIN'> {
    const membership = await this.prisma.userRole.findFirst({
      where: { userId, salonId, role: { in: [Role.SALON_STAFF, Role.SALON_OWNER] } },
    });
    if (membership) return 'STAFF_OR_OWNER';
    return this.assertGlobalAdminOperationalAccess(userId, salonId);
  }

  /** Explicit platform-admin gate for lifecycle operations. */
  async assertPlatformAdminAccess(
    userId: string,
    salonId: string,
  ): Promise<'PLATFORM_ADMIN'> {
    return this.assertGlobalAdminAccess(userId, salonId);
  }

  /**
   * Global-admin-scope fix: PLATFORM_ADMIN is only ever a global role — explicitly required here
   * rather than assumed, so a hypothetical salon-scoped PLATFORM_ADMIN row (which a DB CHECK
   * constraint now also makes impossible to persist at all) could never grant delegated access.
   * This path is used by setup/lifecycle management across PENDING, ACTIVE, and SUSPENDED salons;
   * queue/operational delegated access uses assertGlobalAdminOperationalAccess instead and remains
   * restricted to ACTIVE salons.
   */
  private async assertGlobalAdminAccess(
    userId: string,
    salonId: string,
  ): Promise<'PLATFORM_ADMIN'> {
    const adminMembership = await this.prisma.userRole.findFirst({
      where: { userId, role: Role.PLATFORM_ADMIN, salonId: null },
    });
    if (adminMembership) {
      const salon = await this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { status: true },
      });
      if (!salon) {
        throw new AppException(
          BookingErrorCode.SALON_NOT_FOUND,
          'Shop not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      return 'PLATFORM_ADMIN';
    }

    throw new AppException(
      QueueErrorCode.SALON_ACCESS_DENIED,
      'You do not have access to this salon.',
      HttpStatus.FORBIDDEN,
    );
  }

  /**
   * Queue/operational delegated access remains limited to ACTIVE salons. Setup and lifecycle
   * management use assertGlobalAdminAccess above so admins can support PENDING and SUSPENDED
   * salons without accidentally exposing queue operations for non-operational shops.
   */
  private async assertGlobalAdminOperationalAccess(
    userId: string,
    salonId: string,
  ): Promise<'PLATFORM_ADMIN'> {
    const adminMembership = await this.prisma.userRole.findFirst({
      where: { userId, role: Role.PLATFORM_ADMIN, salonId: null },
    });
    if (!adminMembership) {
      throw new AppException(
        QueueErrorCode.SALON_ACCESS_DENIED,
        'You do not have access to this salon.',
        HttpStatus.FORBIDDEN,
      );
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { status: true },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (salon.status !== SalonStatus.ACTIVE) {
      throw new AppException(
        QueueErrorCode.SALON_ACCESS_DENIED,
        'You do not have access to this salon.',
        HttpStatus.FORBIDDEN,
      );
    }
    return 'PLATFORM_ADMIN';
  }

  private async assertRoles(
    userId: string,
    salonId: string,
    roles: Role[],
  ): Promise<void> {
    const membership = await this.prisma.userRole.findFirst({
      where: {
        userId,
        salonId,
        role: { in: roles },
      },
    });
    if (!membership) {
      throw new AppException(
        QueueErrorCode.SALON_ACCESS_DENIED,
        'You do not have access to this salon.',
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
