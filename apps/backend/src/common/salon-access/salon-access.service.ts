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
   * PLATFORM_ADMIN performing delegated management on an ACTIVE salon. Deliberately a NEW, opt-in
   * method rather than a change to assertOwnerAccess above: every existing owner-only call site
   * keeps its exact current behavior unless a service explicitly switches to this one, so admin
   * access only ever reaches the specific mutations that have been reviewed and wired for it (and
   * paired with an AuditLog write — see each caller) — never silently broadened everywhere
   * assertOwnerAccess happens to be used.
   *
   * PLATFORM_ADMIN is a global role (UserRole row with salonId: null — see auth.service.ts's own
   * `roles = user.roles.map(r => r.role)`), so RolesGuard's `@Roles(Role.PLATFORM_ADMIN)` already
   * proves "this caller is a real admin" from their JWT; this method's own DB read of the admin's
   * UserRole is a defense-in-depth re-check, not the only line of defense. The ACTIVE-only rule is
   * the real gate here: a PENDING or SUSPENDED salon is never delegated-manageable, regardless of
   * admin status (see Part 2's own "no moderation backdoor" instruction).
   */
  async assertOwnerOrAdminAccess(
    userId: string,
    salonId: string,
  ): Promise<SalonAccessActor> {
    const ownerMembership = await this.prisma.userRole.findFirst({
      where: { userId, salonId, role: Role.SALON_OWNER },
    });
    if (ownerMembership) return 'OWNER';

    const adminMembership = await this.prisma.userRole.findFirst({
      where: { userId, role: Role.PLATFORM_ADMIN },
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
      if (salon.status !== SalonStatus.ACTIVE) {
        throw new AppException(
          QueueErrorCode.SALON_ACCESS_DENIED,
          'FastQue Admin can only manage shops that are currently active.',
          HttpStatus.FORBIDDEN,
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
