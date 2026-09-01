import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

/**
 * Platform-admin shop removal (this controller's other mutating surface, alongside
 * AdminVerificationService). Deliberately narrow: a salon with any real staff, booking, queue,
 * review, or ledger activity can never be hard-deleted here — that data is customer- and
 * revenue-adjacent, and a mistaken click must not be able to destroy it. This only ever removes
 * a genuinely empty shop (e.g. abandoned registrations, test/junk entries) plus the handful of
 * setup-only rows (chairs/services/hours/policies/photos) an owner may have configured before
 * ever getting real activity.
 */
@Injectable()
export class AdminSalonManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteSalon(
    adminUserId: string,
    salonId: string,
  ): Promise<{ deleted: true }> {
    const salon = await this.prisma.salon.findUnique({
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
    const hasActivity =
      activity.staff > 0 ||
      activity.bookings > 0 ||
      activity.queueEntries > 0 ||
      activity.reviews > 0 ||
      activity.ledgerEntries > 0;
    if (hasActivity) {
      throw new AppException(
        'SALON_HAS_ACTIVITY',
        'This shop has staff, bookings, queue, review or ledger activity and cannot be deleted. Suspend it instead if it needs to stop operating.',
        HttpStatus.CONFLICT,
        { ...activity },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Setup-only rows an owner may have created before ever getting real activity — none of
      // these can have their own dependents while staff/bookings/queueEntries are all zero (a
      // StaffChairAssignment/StaffService needs a staff row; a Booking/QueueEntry line needs a
      // service row), so this order is safe without a broader cascade.
      await tx.photo.deleteMany({ where: { salonId } });
      await tx.operatingHours.deleteMany({ where: { salonId } });
      await tx.chair.deleteMany({ where: { salonId } });
      await tx.service.deleteMany({ where: { salonId } });
      await tx.salonPaymentPolicy.deleteMany({ where: { salonId } });
      await tx.cancellationPolicy.deleteMany({ where: { salonId } });
      await tx.verificationRequest.deleteMany({ where: { salonId } });
      // The owner's (and any lingering) role grant scoped to this salon — meaningless once the
      // salon itself is gone.
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
    });

    return { deleted: true };
  }
}
