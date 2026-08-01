import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingSource,
  BookingStatus,
  LedgerReason,
  LedgerStatus,
  PrepaymentRequirement,
  computeCancellationCharge,
  isSlotBookable,
  type BookingDetailDto,
  type CancelBookingResponseDto,
  type CreateBookingInput,
  type PaginatedResult,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';

const DEFAULT_PAGE_SIZE = 20;

// Prisma's interactive-transaction default (5s) is comfortably enough for these transactions'
// handful of sequential queries under normal conditions, but Neon's serverless Postgres can incur
// a multi-second cold-start on the first query after a period of inactivity — observed directly
// while testing this module. A more generous timeout avoids a spurious SLOT_FULL-adjacent failure
// (Prisma reports "Transaction not found" once the default window elapses mid-transaction) on an
// otherwise-correct request; it does not change the transaction's actual query cost.
const TRANSACTION_OPTIONS = { timeout: 15_000 };

// Shared by list/get/cancel so the mapping to BookingDetailDto's denormalized display fields
// never drifts across call sites — same pattern as salons.service.ts's listInclude.
const bookingDetailInclude = {
  salon: {
    select: { name: true, slug: true, city: { select: { slug: true } } },
  },
  service: { select: { name: true, durationMinutes: true, price: true } },
  preferredStaff: { select: { displayName: true } },
} satisfies Prisma.BookingInclude;

type BookingWithDetails = Prisma.BookingGetPayload<{
  include: typeof bookingDetailInclude;
}>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly cancellationPolicy: CancellationPolicyService,
  ) {}

  async create(
    customerId: string,
    input: CreateBookingInput,
    source: BookingSource,
    idempotencyKey: string,
  ): Promise<BookingDetailDto> {
    await this.availability.getSalonOrThrow(input.salonId);
    const service = await this.availability.getServiceOrThrow(
      input.salonId,
      input.serviceId,
    );

    const slotStart = new Date(input.slotStart);
    if (slotStart.getTime() <= Date.now()) {
      throw new AppException(
        BookingErrorCode.SLOT_IN_PAST,
        'The requested slot must be in the future.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const slotEnd = new Date(
      slotStart.getTime() + service.durationMinutes * 60_000,
    );
    await this.availability.assertWithinOperatingHours(
      input.salonId,
      slotStart,
      slotEnd,
    );

    if (input.preferredStaffId) {
      await this.availability.assertStaffQualified(
        input.salonId,
        input.serviceId,
        input.preferredStaffId,
      );
    }

    // API.md's documented default policy: block new bookings at the same salon until an
    // outstanding balance is settled.
    const outstanding = await this.prisma.customerLedgerEntry.findFirst({
      where: {
        customerId,
        salonId: input.salonId,
        status: LedgerStatus.OUTSTANDING,
      },
    });
    if (outstanding) {
      throw new AppException(
        BookingErrorCode.OUTSTANDING_BALANCE,
        'You have an outstanding balance at this salon. Please settle it before booking again.',
        HttpStatus.CONFLICT,
      );
    }

    // STATE_MACHINES.md: initial status is a pure function of SalonPaymentPolicy. Not reachable
    // with today's seeded data (no salon has configured PARTIAL/FULL yet, and payment-policy
    // management is dashboard work, out of scope here) but implemented correctly regardless.
    const paymentPolicy = await this.prisma.salonPaymentPolicy.findUnique({
      where: { salonId: input.salonId },
    });
    const prepaymentRequirement =
      paymentPolicy?.prepaymentRequirement ?? PrepaymentRequirement.NONE;
    const requiresPrepayment =
      prepaymentRequirement === PrepaymentRequirement.PARTIAL ||
      prepaymentRequirement === PrepaymentRequirement.FULL;
    const status: BookingStatus = requiresPrepayment
      ? BookingStatus.PENDING_PAYMENT
      : BookingStatus.CONFIRMED;
    const prepaymentPercentage =
      prepaymentRequirement === PrepaymentRequirement.FULL
        ? 100
        : (paymentPolicy?.prepaymentPercentage ?? 100);
    const prepaymentRequiredAmount = requiresPrepayment
      ? Number(service.price) * (prepaymentPercentage / 100)
      : null;

    const bookingId = await this.prisma.$transaction(async (tx) => {
      // Closes a race-condition gap in DATABASE.md's literal "SELECT ... FOR UPDATE on the
      // overlapping set" wording: FOR UPDATE locks existing rows only, so it doesn't serialize two
      // *first-ever* concurrent bookings for an empty slot (nothing exists yet to lock). A
      // per-salon Postgres advisory transaction lock closes that gap completely while preserving
      // the documented intent — one transaction, the last slot can never be double-booked.
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, which Prisma's
      // $queryRaw cannot deserialize as a result column ("Failed to deserialize column of type
      // 'void'"). $executeRaw only reports an affected-row count and never tries to parse the
      // (nonexistent) result shape, which is exactly what a lock-only call needs.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${input.salonId}))`,
      );

      const slotCapacity = await this.availability.getSlotCapacity(
        tx,
        input.salonId,
        input.serviceId,
      );
      const overlapping = await tx.booking.count({
        where: {
          salonId: input.salonId,
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
          },
          slotStart: { lt: slotEnd },
          slotEnd: { gt: slotStart },
        },
      });
      if (!isSlotBookable(slotCapacity, overlapping)) {
        throw new AppException(
          BookingErrorCode.SLOT_FULL,
          'This time slot is fully booked. Please choose another time.',
          HttpStatus.CONFLICT,
        );
      }

      const created = await tx.booking.create({
        data: {
          salonId: input.salonId,
          customerId,
          serviceId: input.serviceId,
          slotStart,
          slotEnd,
          status,
          source,
          idempotencyKey,
          preferredStaffId: input.preferredStaffId ?? null,
          prepaymentRequiredAmount,
        },
      });
      return created.id;
    }, TRANSACTION_OPTIONS);

    return this.getDetailOrThrow(bookingId, customerId);
  }

  async listMine(
    customerId: string,
    cursor: string | undefined,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<PaginatedResult<BookingDetailDto>> {
    const bookings = await this.prisma.booking.findMany({
      where: { customerId },
      orderBy: { slotStart: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: bookingDetailInclude,
    });
    const hasMore = bookings.length > limit;
    const page = hasMore ? bookings.slice(0, limit) : bookings;
    return {
      items: page.map((b) => this.toDetailDto(b)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getOne(
    customerId: string,
    bookingId: string,
  ): Promise<BookingDetailDto> {
    return this.getDetailOrThrow(bookingId, customerId);
  }

  async cancel(
    customerId: string,
    bookingId: string,
  ): Promise<CancelBookingResponseDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      include: bookingDetailInclude,
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PENDING_PAYMENT
    ) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_CANCELLABLE,
        'This booking can no longer be cancelled.',
        HttpStatus.CONFLICT,
      );
    }

    const policy = await this.cancellationPolicy.getEffectivePolicy(
      booking.salonId,
    );
    const minutesUntilSlot =
      (booking.slotStart.getTime() - Date.now()) / 60_000;
    // Reuses packages/shared/src/calc's computeCancellationCharge — the same function the client
    // uses to render a live preview before the customer ever taps "Cancel." isNoShow is always
    // false here: no-show detection is dashboard/system-triggered work, out of scope in this phase.
    const chargeAmount = computeCancellationCharge(
      policy,
      Number(booking.service.price),
      minutesUntilSlot,
      false,
    );

    // Only the reachable branch of STATE_MACHINES.md's cancellation flowchart is implemented: no
    // eligible Payment can exist in V1 data (the Payments module isn't built), so a charge always
    // becomes a CustomerLedgerEntry(OUTSTANDING), never a refund — see the plan's explicit scoping.
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: customerId,
          cancellationChargeAmount: chargeAmount,
        },
        include: bookingDetailInclude,
      });

      if (chargeAmount > 0) {
        await tx.customerLedgerEntry.create({
          data: {
            customerId,
            salonId: booking.salonId,
            bookingId,
            amount: chargeAmount,
            reason: LedgerReason.CANCELLATION_CHARGE,
            status: LedgerStatus.OUTSTANDING,
          },
        });
      }

      // STATE_MACHINES.md's audit rule: every transition with money/customer-facing consequences
      // writes an AuditLog row.
      await tx.auditLog.create({
        data: {
          actorUserId: customerId,
          action: 'BOOKING_CANCELLED',
          entityType: 'Booking',
          entityId: bookingId,
          metadata: {
            chargeAmount,
            minutesUntilSlot,
            freeCancellationWindowMinutes: policy.freeCancellationWindowMinutes,
          },
        },
      });

      return result;
    }, TRANSACTION_OPTIONS);

    return {
      booking: this.toDetailDto(updated),
      chargeAmount,
      ledgerEntryCreated: chargeAmount > 0,
    };
  }

  private async getDetailOrThrow(
    bookingId: string,
    customerId: string,
  ): Promise<BookingDetailDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
      include: bookingDetailInclude,
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toDetailDto(booking);
  }

  private toDetailDto(booking: BookingWithDetails): BookingDetailDto {
    return {
      id: booking.id,
      salonId: booking.salonId,
      customerId: booking.customerId,
      serviceId: booking.serviceId,
      slotStart: booking.slotStart.toISOString(),
      slotEnd: booking.slotEnd.toISOString(),
      status: booking.status,
      source: booking.source,
      preferredStaffId: booking.preferredStaffId,
      prepaymentRequiredAmount:
        booking.prepaymentRequiredAmount !== null
          ? Number(booking.prepaymentRequiredAmount)
          : null,
      cancellationChargeAmount:
        booking.cancellationChargeAmount !== null
          ? Number(booking.cancellationChargeAmount)
          : null,
      salonName: booking.salon.name,
      salonSlug: booking.salon.slug,
      citySlug: booking.salon.city.slug,
      serviceName: booking.service.name,
      serviceDurationMinutes: booking.service.durationMinutes,
      servicePrice: Number(booking.service.price),
      preferredStaffName: booking.preferredStaff?.displayName ?? null,
    };
  }
}
