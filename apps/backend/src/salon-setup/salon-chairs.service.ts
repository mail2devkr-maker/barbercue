import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ChairStatus,
  QueueErrorCode,
  QueueEntryStatus,
  ServiceSessionStatus,
  type BulkDeactivateSalonChairsApplyInput,
  type BulkChairDeactivationPreviewDto,
  type BulkDeactivateSalonChairsPreviewInput,
  type BulkChairDeactivationResultDto,
  type ChairDeactivationConflict,
  type CreateSalonChairInput,
  type SalonChairDto,
  type UpdateSalonChairInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { QueueAssignmentReleaseService } from '../queue/queue-assignment-release.service';
import { QueueAutoAssignTrigger } from '../queue/queue-auto-assign.trigger';

type ChairConflictReader = Pick<
  Prisma.TransactionClient,
  'serviceSession' | 'manualChairOccupancy' | 'queueEntry'
>;

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
    @Optional()
    private readonly assignmentRelease?: QueueAssignmentReleaseService,
    @Optional() private readonly autoAssignTrigger?: QueueAutoAssignTrigger,
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
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(
      userId,
      salonId,
    );
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
    // A new ACTIVE chair makes a previously blocked waiting visitor seatable.
    this.autoAssignTrigger?.trigger(salonId);
    return this.toDto(created);
  }

  async update(
    userId: string,
    salonId: string,
    chairId: string,
    input: UpdateSalonChairInput,
  ): Promise<SalonChairDto> {
    const actor = await this.salonAccess.assertOwnerOrAdminAccess(
      userId,
      salonId,
    );
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
    // A chair taken out of use can no longer seat a customer who was assigned to it but not started:
    // they go back to waiting so another chair can be found.
    if (input.status !== undefined && updated.status !== ChairStatus.ACTIVE) {
      await this.assignmentRelease?.releaseForChair(
        salonId,
        chairId,
        'CHAIR_UNAVAILABLE',
        userId,
      );
    }
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
    // Restoring a chair to ACTIVE releases new capacity even if no queue mutation occurs.
    if (
      existing.status !== ChairStatus.ACTIVE &&
      updated.status === ChairStatus.ACTIVE
    ) {
      this.autoAssignTrigger?.trigger(salonId);
    }
    return this.toDto(updated);
  }

  async previewBulkDeactivate(
    userId: string,
    salonId: string,
    input: BulkDeactivateSalonChairsPreviewInput,
  ): Promise<BulkChairDeactivationPreviewDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const chairs = await this.prisma.chair.findMany({
      where: { salonId, id: { in: input.chairIds } },
      select: { id: true, label: true, status: true, updatedAt: true },
    });
    const byId = new Map(chairs.map((chair) => [chair.id, chair]));
    const occupancyConflicts = await this.findOccupancyConflicts(
      this.prisma,
      salonId,
      chairs.map((chair) => chair.id),
    );

    return {
      salonId,
      items: input.chairIds.map((chairId) => {
        const chair = byId.get(chairId);
        if (!chair) {
          return {
            chairId,
            label: null,
            status: null,
            expectedUpdatedAt: null,
            disposition: 'NOT_FOUND' as const,
            conflicts: [],
          };
        }
        const conflicts = [...(occupancyConflicts.get(chairId) ?? [])];
        if (chair.status !== ChairStatus.ACTIVE) conflicts.push('NOT_ACTIVE');
        return {
          chairId,
          label: chair.label,
          status: chair.status,
          expectedUpdatedAt: chair.updatedAt.toISOString(),
          disposition: conflicts.length
            ? ('CONFLICT' as const)
            : ('READY' as const),
          conflicts,
        };
      }),
    };
  }

  async bulkDeactivate(
    userId: string,
    salonId: string,
    input: BulkDeactivateSalonChairsApplyInput,
  ): Promise<BulkChairDeactivationResultDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const items = input.items;
    const lockOrder = [...items].sort((a, b) =>
      a.chairId.localeCompare(b.chairId),
    );

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Match the queue assignment/manual occupancy lock namespace so a chair cannot be
          // seated or occupied while this batch checks and changes its availability.
          for (const item of lockOrder) {
            await tx.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${item.chairId}`}))`,
            );
          }
          // Also serialize with the existing single-chair PATCH path, which uses row updates rather
          // than the queue advisory lock. Lock only IDs belonging to this salon, in stable order.
          for (const item of lockOrder) {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "chairs" WHERE "id" = ${item.chairId} AND "salonId" = ${salonId} FOR UPDATE`,
            );
          }

          const chairs = await tx.chair.findMany({
            where: { salonId, id: { in: items.map((item) => item.chairId) } },
            select: { id: true, label: true, status: true, updatedAt: true },
          });
          const byId = new Map(chairs.map((chair) => [chair.id, chair]));
          const occupancyConflicts = await this.findOccupancyConflicts(
            tx,
            salonId,
            chairs.map((chair) => chair.id),
          );
          const results: BulkChairDeactivationResultDto['items'] = [];

          for (const item of items) {
            const chair = byId.get(item.chairId);
            if (!chair) {
              results.push({
                chairId: item.chairId,
                label: null,
                result: 'NOT_FOUND',
                conflicts: [],
              });
              continue;
            }

            const conflicts = [...(occupancyConflicts.get(item.chairId) ?? [])];
            if (chair.status !== ChairStatus.ACTIVE)
              conflicts.push('NOT_ACTIVE');
            if (
              chair.updatedAt.getTime() !==
              new Date(item.expectedUpdatedAt).getTime()
            ) {
              conflicts.push('STALE_PREVIEW');
            }
            if (conflicts.length) {
              results.push({
                chairId: chair.id,
                label: chair.label,
                result: 'CONFLICT',
                conflicts,
              });
              continue;
            }

            const update = await tx.chair.updateMany({
              where: {
                id: chair.id,
                salonId,
                status: ChairStatus.ACTIVE,
                updatedAt: new Date(item.expectedUpdatedAt),
              },
              data: { status: ChairStatus.INACTIVE, updatedAt: new Date() },
            });
            if (update.count !== 1) {
              results.push({
                chairId: chair.id,
                label: chair.label,
                result: 'CONFLICT',
                conflicts: ['STALE_PREVIEW'],
              });
              continue;
            }

            await tx.auditLog.create({
              data: {
                actorUserId: userId,
                action: 'CHAIR_BULK_DEACTIVATED',
                entityType: 'Chair',
                entityId: chair.id,
                metadata: {
                  salonId,
                  before: { label: chair.label, status: ChairStatus.ACTIVE },
                  after: { label: chair.label, status: ChairStatus.INACTIVE },
                },
              },
            });
            results.push({
              chairId: chair.id,
              label: chair.label,
              result: 'DEACTIVATED',
              conflicts: [],
            });
          }

          return {
            salonId,
            deactivatedCount: results.filter(
              (item) => item.result === 'DEACTIVATED',
            ).length,
            items: results,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        // The transaction was rolled back; report a retryable conflict, never partial success.
        return {
          salonId,
          deactivatedCount: 0,
          items: items.map((item) => ({
            chairId: item.chairId,
            label: null,
            result: 'CONFLICT',
            conflicts: ['STALE_PREVIEW'],
          })),
        };
      }
      throw error;
    }
  }

  private async findOccupancyConflicts(
    db: ChairConflictReader,
    salonId: string,
    chairIds: string[],
  ): Promise<Map<string, ChairDeactivationConflict[]>> {
    if (!chairIds.length) return new Map();
    const [sessions, occupancies, assignments] = await Promise.all([
      db.serviceSession.findMany({
        where: {
          chairId: { in: chairIds },
          status: ServiceSessionStatus.ACTIVE,
        },
        select: { chairId: true },
      }),
      db.manualChairOccupancy.findMany({
        where: { salonId, chairId: { in: chairIds }, endedAt: null },
        select: { chairId: true },
      }),
      db.queueEntry.findMany({
        where: {
          salonId,
          assignedChairId: { in: chairIds },
          status: QueueEntryStatus.CALLED,
        },
        select: { assignedChairId: true },
      }),
    ]);

    const conflicts = new Map<string, ChairDeactivationConflict[]>();
    const add = (chairId: string | null, reason: ChairDeactivationConflict) => {
      if (!chairId) return;
      const current = conflicts.get(chairId) ?? [];
      if (!current.includes(reason)) current.push(reason);
      conflicts.set(chairId, current);
    };
    for (const row of sessions) add(row.chairId, 'ACTIVE_SERVICE_SESSION');
    for (const row of occupancies) add(row.chairId, 'ACTIVE_MANUAL_OCCUPANCY');
    for (const row of assignments)
      add(row.assignedChairId, 'ASSIGNED_QUEUE_ENTRY');
    return conflicts;
  }

  private toDto(chair: {
    id: string;
    label: string;
    status: ChairStatus;
  }): SalonChairDto {
    return { id: chair.id, label: chair.label, status: chair.status };
  }
}
