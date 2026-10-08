import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

/**
 * Hard delete is deliberately limited to genuinely inactive/empty shops.
 * Staff, bookings, queue, reviews and financial records MUST NEVER be erased.
 * Approvals call deleteSalonInTransaction so approval + deletion + audit are atomic.
 */
@Injectable()
export class AdminSalonManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteSalon(
    adminUserId: string,
    salonId: string,
  ): Promise<{ deleted: true }> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize with new requests: both direct deletion and the approval-request
      // path lock the same Salon row BEFORE checking for pending approvals.
      await tx.$queryRaw`
        SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
      `;
      // Do not bypass a pending Co-Founder request through the legacy direct
      // Super Admin route; the queued decision must be resolved explicitly.
      const pending = await tx.shopDeletionRequest.findFirst({
        where: { salonId, status: 'PENDING' },
        select: { id: true },
      });
      if (pending) {
        throw new AppException(
          'SHOP_DELETE_APPROVAL_PENDING',
          'Resolve the pending deletion request in Security & Audit before deleting this shop.',
          HttpStatus.CONFLICT,
        );
      }
      return this.deleteSalonInTransaction(tx, adminUserId, salonId);
    });
  }

  async deleteSalonInTransaction(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    salonId: string,
  ): Promise<{ deleted: true }> {
    // PostgreSQL parent-row lock serializes concurrent approvals, deletions and
    // FK-backed child inserts. Counts MUST be rechecked inside this lock/transaction.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const salon = await tx.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        publicId: true,
        _count: {
          select: {
            staff: true,
            bookings: true,
            queueEntries: true,
            reviews: true,
            ledgerEntries: true,
            manualChairOccupancies: true,
            subsidyEntries: true,
          },
        },
      },
    });
    if (!salon) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const activity = salon._count;
    if (
      activity.staff > 0 ||
      activity.bookings > 0 ||
      activity.queueEntries > 0 ||
      activity.reviews > 0 ||
      activity.ledgerEntries > 0 ||
      activity.manualChairOccupancies > 0 ||
      activity.subsidyEntries > 0
    ) {
      throw new AppException(
        'SALON_HAS_ACTIVITY',
        'This shop has real activity and cannot be deleted. Suspend it instead.',
        HttpStatus.CONFLICT,
        { ...activity },
      );
    }

    await tx.photo.deleteMany({ where: { salonId } });
    await tx.operatingHours.deleteMany({ where: { salonId } });
    await tx.chair.deleteMany({ where: { salonId } });
    await tx.service.deleteMany({ where: { salonId } });
    await tx.salonPaymentPolicy.deleteMany({ where: { salonId } });
    await tx.cancellationPolicy.deleteMany({ where: { salonId } });
    await tx.verificationRequest.deleteMany({ where: { salonId } });
    await tx.userRole.deleteMany({ where: { salonId } });
    await tx.salon.delete({ where: { id: salonId } });
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'SALON_DELETED',
        entityType: 'Salon',
        entityId: salonId,
        metadata: { name: salon.name, publicId: salon.publicId },
      },
    });
    return { deleted: true };
  }
}
