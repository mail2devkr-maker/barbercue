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
  type RescheduleBookingInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
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
    select: {
      name: true,
      slug: true,
      currency: true,
      addressLine: true,
      lat: true,
      lng: true,
      ownerUserId: true,
      city: { select: { slug: true, countryCode: true } },
    },
  },
  service: { select: { name: true, durationMinutes: true, price: true } },
  preferredStaff: { select: { displayName: true } },
  // Phase 16 (Ratings & Reviews) — id only, just to derive hasReview below; the review's own
  // content is fetched separately by ReviewsService, never duplicated onto BookingDetailDto.
  reviews: { select: { id: true } },
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
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly pushDispatch: PushDispatchService,
  ) {}

  async create(
    customerId: string,
    input: CreateBookingInput,
    source: BookingSource,
    idempotencyKey: string,
  ): Promise<BookingDetailDto> {
    const salon = await this.availability.getSalonOrThrow(input.salonId);
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
      await this.availability.assertStaffWithinWorkingHours(
        input.salonId,
        input.preferredStaffId,
        slotStart,
        slotEnd,
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

      // A specific staff member is a real exclusivity constraint (not the salon-wide pool check
      // above): that one professional cannot be double-booked, even if the salon otherwise has
      // spare pool capacity. Checked inside the same per-salon advisory-locked transaction, so
      // this is race-safe against a second concurrent request for the same staff/interval.
      if (input.preferredStaffId) {
        const staffOverlapping = await tx.booking.count({
          where: {
            salonId: input.salonId,
            preferredStaffId: input.preferredStaffId,
            status: {
              in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
            },
            slotStart: { lt: slotEnd },
            slotEnd: { gt: slotStart },
          },
        });
        if (staffOverlapping > 0) {
          throw new AppException(
            BookingErrorCode.STAFF_SLOT_UNAVAILABLE,
            'This barber is already booked at the requested time. Please choose another time or barber.',
            HttpStatus.CONFLICT,
          );
        }
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
          selectedStyleName: input.selectedStyleName ?? null,
        },
      });
      return created.id;
    }, TRANSACTION_OPTIONS);

    // Only after the transaction has actually committed — never on a rolled-back create (e.g.
    // SLOT_FULL), since that never reaches this line.
    this.realtime.emitBookingCreated(input.salonId, bookingId);
    await this.notifications.notify(
      customerId,
      'booking.confirmed',
      {
        salonId: input.salonId,
        salonName: salon.name,
        serviceName: service.name,
      },
      // No per-booking detail route exists on web yet (the list at account/bookings is the whole
      // surface) — the deep link must point at a route that actually exists, not an imagined one.
      'account/bookings',
    );
    await this.notifications.notify(
      salon.ownerUserId,
      'owner.booking.created',
      { salonId: input.salonId, bookingId, serviceName: service.name },
      `dashboard/salons/${input.salonId}/bookings`,
    );
    // Real OS push, distinct from the in-app Notification row above and the websocket emit —
    // reaches the owner's device even backgrounded/terminated, IF they've registered one (Issue
    // #13 Mission L). Fire-and-forget: PushDispatchService never throws, so this can never turn a
    // successful booking into a failed request, and this call site only runs once per genuine
    // creation (the controller's @Idempotent() replays a retried request's cached response
    // without re-invoking this method at all).
    void this.pushDispatch.dispatchToUser(salon.ownerUserId, {
      title: 'New booking',
      body: `${service.name} booked for your shop.`,
      data: { type: 'booking.created', salonId: input.salonId, bookingId },
    });

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

    this.realtime.emitBookingCancelled(updated.salonId, bookingId);
    await this.notifications.notify(
      customerId,
      'booking.cancelled',
      { salonId: updated.salonId, salonName: updated.salon.name },
      'account/bookings',
    );
    await this.notifications.notify(
      updated.salon.ownerUserId,
      'owner.booking.cancelled',
      { salonId: updated.salonId, bookingId },
      `dashboard/salons/${updated.salonId}/bookings`,
    );

    return {
      booking: this.toDetailDto(updated),
      chargeAmount,
      ledgerEntryCreated: chargeAmount > 0,
    };
  }

  // Moves an existing booking to a new slot in place (same id) rather than cancel-and-recreate —
  // one row, one audit trail (a BOOKING_RESCHEDULED entry recording old->new time), matching
  // STATE_MACHINES.md's "every transition with customer-facing consequences writes an AuditLog
  // row" rule already followed by cancel() above. No charge is ever computed or collected here —
  // this mission excludes payment processing entirely, unlike cancel()'s late-cancellation charge.
  async reschedule(
    customerId: string,
    bookingId: string,
    input: RescheduleBookingInput,
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
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PENDING_PAYMENT
    ) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_RESCHEDULABLE,
        'This booking can no longer be rescheduled.',
        HttpStatus.CONFLICT,
      );
    }
    if (booking.slotStart.getTime() <= Date.now()) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_RESCHEDULABLE,
        'This booking has already passed and can no longer be rescheduled.',
        HttpStatus.CONFLICT,
      );
    }

    const newSlotStart = new Date(input.slotStart);
    if (newSlotStart.getTime() <= Date.now()) {
      throw new AppException(
        BookingErrorCode.SLOT_IN_PAST,
        'The requested slot must be in the future.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const service = await this.availability.getServiceOrThrow(
      booking.salonId,
      booking.serviceId,
    );
    const newSlotEnd = new Date(
      newSlotStart.getTime() + service.durationMinutes * 60_000,
    );
    await this.availability.assertWithinOperatingHours(
      booking.salonId,
      newSlotStart,
      newSlotEnd,
    );
    if (booking.preferredStaffId) {
      await this.availability.assertStaffWithinWorkingHours(
        booking.salonId,
        booking.preferredStaffId,
        newSlotStart,
        newSlotEnd,
      );
    }

    const previousSlotStart = booking.slotStart;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Same per-salon advisory lock as create() — a reschedule competes for slot capacity
      // exactly like a new booking would.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${booking.salonId}))`,
      );

      const slotCapacity = await this.availability.getSlotCapacity(
        tx,
        booking.salonId,
        booking.serviceId,
      );
      const overlapping = await tx.booking.count({
        where: {
          id: { not: bookingId },
          salonId: booking.salonId,
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
          },
          slotStart: { lt: newSlotEnd },
          slotEnd: { gt: newSlotStart },
        },
      });
      if (!isSlotBookable(slotCapacity, overlapping)) {
        throw new AppException(
          BookingErrorCode.SLOT_FULL,
          'This time slot is fully booked. Please choose another time.',
          HttpStatus.CONFLICT,
        );
      }

      // Same per-staff exclusivity constraint create() enforces — a reschedule to a new time
      // competes for that specific staff member exactly like a new booking would.
      if (booking.preferredStaffId) {
        const staffOverlapping = await tx.booking.count({
          where: {
            id: { not: bookingId },
            salonId: booking.salonId,
            preferredStaffId: booking.preferredStaffId,
            status: {
              in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
            },
            slotStart: { lt: newSlotEnd },
            slotEnd: { gt: newSlotStart },
          },
        });
        if (staffOverlapping > 0) {
          throw new AppException(
            BookingErrorCode.STAFF_SLOT_UNAVAILABLE,
            'This barber is already booked at the requested time. Please choose another time or barber.',
            HttpStatus.CONFLICT,
          );
        }
      }

      const result = await tx.booking.update({
        where: { id: bookingId },
        data: { slotStart: newSlotStart, slotEnd: newSlotEnd },
        include: bookingDetailInclude,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: customerId,
          action: 'BOOKING_RESCHEDULED',
          entityType: 'Booking',
          entityId: bookingId,
          metadata: {
            previousSlotStart: previousSlotStart.toISOString(),
            newSlotStart: newSlotStart.toISOString(),
          },
        },
      });

      return result;
    }, TRANSACTION_OPTIONS);

    this.realtime.emitBookingRescheduled(booking.salonId, bookingId);

    return this.toDetailDto(updated);
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
      selectedStyleName: booking.selectedStyleName,
      // Salon-scoped: a booking's amounts are denominated in its salon's currency.
      currency: booking.salon.currency,
      salonName: booking.salon.name,
      salonSlug: booking.salon.slug,
      citySlug: booking.salon.city.slug,
      salonCountryCode: booking.salon.city.countryCode,
      salonAddress: booking.salon.addressLine,
      salonLat: booking.salon.lat,
      salonLng: booking.salon.lng,
      serviceName: booking.service.name,
      serviceDurationMinutes: booking.service.durationMinutes,
      servicePrice: Number(booking.service.price),
      preferredStaffName: booking.preferredStaff?.displayName ?? null,
      hasReview: booking.reviews.length > 0,
    };
  }
}
