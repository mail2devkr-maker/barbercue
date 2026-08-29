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

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Mirrors bookings/availability.service.ts's own fixed +05:30 offset convention (no salon
// timezone field is populated yet — see that file's doc comment) so "today"/"upcoming" agree with
// how every OperatingHours window and booking slot is already interpreted.
const IST_OFFSET_MINUTES = 330;

function istDayBounds(reference: Date): { start: Date; end: Date } {
  const ist = new Date(reference.getTime() + IST_OFFSET_MINUTES * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - IST_OFFSET_MINUTES * 60_000);
  const end = new Date(Date.UTC(y, m, d + 1) - IST_OFFSET_MINUTES * 60_000);
  return { start, end };
}

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
  ): Promise<PaginatedResult<OwnerBookingDetailDto>> {
    await this.salonAccess.assertAccess(userId, salonId);

    const filter = this.resolveFilter(filterRaw);
    const limit = this.resolveLimit(limitRaw);

    const where: Prisma.BookingWhereInput = {
      salonId,
      ...this.filterWhere(filter),
    };
    if (from || to) {
      where.slotStart = {
        ...(typeof where.slotStart === 'object' ? where.slotStart : {}),
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    // Today/upcoming read soonest-first (operationally "what's next"); every outcome/history view
    // reads most-recent-first, same convention as bookings.service.ts's own listMine.
    const ascending = filter === 'today' || filter === 'upcoming';

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
    await this.salonAccess.assertAccess(userId, salonId);
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

  private filterWhere(filter: OwnerBookingFilter): Prisma.BookingWhereInput {
    switch (filter) {
      case 'today': {
        const { start, end } = istDayBounds(new Date());
        return { slotStart: { gte: start, lt: end } };
      }
      case 'upcoming': {
        // Deliberately excludes today's own remaining slots — those belong to the `today` filter
        // — and only the still-actionable statuses, not a future booking someone already cancelled.
        const { end } = istDayBounds(new Date());
        return {
          slotStart: { gte: end },
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT] },
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

  private toOwnerDetailDto(booking: OwnerBookingWithDetails): OwnerBookingDetailDto {
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
      customerPhone: booking.customer.phone,
      customerEmail: booking.customer.email,
      assignedStaffId: latestEntry?.assignedStaffId ?? null,
      assignedStaffName: latestEntry?.assignedStaff?.displayName ?? null,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
      cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
      hasReview: booking.reviews.length > 0,
    };
  }
}
