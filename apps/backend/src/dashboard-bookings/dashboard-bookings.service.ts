import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  OWNER_BOOKING_FILTERS,
  type OwnerBookingDetailDto,
  type OwnerBookingFilter,
  type PaginatedResult,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  resolveSalonTimeZone,
  zonedDayBounds,
} from '../common/timezone/timezone';
import { computeArrivalGuidance } from '../bookings/arrival-guidance';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Shared by list/getOne so the mapping to OwnerBookingDetailDto's fields never drifts across call
// sites — same pattern as bookings.service.ts's bookingDetailInclude. queueEntries is limited to
// the single most recent entry: that's the only one relevant to "who is actually assigned right
// now," and a booking practically only ever produces one check-in.
const ownerBookingInclude = {
  salon: {
    select: {
      name: true,
      slug: true,
      currency: true,
      addressLine: true,
      lat: true,
      lng: true,
      // Part 5: resolved into OwnerBookingDetailDto.salonTimezone below, same as
      // bookings.service.ts's customer-facing bookingDetailInclude.
      timezone: true,
      city: { select: { slug: true, countryCode: true } },
    },
  },
  service: { select: { name: true, durationMinutes: true, price: true } },
  preferredStaff: { select: { displayName: true } },
  customer: { select: { phone: true, email: true } },
  queueEntries: {
    select: {
      assignedStaffId: true,
      assignedStaff: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  // Phase 16 (Ratings & Reviews) — id only, same as bookings.service.ts's own bookingDetailInclude.
  reviews: { select: { id: true } },
} satisfies Prisma.BookingInclude;

type OwnerBookingWithDetails = Prisma.BookingGetPayload<{
  include: typeof ownerBookingInclude;
}>;

@Injectable()
export class DashboardBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async list(
    userId: string,
    salonId: string,
    filterRaw: string | undefined,
    cursor: string | undefined,
    limitRaw: string | undefined,
    from: string | undefined,
    to: string | undefined,
    date?: string,
  ): Promise<PaginatedResult<OwnerBookingDetailDto>> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const filter = this.resolveFilter(filterRaw);
    const limit = this.resolveLimit(limitRaw);
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'date must be in YYYY-MM-DD form.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const where: Prisma.BookingWhereInput = {
      salonId,
      ...(await this.filterWhere(filter, salonId)),
    };
    // `date` (the day scheduler) takes precedence over raw from/to — both exist to scope
    // slotStart, and a caller has no reason to send both. Reuses the exact same
    // zonedDayBoundsForSalon the 'today' filter already trusts, generalized to an arbitrary day,
    // so "what day is this in the salon's own timezone" is computed identically everywhere rather
    // than reimplemented (and potentially drifting) in whichever caller needs a specific date.
    if (date) {
      const { start, end } = await this.zonedDayBoundsForSalon(salonId, date);
      where.slotStart = { gte: start, lt: end };
    } else if (from || to) {
      where.slotStart = {
        ...(typeof where.slotStart === 'object' ? where.slotStart : {}),
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    // Today/upcoming/a specific date all read soonest-first (operationally "what's next" or "the
    // day's own order"); every outcome/history view reads most-recent-first, same convention as
    // bookings.service.ts's own listMine.
    const ascending = filter === 'today' || filter === 'upcoming' || !!date;

    const bookings = await this.prisma.booking.findMany({
      where,
      orderBy: { slotStart: ascending ? 'asc' : 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: ownerBookingInclude,
    });
    const hasMore = bookings.length > limit;
    const page = hasMore ? bookings.slice(0, limit) : bookings;
    return {
      items: page.map((b) => this.toOwnerDetailDto(b)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getOne(
    userId: string,
    salonId: string,
    bookingId: string,
  ): Promise<OwnerBookingDetailDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    // Scoped by salonId, not just id — an owner of salon A must never fetch a booking that
    // belongs to salon B even if they somehow know its id.
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, salonId },
      include: ownerBookingInclude,
    });
    if (!booking) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toOwnerDetailDto(booking);
  }

  private resolveFilter(filterRaw: string | undefined): OwnerBookingFilter {
    if (!filterRaw) return 'all';
    if (!(OWNER_BOOKING_FILTERS as readonly string[]).includes(filterRaw)) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        `Unknown filter "${filterRaw}".`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return filterRaw as OwnerBookingFilter;
  }

  private resolveLimit(limitRaw: string | undefined): number {
    const parsed = limitRaw ? Number(limitRaw) : DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
    return Math.min(parsed, MAX_PAGE_SIZE);
  }

  private async filterWhere(
    filter: OwnerBookingFilter,
    salonId: string,
  ): Promise<Prisma.BookingWhereInput> {
    switch (filter) {
      case 'today': {
        const { start, end } = await this.zonedDayBoundsForSalon(salonId);
        return { slotStart: { gte: start, lt: end } };
      }
      case 'upcoming': {
        // Deliberately excludes today's own remaining slots — those belong to the `today` filter
        // — and only the still-actionable statuses, not a future booking someone already cancelled.
        const { end } = await this.zonedDayBoundsForSalon(salonId);
        return {
          slotStart: { gte: end },
          status: {
            in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
          },
        };
      }
      case 'completed':
        return { status: BookingStatus.COMPLETED };
      case 'cancelled':
        return { status: BookingStatus.CANCELLED };
      case 'no_show':
        return { status: BookingStatus.NO_SHOW };
      case 'all':
        return {};
    }
  }

  /** Only queried for the 'today'/'upcoming' filters and the day scheduler's `date` param — every
   * other filter needs no timezone at all, so this stays a separate lookup rather than something
   * list() always pays for. `dateStr` (YYYY-MM-DD) picks an arbitrary day instead of today; noon
   * UTC on that calendar date is always safely inside it regardless of the salon's own offset, so
   * zonedDayBounds (which only uses the reference instant to derive which local date it falls on)
   * resolves the *requested* day, not whatever day that instant happens to be in UTC. */
  private async zonedDayBoundsForSalon(
    salonId: string,
    dateStr?: string,
  ): Promise<{ start: Date; end: Date }> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true, city: { select: { countryCode: true } } },
    });
    const timeZone = salon
      ? resolveSalonTimeZone({
          timezone: salon.timezone,
          countryCode: salon.city.countryCode,
        })
      : null;
    const reference = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
    const bounds = timeZone ? zonedDayBounds(reference, timeZone) : null;
    if (!bounds) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'This salon has not set a timezone yet, so today/upcoming cannot be computed safely.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { start: bounds.start, end: bounds.end };
  }

  private toOwnerDetailDto(
    booking: OwnerBookingWithDetails,
  ): OwnerBookingDetailDto {
    const latestEntry = booking.queueEntries[0];
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
      serviceName: booking.service.name,
      serviceDurationMinutes: booking.service.durationMinutes,
      servicePrice: Number(booking.service.price),
      payableAmount: Math.max(
        0,
        Number(booking.service.price) -
          Number(booking.creditsRedeemedAmount ?? 0),
      ),
      preferredStaffName: booking.preferredStaff?.displayName ?? null,
      customerPhone: booking.customer.phone,
      customerEmail: booking.customer.email,
      assignedStaffId: latestEntry?.assignedStaffId ?? null,
      assignedStaffName: latestEntry?.assignedStaff?.displayName ?? null,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
      cancelledAt: booking.cancelledAt
        ? booking.cancelledAt.toISOString()
        : null,
      hasReview: booking.reviews.length > 0,
    };
  }
}
