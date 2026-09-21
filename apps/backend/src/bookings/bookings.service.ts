import { forwardRef, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingSource,
  BookingStatus,
  LedgerReason,
  LedgerStatus,
  PrepaymentRequirement,
  QueueEntryStatus,
  SubsidyLedgerStatus,
  computeCancellationCharge,
  computePercentageDiscountPaise,
  decimalStringToPaise,
  formatMoney,
  isSlotBookable,
  paiseToDecimalString,
  paiseToRupees,
  summarizeServiceNames,
  type BookingDetailDto,
  type BookingServiceItemDto,
  type CancelBookingResponseDto,
  type CreateBookingInput,
  type OutstandingBalanceDetailsDto,
  type PaginatedResult,
  type RescheduleBookingInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { resolveSalonTimeZone } from '../common/timezone/timezone';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
import { QueueService, EARLY_CHECKIN_WINDOW_MINUTES } from '../queue/queue.service';
import { CustomerCreditsService } from '../credits/customer-credits.service';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { computeArrivalGuidance } from './arrival-guidance';
import { resolveEffectiveBookingServices } from './effective-booking-services';

// A booking-triggered cancellation may only auto-cancel a linked queue entry that has not yet
// genuinely started service — WAITING (never called) or CALLED (called but not yet assigned a
// chair/session). An IN_SERVICE entry is deliberately excluded: the customer is physically in the
// chair, and STATE_MACHINES.md's queue engine — not a booking-side effect — owns that transition
// (see queue.service.ts's own cancelByStaff, a distinct manual owner action that CAN end an
// IN_SERVICE session, unlike this automatic one).
const QUEUE_ENTRY_STATUSES_CANCELLABLE_FROM_BOOKING: QueueEntryStatus[] = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.CALLED,
];

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
      // Part 5: resolved into BookingDetailDto.salonTimezone via resolveSalonTimeZone below, so
      // every client formats slotStart/slotEnd in the salon's own zone instead of the device's.
      timezone: true,
      city: { select: { slug: true, countryCode: true } },
    },
  },
  service: { select: { name: true, durationMinutes: true, price: true } },
  // Multi-service booking core mission — the authoritative, ordered selection. Snapshot columns
  // only (see BookingService's own doc comment): never re-joins the live Service, so a later
  // rename/reprice/deactivation can't retroactively change what an already-created booking shows.
  services: { orderBy: { sortOrder: 'asc' } },
  preferredStaff: { select: { displayName: true } },
  // Phase 16 (Ratings & Reviews) — id only, just to derive hasReview below; the review's own
  // content is fetched separately by ReviewsService, never duplicated onto BookingDetailDto.
  reviews: { select: { id: true } },
  // Part 5 completion (arrival guidance) — id only, just to derive "has already checked in" below
  // (a QueueEntry existing at all means so, regardless of its own current status) so arrival
  // guidance stops being shown the moment it stops applying.
  queueEntries: { select: { id: true }, take: 1 },
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
    @Inject(forwardRef(() => QueueService))
    private readonly queue: QueueService,
    private readonly credits: CustomerCreditsService,
  ) {}

  async create(
    customerId: string,
    input: CreateBookingInput,
    source: BookingSource,
    idempotencyKey: string,
  ): Promise<BookingDetailDto> {
    const salon = await this.availability.getSalonOrThrow(input.salonId);
    // Multi-service booking core mission — every selected service is loaded and validated (real,
    // ACTIVE, belongs to this salon, no duplicates) before any duration/price is trusted. The
    // client never supplies duration/price directly; only ids.
    const services = await this.availability.getServicesOrThrow(
      input.salonId,
      input.serviceIds,
    );
    const totalDurationMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);
    const totalPricePaise = services.reduce(
      (sum, s) => sum + decimalStringToPaise(s.price.toString()),
      0,
    );
    const totalPrice = paiseToDecimalString(totalPricePaise);

    // Shop-specific online offer: APP/WEB bookings receive the salon's currently configured
    // percentage, while the underlying Service prices remain untouched. The exact amount is
    // snapshotted on Booking below so changing/ending the offer never rewrites booking history.
    const onlineBookingDiscountPercent =
      source === BookingSource.APP || source === BookingSource.WEB
        ? (salon.onlineBookingDiscountPercent ?? 0)
        : 0;
    const onlineBookingDiscountAmountPaise = computePercentageDiscountPaise(
      totalPricePaise,
      onlineBookingDiscountPercent,
    );
    const discountedTotalPricePaise = Math.max(
      0,
      totalPricePaise - onlineBookingDiscountAmountPaise,
    );
    const discountedTotalPrice = paiseToDecimalString(discountedTotalPricePaise);

    const slotStart = new Date(input.slotStart);
    if (slotStart.getTime() <= Date.now()) {
      throw new AppException(
        BookingErrorCode.SLOT_IN_PAST,
        'The requested slot must be in the future.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const slotEnd = new Date(
      slotStart.getTime() + totalDurationMinutes * 60_000,
    );
    await this.availability.assertWithinOperatingHours(
      input.salonId,
      slotStart,
      slotEnd,
    );

    if (input.preferredStaffId) {
      // V1 semantics (explicit mission scope): ONE barber for the complete appointment, qualified
      // for EVERY selected service — never a mid-appointment handoff between barbers.
      await this.availability.assertStaffQualifiedForServices(
        input.salonId,
        input.serviceIds,
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
    // outstanding balance is settled. Part H (Customer Dues + Cancellation Policy mission): checks
    // whether ANY qualifying OUTSTANDING row exists — a customer with one WAIVED entry and one
    // still-OUTSTANDING entry must remain blocked, so this can never collapse to "most recent row"
    // logic; findMany + a non-empty result is what keeps that correct by construction.
    const outstandingEntries = await this.prisma.customerLedgerEntry.findMany({
      where: {
        customerId,
        salonId: input.salonId,
        status: LedgerStatus.OUTSTANDING,
      },
      select: { amount: true, reason: true },
    });
    if (outstandingEntries.length > 0) {
      const totalOutstandingAmount = outstandingEntries.reduce(
        (sum, e) => sum + Number(e.amount),
        0,
      );
      // Part I: a real actionable message instead of a generic one — the exact reason/amount only
      // when there's a single unambiguous entry, otherwise the total (never just "the first one").
      const message =
        outstandingEntries.length === 1
          ? `${formatMoney(totalOutstandingAmount, salon.currency)} ${
              outstandingEntries[0].reason === LedgerReason.NO_SHOW_CHARGE
                ? 'no-show due'
                : 'cancellation charge'
            } at ${salon.name}. Please settle it before booking again.`
          : `You have ${formatMoney(totalOutstandingAmount, salon.currency)} in outstanding dues at ${salon.name}. Please settle it before booking again.`;
      const details: OutstandingBalanceDetailsDto = {
        totalOutstandingAmount,
        currency: salon.currency ?? 'INR',
        entries: outstandingEntries.map((e) => ({
          reason: e.reason,
          amount: Number(e.amount),
        })),
      };
      throw new AppException(
        BookingErrorCode.OUTSTANDING_BALANCE,
        message,
        HttpStatus.CONFLICT,
        { ...details },
      );
    }

    // STATE_MACHINES.md: initial status is a pure function of SalonPaymentPolicy. Not reachable
    // with today's seeded data (no salon has configured PARTIAL/FULL yet, and payment-policy
    // management is dashboard work, out of scope here) but implemented correctly regardless.
    const paymentPolicy = await this.prisma.salonPaymentPolicy.findUnique({
      where: { salonId: input.salonId },
    });

    // Part 5 completion (arrival guidance): snapshot the arrival-window rule in effect right now,
    // onto the booking itself — see schema.prisma's doc comment on
    // checkInOpensMinutesBefore/checkInDueGraceMinutes for why this must never be a live join to
    // CancellationPolicy at read time.
    const arrivalPolicy = await this.cancellationPolicy.getEffectivePolicy(input.salonId);

    // Online payment is optional. A shop may accept online bookings without ever configuring a
    // payment QR; those bookings are confirmed normally and can be paid at the shop. A configured
    // QR only enables the prepayment path below — it is never a prerequisite for creating an
    // APP/WEB booking.
    const hasOnlinePaymentSetup = Boolean(paymentPolicy?.paymentQrImageUrl);

    // FastQue Credits / Wallet V1: the client-requested amount is never trusted as-is — it is only
    // ever an upper bound. The server independently computes the redemption cap from its own
    // trusted service price and, inside the transaction below, clamps to the customer's live
    // wallet balance too — CustomerCreditsService.redeemUpTo returns the ACTUAL amount applied,
    // which is what gets snapshotted onto the booking, never this requested figure.
    const requestedCredits = input.creditsToRedeem ?? 0;
    // Part 11 precision hardening: pass the exact decimal string straight through — never
    // Number(price) — so the authoritative cap is derived via integer paise, not a float division
    // of the price. Multi-service booking core mission: the cap now applies to the COMBINED price
    // of every selected service, never just the first/primary one.
    const maxCreditsAllowed = this.credits.computeMaxRedeemable(discountedTotalPrice);

    const prepaymentRequirement =
      paymentPolicy?.prepaymentRequirement ?? PrepaymentRequirement.NONE;
    const requiresPrepayment =
      hasOnlinePaymentSetup &&
      (prepaymentRequirement === PrepaymentRequirement.PARTIAL ||
        prepaymentRequirement === PrepaymentRequirement.FULL);
    const status: BookingStatus = requiresPrepayment
      ? BookingStatus.PENDING_PAYMENT
      : BookingStatus.CONFIRMED;
    const prepaymentPercentage =
      prepaymentRequirement === PrepaymentRequirement.FULL
        ? 100
        : (paymentPolicy?.prepaymentPercentage ?? 100);
    // Multi-service booking core mission: prepayment is a percentage of the COMBINED price, not
    // just the first selected service — same float-percentage computation as before, applied to
    // the correct total.
    const prepaymentRequiredAmount = requiresPrepayment
      ? paiseToRupees(
          computePercentageDiscountPaise(
            discountedTotalPricePaise,
            prepaymentPercentage,
          ),
        )
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

      const slotCapacity = await this.availability.getSlotCapacityForServices(
        tx,
        input.salonId,
        input.serviceIds,
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
          // Multi-service booking core mission: the first selected service remains Booking's own
          // serviceId/service — the read-compatibility pointer every pre-existing consumer
          // (QueueEntry check-in linkage, analytics, admin activity, the customer ledger's service
          // label) keeps reading unchanged. The COMPLETE, ordered selection is written below.
          serviceId: services[0].id,
          slotStart,
          slotEnd,
          status,
          source,
          idempotencyKey,
          preferredStaffId: input.preferredStaffId ?? null,
          prepaymentRequiredAmount,
          onlineBookingDiscountPercent,
          onlineBookingDiscountAmount: paiseToDecimalString(onlineBookingDiscountAmountPaise),
          selectedStyleName: input.selectedStyleName ?? null,
          checkInOpensMinutesBefore: EARLY_CHECKIN_WINDOW_MINUTES,
          checkInDueGraceMinutes: arrivalPolicy.appointmentArrivalGraceMinutes,
          services: {
            create: services.map((s, sortOrder) => ({
              serviceId: s.id,
              sortOrder,
              serviceName: s.name,
              durationMinutes: s.durationMinutes,
              price: s.price,
            })),
          },
        },
      });

      // FastQue Credits / Wallet V1: redeem inside the same transaction as the booking's own
      // creation — a rolled-back booking (e.g. SLOT_FULL, discovered a moment later in this same
      // transaction on a race) must never have actually spent the customer's balance. actualUsed
      // is the server-clamped amount (min of requested, live balance, price-based cap) — never the
      // raw requestedCredits figure — so that's what gets snapshotted onto the booking.
      if (requestedCredits > 0) {
        // Part 11 precision hardening: redeemUpTo now returns exact integer PAISE, never a rupee
        // float — both writes below convert straight from paise to a Decimal string, so no
        // Decimal -> Number -> Decimal round-trip ever happens on the way to persistence.
        const { actualUsedPaise, fastQueFundedConsumedPaise } =
          await this.credits.redeemUpTo(
            tx,
            customerId,
            created.id,
            requestedCredits,
            maxCreditsAllowed,
          );
        if (actualUsedPaise > 0) {
          await tx.booking.update({
            where: { id: created.id },
            data: { creditsRedeemedAmount: paiseToDecimalString(actualUsedPaise) },
          });
        }
        // FastQue subsidizes only the portion it actually funded — a future SHOP_FUNDED grant
        // must never create a FastQue liability (see PlatformShopSubsidyEntry's own doc comment).
        // Voided, not deleted, if the booking is later cancelled (see cancel() below).
        if (fastQueFundedConsumedPaise > 0) {
          await tx.platformShopSubsidyEntry.create({
            data: {
              salonId: input.salonId,
              bookingId: created.id,
              amount: paiseToDecimalString(fastQueFundedConsumedPaise),
              status: SubsidyLedgerStatus.OUTSTANDING,
            },
          });
        }
      }

      return created.id;
    }, TRANSACTION_OPTIONS);

    // Only after the transaction has actually committed — never on a rolled-back create (e.g.
    // SLOT_FULL), since that never reaches this line.
    // Multi-service booking core mission: a concise, truthful summary ("Haircut + Beard Trim", or
    // "3 services") — never just the first selected service's name — for every notification/push
    // surface below. See summarizeServiceNames's own doc comment for the exact rule.
    const serviceSummary = summarizeServiceNames(services.map((s) => s.name));
    this.realtime.emitBookingCreated(input.salonId, bookingId);
    await this.notifications.notify(
      customerId,
      'booking.confirmed',
      {
        salonId: input.salonId,
        salonName: salon.name,
        serviceName: serviceSummary,
      },
      // No per-booking detail route exists on web yet (the list at account/bookings is the whole
      // surface) — the deep link must point at a route that actually exists, not an imagined one.
      'account/bookings',
    );
    await this.notifications.notify(
      salon.ownerUserId,
      'owner.booking.created',
      { salonId: input.salonId, bookingId, serviceName: serviceSummary },
      `dashboard/salons/${input.salonId}/bookings`,
    );
    // Real OS push, distinct from the in-app Notification row above and the websocket emit —
    // reaches the owner's device even backgrounded/terminated, IF they've registered one (Issue
    // #13 Mission L). Fire-and-forget: PushDispatchService never throws, so this can never turn a
    // successful booking into a failed request, and this call site only runs once per genuine
    // creation (the controller's @Idempotent() replays a retried request's cached response
    // without re-invoking this method at all). Localized to the owner's own preferredLanguage —
    // see dispatchLocalizedToUser's own doc comment for the Build 9 defect this closes.
    void this.pushDispatch.dispatchLocalizedToUser(
      salon.ownerUserId,
      'newBooking',
      serviceSummary,
      { type: 'booking.created', salonId: input.salonId, bookingId },
    );

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
    // Production-safety hardening (P0 #2): resolveEffectiveBookingServices falls back to the live
    // Service join for a booking a rolling-deploy old backend created with zero BookingService
    // rows, so this can never compute a charge against a price of 0.
    const effectiveServices = resolveEffectiveBookingServices(booking);
    // Reuses packages/shared/src/calc's computeCancellationCharge — the same function the client
    // uses to render a live preview before the customer ever taps "Cancel." isNoShow is always
    // false here: no-show detection is dashboard/system-triggered work, out of scope in this phase.
    // Multi-service booking core mission: the charge is computed against the COMBINED price of
    // every service on this appointment, never just the first/primary one.
    const chargeAmount = computeCancellationCharge(
      policy,
      paiseToRupees(
        this.discountedServicePricePaise(
          effectiveServices,
          booking.onlineBookingDiscountAmount,
        ),
      ),
      minutesUntilSlot,
      false,
    );

    // Only the reachable branch of STATE_MACHINES.md's cancellation flowchart is implemented: no
    // eligible Payment can exist in V1 data (the Payments module isn't built), so a charge always
    // becomes a CustomerLedgerEntry(OUTSTANDING), never a refund — see the plan's explicit scoping.
    const { booking: updated, linkedQueueEntryCancelled } =
      await this.prisma.$transaction(async (tx) => {
        // The status check above is only a fast-path/UX check against a pre-transaction read — two
        // concurrent cancel requests for the same booking could otherwise both pass it before
        // either commits, then both restore credits and both create a cancellation-charge ledger
        // entry (tx.booking.update below has no status guard in its WHERE, so a second call would
        // silently re-cancel an already-cancelled booking). This advisory lock plus a fresh
        // in-transaction status re-check closes that race exactly like create()'s per-salon lock
        // closes the equivalent double-booking race — the second caller sees CANCELLED here and is
        // rejected instead of double-executing every money-moving effect below.
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`booking-cancel:${bookingId}`}))`,
        );
        const current = await tx.booking.findUnique({
          where: { id: bookingId },
          select: { status: true },
        });
        if (
          !current ||
          (current.status !== BookingStatus.CONFIRMED &&
            current.status !== BookingStatus.PENDING_PAYMENT)
        ) {
          throw new AppException(
            BookingErrorCode.BOOKING_NOT_CANCELLABLE,
            'This booking can no longer be cancelled.',
            HttpStatus.CONFLICT,
          );
        }

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

        // Issue 3 (mobile stabilization mission) — a booking checked in before it was cancelled has
        // a linked QueueEntry (source=APPOINTMENT, see queue.service.ts checkIn()) that would
        // otherwise stay WAITING/CALLED forever, inflating the live queue and its waiting count/ETA.
        // Only a WAITING or CALLED entry is touched here — never IN_SERVICE (the customer is
        // physically in the chair; that stays the queue engine's own concern), and the `bookingId`
        // match means an unrelated WALK_IN entry (bookingId always null) can never be affected.
        const queueClaim = await tx.queueEntry.updateMany({
          where: {
            bookingId,
            status: { in: QUEUE_ENTRY_STATUSES_CANCELLABLE_FROM_BOOKING },
          },
          data: { status: QueueEntryStatus.CANCELLED },
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

        // FastQue Credits / Wallet V1: give back exactly the amount snapshot at booking-creation
        // time (never re-derived), and void — not delete — the matching subsidy entry, since the
        // service this booking would have subsidized never happened. A booking only ever reaches
        // this transaction from CONFIRMED/PENDING_PAYMENT (the guard above), so this can never run
        // twice for the same booking.
        if (booking.creditsRedeemedAmount != null) {
          // Part 11 precision hardening: read the exact Decimal string, never Number(decimal) —
          // the snapshot is restored via integer paise, never re-derived, never rounded.
          const restoredAmountPaise = decimalStringToPaise(
            booking.creditsRedeemedAmount.toString(),
          );
          await this.credits.restoreForCancelledBooking(
            tx,
            customerId,
            bookingId,
            restoredAmountPaise,
          );
          await tx.platformShopSubsidyEntry.updateMany({
            where: { bookingId, status: SubsidyLedgerStatus.OUTSTANDING },
            data: { status: SubsidyLedgerStatus.VOIDED, voidedAt: new Date() },
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
              freeCancellationWindowMinutes:
                policy.freeCancellationWindowMinutes,
            },
          },
        });

        return {
          booking: result,
          linkedQueueEntryCancelled: queueClaim.count > 0,
        };
      }, TRANSACTION_OPTIONS);

    this.realtime.emitBookingCancelled(updated.salonId, bookingId);
    if (linkedQueueEntryCancelled) {
      // Reuses QueueService's own recompute rather than re-implementing the ETA/position formula
      // here — every other queue-state-changing action in the app (join/call/assign/complete/
      // no-show/cancel) already goes through this same call, so a booking-triggered cancellation
      // now produces identical downstream effects (remaining WAITING entries' positions/ETAs
      // shift, salon.updated realtime fires) instead of a second, drifting implementation.
      await this.queue.recomputeEtas(updated.salonId);
      this.realtime.emitQueueUpdated(updated.salonId);
    }
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
    // Real OS push, same rationale and fire-and-forget contract as create()'s own push — this was
    // previously MISSING entirely for cancellation (only creation dispatched one), so a
    // backgrounded/terminated owner had no way to learn of a cancellation except reopening the
    // app. Localized to the owner's own preferredLanguage, same as the created push.
    void this.pushDispatch.dispatchLocalizedToUser(
      updated.salon.ownerUserId,
      'bookingCancelled',
      summarizeServiceNames(
        resolveEffectiveBookingServices(updated).map((s) => s.serviceName),
      ),
      { type: 'booking.cancelled', salonId: updated.salonId, bookingId },
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
    // Multi-service booking core mission — reschedule keeps the EXISTING selected services
    // unchanged (see rescheduleBookingSchema's own doc comment: a different service selection is a
    // new booking, not a reschedule) and recalculates the full combined interval at the proposed
    // new start time from the booking's own stored BookingService snapshot, never a live re-fetch
    // of the current Service rows. Production-safety hardening (P0 #2): falls back to the live
    // Service join for a rolling-deploy booking with zero BookingService rows, so this can never
    // recompute a zero-duration interval (newSlotEnd === newSlotStart).
    const effectiveServices = resolveEffectiveBookingServices(booking);
    const totalDurationMinutes = effectiveServices.reduce(
      (sum, s) => sum + s.durationMinutes,
      0,
    );
    const newSlotEnd = new Date(
      newSlotStart.getTime() + totalDurationMinutes * 60_000,
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

      const slotCapacity = await this.availability.getSlotCapacityForServices(
        tx,
        booking.salonId,
        effectiveServices.map((s) => s.serviceId),
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
    void this.pushDispatch.dispatchLocalizedToUser(
      booking.salon.ownerUserId,
      'bookingRescheduled',
      summarizeServiceNames(
        resolveEffectiveBookingServices(updated).map((s) => s.serviceName),
      ),
      { type: 'booking.rescheduled', salonId: booking.salonId, bookingId },
    );

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
    // Production-safety hardening (P0 #2): falls back to the live Service join for a booking a
    // rolling-deploy old backend created with zero BookingService rows — see
    // resolveEffectiveBookingServices's own doc comment. Every field below that used to read
    // `booking.services` directly now reads this instead, so such a booking is never shown with 0
    // duration, 0 price, or an empty service list/summary.
    const effectiveServices = resolveEffectiveBookingServices(booking);
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
      creditsRedeemedAmount:
        booking.creditsRedeemedAmount !== null
          ? Number(booking.creditsRedeemedAmount)
          : null,
      onlineBookingDiscountPercent: booking.onlineBookingDiscountPercent,
      onlineBookingDiscountAmount: Number(booking.onlineBookingDiscountAmount),
      // Salon-scoped: a booking's amounts are denominated in its salon's currency.
      currency: booking.salon.currency,
      salonName: booking.salon.name,
      salonSlug: booking.salon.slug,
      citySlug: booking.salon.city.slug,
      salonCountryCode: booking.salon.city.countryCode,
      salonAddress: booking.salon.addressLine,
      salonLat: booking.salon.lat,
      salonLng: booking.salon.lng,
      salonTimezone: resolveSalonTimeZone({
        timezone: booking.salon.timezone,
        countryCode: booking.salon.city.countryCode,
      }),
      ...computeArrivalGuidance({
        status: booking.status,
        slotStart: booking.slotStart,
        checkInOpensMinutesBefore: booking.checkInOpensMinutesBefore,
        checkInDueGraceMinutes: booking.checkInDueGraceMinutes,
        hasCheckedIn: booking.queueEntries.length > 0,
      }),
      // Multi-service booking core mission: these three fields are now the COMBINED
      // summary/total across every selected service, not just the first one — see
      // BookingServiceItemDto's own doc comment. This is a strict correctness improvement for any
      // caller that hasn't been updated to render the full `services` breakdown below: it now sees
      // the true total price/duration instead of a single service's, and a truthful multi-service
      // name summary instead of a misleadingly incomplete one.
      serviceName: summarizeServiceNames(effectiveServices.map((s) => s.serviceName)),
      serviceDurationMinutes: effectiveServices.reduce((sum, s) => sum + s.durationMinutes, 0),
      servicePrice: paiseToRupees(this.totalServicePricePaise(effectiveServices)),
      discountedServicePrice: paiseToRupees(
        this.discountedServicePricePaise(
          effectiveServices,
          booking.onlineBookingDiscountAmount,
        ),
      ),
      // The complete, ordered per-service breakdown — every booking (including one created before
      // this mission existed, backfilled by this mission's migration, AND one a rolling-deploy old
      // backend created with zero BookingService rows) has at least one entry here.
      services: effectiveServices.map(
        (s): BookingServiceItemDto => ({
          serviceId: s.serviceId,
          name: s.serviceName,
          durationMinutes: s.durationMinutes,
          price: Number(s.price),
        }),
      ),
      // Payable invariant is computed in integer paise:
      // original service subtotal - shop online discount - FastQue Credits.
      payableAmount: paiseToRupees(
        Math.max(
          0,
          this.discountedServicePricePaise(
            effectiveServices,
            booking.onlineBookingDiscountAmount,
          ) -
            (booking.creditsRedeemedAmount
              ? decimalStringToPaise(booking.creditsRedeemedAmount.toString())
              : 0),
        ),
      ),
      preferredStaffName: booking.preferredStaff?.displayName ?? null,
      hasReview: booking.reviews.length > 0,
    };
  }

  private discountedServicePricePaise(
    services: readonly { price: Prisma.Decimal }[],
    discountAmount: Prisma.Decimal | null | undefined,
  ): number {
    return Math.max(
      0,
      this.totalServicePricePaise(services) -
        (discountAmount ? decimalStringToPaise(discountAmount.toString()) : 0),
    );
  }

  /**
   * Multi-service booking core mission — exact integer-paise sum of a booking's own snapshotted
   * BookingService prices (see money/index.ts's own header comment for why paise, never a
   * Number(decimal) float sum). The single place every price total in this file is derived from,
   * so servicePrice/payableAmount/cancellation-charge input can never silently drift from each
   * other.
   */
  private totalServicePricePaise(
    services: readonly { price: Prisma.Decimal }[],
  ): number {
    return services.reduce(
      (sum, s) => sum + decimalStringToPaise(s.price.toString()),
      0,
    );
  }
}
