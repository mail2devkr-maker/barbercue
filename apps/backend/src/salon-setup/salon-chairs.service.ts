import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ChairStatus,
  QueueErrorCode,
  type CreateSalonChairInput,
  type SalonChairDto,
  type UpdateSalonChairInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

/**
 * Owner-side Chair CRUD, same assertOwnerAccess-first shape as SalonServicesService.
 *
 * Chairs matter more than they look: bookable capacity is `min(activeQualifiedStaff,
 * activeChairs)` (see computeSlotCapacity), so a salon with zero ACTIVE chairs has capacity 0 and
 * nobody can be assigned no matter how many barbers are on the roster. Like Service, Chair is
 * foreign-keyed from ServiceSession/QueueEntry, so status changes (INACTIVE/MAINTENANCE) replace
 * deletion.
 */
@Injectable()
export class SalonChairsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async list(userId: string, salonId: string): Promise<SalonChairDto[]> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const chairs = await this.prisma.chair.findMany({
      where: { salonId },
      orderBy: { label: 'asc' },
    });
    return chairs.map((c) => this.toDto(c));
  }

  async create(
    userId: string,
    salonId: string,
    input: CreateSalonChairInput,
  ): Promise<SalonChairDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const created = await this.prisma.chair.create({
      data: { salonId, label: input.label, status: ChairStatus.ACTIVE },
    });
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_CHAIR_CREATED',
          entityType: 'Chair',
          entityId: created.id,
          metadata: { salonId, label: created.label },
        },
      });
    }
    return this.toDto(created);
  }

  async update(
    userId: string,
    salonId: string,
    chairId: string,
    input: UpdateSalonChairInput,
  ): Promise<SalonChairDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const existing = await this.prisma.chair.findFirst({
      where: { id: chairId, salonId },
    });
    if (!existing) {
      throw new AppException(
        QueueErrorCode.CHAIR_NOT_FOUND,
        'Chair not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const updated = await this.prisma.chair.update({
      where: { id: chairId },
      data: {
        ...(input.label !== undefined && { label: input.label }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    // Part 2 — every delegated admin mutation gets an AuditLog row with the real admin actor.
    // There is no chair `delete` in this service at all (Chair is FK'd from ServiceSession/
    // QueueEntry — see this file's own header comment) — setting status to INACTIVE via this same
    // update() IS how a chair is "removed", so that case is recorded here too rather than under a
    // separate, non-existent remove action.
    if (actor === 'PLATFORM_ADMIN') {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ADMIN_CHAIR_UPDATED',
          entityType: 'Chair',
          entityId: chairId,
          metadata: {
            salonId,
            before: { label: existing.label, status: existing.status },
            after: { label: updated.label, status: updated.status },
          },
        },
      });
    }
    return this.toDto(updated);
  }

  private toDto(chair: {
    id: string;
    label: string;
    status: ChairStatus;
  }): SalonChairDto {
    return { id: chair.id, label: chair.label, status: chair.status };
  }
}
