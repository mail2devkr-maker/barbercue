import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChairStatus, QueueErrorCode } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { QueueService } from './queue.service';

const TRANSACTION_OPTIONS = { timeout: 15_000 };

@Injectable()
export class ManualChairOccupancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly queue: QueueService,
  ) {}

  async occupyLocal(userId: string, salonId: string, chairId: string) {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockChair(tx, chairId);
      const chair = await tx.chair.findFirst({ where: { id: chairId, salonId } });
      if (!chair) throw new AppException(QueueErrorCode.CHAIR_NOT_FOUND, 'Chair not found.', HttpStatus.NOT_FOUND);
      if (chair.status !== ChairStatus.ACTIVE) {
        throw new AppException(QueueErrorCode.CHAIR_INACTIVE, 'This chair is not active.', HttpStatus.CONFLICT);
      }
      const [session, existing] = await Promise.all([
        tx.serviceSession.findFirst({ where: { chairId, status: 'ACTIVE' }, select: { id: true } }),
        tx.manualChairOccupancy.findFirst({ where: { chairId, endedAt: null }, select: { id: true } }),
      ]);
      if (session || existing) {
        throw new AppException(QueueErrorCode.CHAIR_ALREADY_OCCUPIED, 'This chair is already occupied.', HttpStatus.CONFLICT);
      }
      const created = await tx.manualChairOccupancy.create({
        data: { salonId, chairId, startedByUserId: userId },
        select: { id: true, chairId: true, startedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOCAL_CHAIR_OCCUPIED',
          entityType: 'ManualChairOccupancy',
          entityId: created.id,
          metadata: { salonId, chairId },
        },
      });
      return created;
    }, TRANSACTION_OPTIONS);
    await this.queue.onChairOccupancyChanged(salonId);
    return { ...result, startedAt: result.startedAt.toISOString() };
  }

  async freeLocal(userId: string, salonId: string, chairId: string) {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockChair(tx, chairId);
      const chair = await tx.chair.findFirst({ where: { id: chairId, salonId }, select: { id: true } });
      if (!chair) throw new AppException(QueueErrorCode.CHAIR_NOT_FOUND, 'Chair not found.', HttpStatus.NOT_FOUND);
      const active = await tx.manualChairOccupancy.findFirst({ where: { chairId, salonId, endedAt: null } });
      if (!active) return { cleared: false, occupancyId: null as string | null };
      const endedAt = new Date();
      await tx.manualChairOccupancy.update({
        where: { id: active.id },
        data: { endedAt, endedByUserId: userId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOCAL_CHAIR_FREED',
          entityType: 'ManualChairOccupancy',
          entityId: active.id,
          metadata: { salonId, chairId },
        },
      });
      return { cleared: true, occupancyId: active.id };
    }, TRANSACTION_OPTIONS);
    if (result.cleared) await this.queue.onChairOccupancyChanged(salonId);
    return result;
  }

  async freeAllLocal(userId: string, salonId: string) {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const count = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-local-chairs:${salonId}`}))`);
      const active = await tx.manualChairOccupancy.findMany({
        where: { salonId, endedAt: null },
        select: { id: true },
      });
      if (active.length === 0) return 0;
      const endedAt = new Date();
      await tx.manualChairOccupancy.updateMany({
        where: { id: { in: active.map((row) => row.id) }, endedAt: null },
        data: { endedAt, endedByUserId: userId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOCAL_CHAIRS_FREED_BULK',
          entityType: 'Salon',
          entityId: salonId,
          metadata: { salonId, clearedCount: active.length },
        },
      });
      return active.length;
    }, TRANSACTION_OPTIONS);
    if (count > 0) await this.queue.onChairOccupancyChanged(salonId);
    return { clearedCount: count };
  }

  private lockChair(tx: Prisma.TransactionClient, chairId: string) {
    return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${chairId}`}))`);
  }
}
