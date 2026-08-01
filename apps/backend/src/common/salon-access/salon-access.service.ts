import { HttpStatus, Injectable } from '@nestjs/common';
import { QueueErrorCode, Role } from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../exceptions/app.exception';

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
    const membership = await this.prisma.userRole.findFirst({
      where: {
        userId,
        salonId,
        role: { in: [Role.SALON_STAFF, Role.SALON_OWNER] },
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
