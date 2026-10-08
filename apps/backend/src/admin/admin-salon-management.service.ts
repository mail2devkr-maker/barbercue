import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, SalonStatus } from '@prisma/client';
import {
  BookingStatus,
  LedgerStatus,
  PaymentStatus,
  QueueEntryStatus,
  RefundStatus,
  ServiceSessionStatus,
  SubsidyLedgerStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

const RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Shop deletion is a reversible quarantine only. This service deliberately contains no Salon
 * delete path. History, child records, public IDs, QR tokens, and assets remain attached.
 */
@Injectable()
export class AdminSalonManagementService {
  constructor(private readonly prisma: PrismaService) {}

  /** Legacy hard-delete endpoint kept as a fail-closed compatibility response. */
  deleteSalon(adminUserId: string, salonId: string): Promise<never> {
    // Preserve the compatibility signature while deliberately ignoring caller IDs: this endpoint
    // is no longer an authorization path and cannot delete or mutate any shop.
    void adminUserId;
    void salonId;
    return Promise.reject(
      new AppException(
        'SHOP_DELETE_USE_RECOVERY_FLOW',
        'Permanent shop deletion is disabled. Use the audited 30-day recovery workflow.',
        HttpStatus.CONFLICT,
      ),
    );
  }

  async quarantineSalonInTransaction(
    tx: PrismaServiceTransaction,
    adminUserId: string,
    salonId: string,
    requestId: string,
    deletedAt = new Date(),
  ): Promise<
    | {
        quarantined: true;
        restoreEligibleUntil: Date;
        previousStatus: string;
        shopName: string;
        shopPublicId: string;
      }
    | { quarantined: false; code: string; message: string; blockers: string[] }
  > {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
    `;
    if (!locked.length) {
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
        status: true,
        softDeletedAt: true,
      },
    });
    if (!salon) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (salon.softDeletedAt) {
      return {
        quarantined: false,
        code: 'SHOP_ALREADY_QUARANTINED',
        message: 'This shop is already in recovery trash.',
        blockers: [],
      };
    }

    const blockers = await this.findOpenObligations(tx, salonId);
    if (blockers.length) {
      return {
        quarantined: false,
        code: 'SHOP_HAS_OPEN_OBLIGATIONS',
        message:
          'Resolve current bookings, queue work, and unsettled amounts before moving this shop to Trash.',
        blockers,
      };
    }

    const restoreEligibleUntil = new Date(
      deletedAt.getTime() + RECOVERY_WINDOW_MS,
    );
    await tx.salon.update({
      where: { id: salonId },
      data: {
        softDeletedAt: deletedAt,
        restoreEligibleUntil,
        softDeletedByUserId: adminUserId,
        softDeletionRequestId: requestId,
        statusBeforeSoftDelete: salon.status,
        // Existing status-only clients immediately stop treating the shop as operational.
        status: SalonStatus.SUSPENDED,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'SHOP_SOFT_DELETED',
        entityType: 'Salon',
        entityId: salonId,
        metadata: {
          requestId,
          previousStatus: salon.status,
          newStatus: SalonStatus.SUSPENDED,
          restoreEligibleUntil: restoreEligibleUntil.toISOString(),
          shopPublicId: salon.publicId,
        },
      },
    });
    return {
      quarantined: true,
      restoreEligibleUntil,
      previousStatus: salon.status,
      shopName: salon.name,
      shopPublicId: salon.publicId,
    };
  }

  private async findOpenObligations(
    tx: PrismaServiceTransaction,
    salonId: string,
  ): Promise<string[]> {
    const [
      booking,
      queue,
      session,
      manualOccupancy,
      payment,
      refund,
      ledger,
      subsidy,
    ] = await Promise.all([
      tx.booking.findFirst({
        where: {
          salonId,
          status: {
            in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
          },
        },
        select: { id: true },
      }),
      tx.queueEntry.findFirst({
        where: {
          salonId,
          status: {
            in: [
              QueueEntryStatus.WAITING,
              QueueEntryStatus.CALLED,
              QueueEntryStatus.IN_SERVICE,
            ],
          },
        },
        select: { id: true },
      }),
      tx.serviceSession.findFirst({
        where: { status: ServiceSessionStatus.ACTIVE, queueEntry: { salonId } },
        select: { id: true },
      }),
      tx.manualChairOccupancy.findFirst({
        where: { salonId, endedAt: null },
        select: { id: true },
      }),
      tx.payment.findFirst({
        where: {
          status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
          booking: { salonId },
        },
        select: { id: true },
      }),
      tx.refund.findFirst({
        where: {
          status: RefundStatus.INITIATED,
          payment: { booking: { salonId } },
        },
        select: { id: true },
      }),
      tx.customerLedgerEntry.findFirst({
        where: { salonId, status: LedgerStatus.OUTSTANDING },
        select: { id: true },
      }),
      tx.platformShopSubsidyEntry.findFirst({
        where: { salonId, status: SubsidyLedgerStatus.OUTSTANDING },
        select: { id: true },
      }),
    ]);

    return [
      booking ? 'PENDING_OR_CONFIRMED_BOOKING' : null,
      queue ? 'ACTIVE_QUEUE_ENTRY' : null,
      session ? 'ACTIVE_SERVICE_SESSION' : null,
      manualOccupancy ? 'ACTIVE_MANUAL_CHAIR_OCCUPANCY' : null,
      payment ? 'PENDING_PAYMENT' : null,
      refund ? 'PENDING_REFUND' : null,
      ledger ? 'OUTSTANDING_CUSTOMER_LEDGER' : null,
      subsidy ? 'OUTSTANDING_PLATFORM_SUBSIDY' : null,
    ].filter((value): value is string => value !== null);
  }
}

type PrismaServiceTransaction = Prisma.TransactionClient;
