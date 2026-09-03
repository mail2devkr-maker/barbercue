import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  CANCELLATION_COURTESY_WAIVER_LIMIT,
  LedgerReason,
  LedgerStatus,
  type CustomerLedgerEntryDto,
  type LedgerActionResultDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';

interface LedgerRow {
  id: string;
  customerId: string;
  salonId: string;
  bookingId: string | null;
  amount: { toString(): string } | number;
  reason: string;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
  booking: { slotStart: Date; service: { name: string } } | null;
}

const ledgerRowSelect = {
  id: true,
  customerId: true,
  salonId: true,
  bookingId: true,
  amount: true,
  reason: true,
  status: true,
  createdAt: true,
  settledAt: true,
  booking: { select: { slotStart: true, service: { select: { name: true } } } },
} as const;

function toLedgerEntryDto(row: LedgerRow): CustomerLedgerEntryDto {
  return {
    id: row.id,
    customerId: row.customerId,
    salonId: row.salonId,
    bookingId: row.bookingId,
    amount: Number(row.amount),
    reason: row.reason as LedgerReason,
    status: row.status as LedgerStatus,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    bookingServiceName: row.booking?.service.name ?? null,
    bookingSlotStart: row.booking?.slotStart.toISOString() ?? null,
  };
}

/**
 * Owner-controlled customer-retention courtesy for LATE cancellation charges only.
 *
 * This is deliberately independent of New Customer No-Show Grace:
 * - NO_SHOW_CHARGE continues to use the existing < 3 completed-visits rule.
 * - CANCELLATION_CHARGE can have at most 5 currently-waived courtesy entries per customer/salon.
 * - A free cancellation never creates a CANCELLATION_CHARGE ledger row, therefore never consumes
 *   this quota.
 * - Ledger rows are never deleted or marked SETTLED by a courtesy action.
 */
@Injectable()
export class CancellationCourtesyWaiverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async waive(
    userId: string,
    salonId: string,
    customerId: string,
    ledgerEntryId: string,
  ): Promise<LedgerActionResultDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const entry = await this.getOwnedCancellationEntry(salonId, customerId, ledgerEntryId);

    // Idempotent retry: this exact charge is already waived.
    if (entry.status === LedgerStatus.WAIVED) return { ledgerEntry: entry };
    if (entry.status !== LedgerStatus.OUTSTANDING) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
        'This cancellation charge is not outstanding and cannot be waived.',
        HttpStatus.CONFLICT,
      );
    }

    const waivedCount = await this.prisma.customerLedgerEntry.count({
      where: {
        salonId,
        customerId,
        reason: LedgerReason.CANCELLATION_CHARGE,
        status: LedgerStatus.WAIVED,
      },
    });
    if (waivedCount >= CANCELLATION_COURTESY_WAIVER_LIMIT) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
        `This customer has already used all ${CANCELLATION_COURTESY_WAIVER_LIMIT} cancellation courtesy waivers at this salon.`,
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-check quota inside the transaction immediately before claiming the entry. This keeps
      // ordinary retries/double-clicks safe and prevents a stale preflight count from authorizing
      // a sixth sequential waiver.
      const currentWaivedCount = await tx.customerLedgerEntry.count({
        where: {
          salonId,
          customerId,
          reason: LedgerReason.CANCELLATION_CHARGE,
          status: LedgerStatus.WAIVED,
        },
      });
      if (currentWaivedCount >= CANCELLATION_COURTESY_WAIVER_LIMIT) {
        throw new AppException(
          BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
          `This customer has already used all ${CANCELLATION_COURTESY_WAIVER_LIMIT} cancellation courtesy waivers at this salon.`,
          HttpStatus.CONFLICT,
        );
      }

      const claim = await tx.customerLedgerEntry.updateMany({
        where: {
          id: ledgerEntryId,
          salonId,
          customerId,
          reason: LedgerReason.CANCELLATION_CHARGE,
          status: LedgerStatus.OUTSTANDING,
        },
        data: { status: LedgerStatus.WAIVED },
      });
      if (claim.count === 0) return null;

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'CANCELLATION_DUE_WAIVED',
          entityType: 'CustomerLedgerEntry',
          entityId: ledgerEntryId,
          metadata: {
            ledgerEntryId,
            customerId,
            salonId,
            bookingId: entry.bookingId,
            amount: entry.amount,
            actorUserId: userId,
            previousStatus: LedgerStatus.OUTSTANDING,
            newStatus: LedgerStatus.WAIVED,
            courtesyWaiverLimit: CANCELLATION_COURTESY_WAIVER_LIMIT,
            courtesyWaiversUsedAfter: currentWaivedCount + 1,
          },
        },
      });

      return tx.customerLedgerEntry.findUniqueOrThrow({
        where: { id: ledgerEntryId },
        select: ledgerRowSelect,
      });
    });

    if (!result) {
      return { ledgerEntry: await this.getOwnedCancellationEntry(salonId, customerId, ledgerEntryId) };
    }
    return { ledgerEntry: toLedgerEntryDto(result as unknown as LedgerRow) };
  }

  async restore(
    userId: string,
    salonId: string,
    customerId: string,
    ledgerEntryId: string,
  ): Promise<LedgerActionResultDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const entry = await this.getOwnedCancellationEntry(salonId, customerId, ledgerEntryId);

    if (entry.status === LedgerStatus.OUTSTANDING) return { ledgerEntry: entry };
    if (entry.status !== LedgerStatus.WAIVED) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_RESTORABLE,
        'This cancellation charge is not waived and cannot be restored.',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.customerLedgerEntry.updateMany({
        where: {
          id: ledgerEntryId,
          salonId,
          customerId,
          reason: LedgerReason.CANCELLATION_CHARGE,
          status: LedgerStatus.WAIVED,
        },
        data: { status: LedgerStatus.OUTSTANDING },
      });
      if (claim.count === 0) return null;

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'CANCELLATION_DUE_RESTORED',
          entityType: 'CustomerLedgerEntry',
          entityId: ledgerEntryId,
          metadata: {
            ledgerEntryId,
            customerId,
            salonId,
            bookingId: entry.bookingId,
            amount: entry.amount,
            actorUserId: userId,
            previousStatus: LedgerStatus.WAIVED,
            newStatus: LedgerStatus.OUTSTANDING,
            courtesyWaiverLimit: CANCELLATION_COURTESY_WAIVER_LIMIT,
          },
        },
      });

      return tx.customerLedgerEntry.findUniqueOrThrow({
        where: { id: ledgerEntryId },
        select: ledgerRowSelect,
      });
    });

    if (!result) {
      return { ledgerEntry: await this.getOwnedCancellationEntry(salonId, customerId, ledgerEntryId) };
    }
    return { ledgerEntry: toLedgerEntryDto(result as unknown as LedgerRow) };
  }

  private async getOwnedCancellationEntry(
    salonId: string,
    customerId: string,
    ledgerEntryId: string,
  ): Promise<CustomerLedgerEntryDto> {
    const row = await this.prisma.customerLedgerEntry.findUnique({
      where: { id: ledgerEntryId },
      select: ledgerRowSelect,
    });
    if (!row || row.salonId !== salonId || row.customerId !== customerId) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_FOUND,
        'This due was not found for this customer at this salon.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.reason !== LedgerReason.CANCELLATION_CHARGE) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
        'Only a cancellation charge can use a cancellation courtesy waiver.',
        HttpStatus.CONFLICT,
      );
    }
    return toLedgerEntryDto(row as LedgerRow);
  }
}
