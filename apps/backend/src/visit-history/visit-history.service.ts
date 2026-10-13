import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  QueueEntrySource,
  QueueEntryStatus,
  VISIT_HISTORY_FILTERS,
  decimalStringToPaise,
  paiseToRupees,
  summarizeServiceNames,
  type CustomerVisitHistoryItemDto,
  type OwnerVisitHistoryItemDto,
  type PaginatedResult,
  type VisitHistoryFilter,
  type VisitHistoryItemDto,
  type VisitHistoryServiceDto,
  type VisitHistorySource,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  resolveSalonTimeZone,
  zonedDayBounds,
} from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const BOOKING_ACTIVE = [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT];
const QUEUE_ACTIVE = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.CALLED,
  QueueEntryStatus.IN_SERVICE,
];

type HistoryCursor = {
  at: string;
  id: string;
  source: VisitHistorySource;
};

const historyBookingInclude = {
  salon: {
    select: {
      name: true,
      currency: true,
      timezone: true,
      city: { select: { countryCode: true } },
    },
  },
  service: { select: { id: true, name: true, price: true } },
  services: { orderBy: { sortOrder: 'asc' } },
  preferredStaff: { select: { displayName: true } },
  queueEntries: {
    where: { bookingId: { not: null } },
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    take: 1,
    include: {
      assignedStaff: { select: { displayName: true } },
      serviceSessions: {
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        take: 1,
        include: { staff: { select: { displayName: true } } },
      },
    },
  },
  reviews: {
    select: {
      id: true,
      customerId: true,
      rating: true,
      comment: true,
      ownerResponse: true,
      bookingId: true,
      queueEntryId: true,
      salonId: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.BookingInclude;

const historyOwnerBookingInclude = {
  ...historyBookingInclude,
  customer: { select: { phone: true, email: true } },
} satisfies Prisma.BookingInclude;

const historyQueueInclude = {
  salon: {
    select: {
      name: true,
      currency: true,
      timezone: true,
      city: { select: { countryCode: true } },
    },
  },
  service: { select: { id: true, name: true } },
  assignedStaff: { select: { displayName: true } },
  serviceSessions: {
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    include: {
      service: { select: { id: true, name: true } },
      staff: { select: { displayName: true } },
    },
  },
  reviews: {
    select: {
      id: true,
      customerId: true,
      rating: true,
      comment: true,
      ownerResponse: true,
      bookingId: true,
      queueEntryId: true,
      salonId: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.QueueEntryInclude;

const historyOwnerQueueInclude = {
  ...historyQueueInclude,
  customer: { select: { phone: true, email: true } },
} satisfies Prisma.QueueEntryInclude;

type BookingHistoryRow = Prisma.BookingGetPayload<{
  include: typeof historyBookingInclude;
}>;
type OwnerBookingHistoryRow = Prisma.BookingGetPayload<{
  include: typeof historyOwnerBookingInclude;
}>;
type QueueHistoryRow = Prisma.QueueEntryGetPayload<{
  include: typeof historyQueueInclude;
}>;
type OwnerQueueHistoryRow = Prisma.QueueEntryGetPayload<{
  include: typeof historyOwnerQueueInclude;
}>;

/**
 * Read-only projection over the two historical source tables. This is intentionally not a write
 * path and never synthesizes Booking rows. Customer reads are keyed by the authenticated user ID;
 * owner reads first pass the existing salon authorization check and remain salon-scoped.
 */
@Injectable()
export class VisitHistoryService {
  private readonly logger = new Logger(VisitHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async listCustomer(
    customerId: string,
    sourceRaw?: string,
    cursorRaw?: string,
    limitRaw?: string,
  ): Promise<PaginatedResult<CustomerVisitHistoryItemDto>> {
    const source = this.resolveSource(sourceRaw);
    const cursor = this.parseCursor(cursorRaw);
    const limit = this.resolveLimit(limitRaw);
    const bookingsPromise: Promise<BookingHistoryRow[]> =
      source === 'LIVE_QUEUE'
        ? Promise.resolve([])
        : this.prisma.booking.findMany({
            where: {
              customerId,
              ...(cursor
                ? this.bookingCursorWhere('slotStart', cursor, 'ONLINE_BOOKING')
                : {}),
            },
            orderBy: [{ slotStart: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            include: historyBookingInclude,
          });
    const queuePromise: Promise<QueueHistoryRow[]> =
      source === 'ONLINE_BOOKING'
        ? Promise.resolve([])
        : this.prisma.queueEntry.findMany({
            where: {
              customerId,
              bookingId: null,
              source: QueueEntrySource.WALK_IN,
              ...(cursor
                ? this.queueCursorWhere('joinedAt', cursor, 'LIVE_QUEUE')
                : {}),
            },
            orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            include: historyQueueInclude,
          });
    const [bookings, queueEntries] = await this.readHistoryPair(
      'customer',
      bookingsPromise,
      queuePromise,
    );

    const merged = [
      ...bookings.map((row) => this.toCustomerBooking(row)),
      ...queueEntries.map((row) => this.toCustomerQueue(row, customerId)),
    ].sort(compareHistoryItems);
    const hasMore = merged.length > limit;
    const items = hasMore ? merged.slice(0, limit) : merged;
    return {
      items,
      nextCursor: hasMore ? this.encodeCursor(items[items.length - 1]) : null,
    };
  }

  async listOwner(
    userId: string,
    salonId: string,
    filterRaw?: string,
    sourceRaw?: string,
    cursorRaw?: string,
    limitRaw?: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<PaginatedResult<OwnerVisitHistoryItemDto>> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const filter = this.resolveFilter(filterRaw);
    const source = this.resolveSource(sourceRaw);
    const cursor = this.parseCursor(cursorRaw);
    const limit = this.resolveLimit(limitRaw);
    const { from, to } = this.resolveDateRange(fromRaw, toRaw);
    const dayBounds =
      filter === 'today' || filter === 'upcoming'
        ? await this.zonedDayBoundsForSalon(salonId)
        : null;

    const bookingStatuses = this.bookingStatuses(filter);
    const queueStatuses = this.queueStatuses(filter);
    const requestedRange =
      from || to
        ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
        : null;
    const bookingDateConditions: Prisma.BookingWhereInput[] = [];
    const queueDateConditions: Prisma.QueueEntryWhereInput[] = [];
    if (dayBounds && filter === 'today') {
      bookingDateConditions.push({
        slotStart: { gte: dayBounds.start, lt: dayBounds.end },
      });
      queueDateConditions.push({
        joinedAt: { gte: dayBounds.start, lt: dayBounds.end },
      });
    } else if (dayBounds && filter === 'upcoming') {
      bookingDateConditions.push({ slotStart: { gte: dayBounds.end } });
    }
    if (requestedRange) {
      bookingDateConditions.push({ slotStart: requestedRange });
      queueDateConditions.push({ joinedAt: requestedRange });
    }
    const [bookings, queueEntries] = await this.readHistoryPair(
      'salon',
      source === 'LIVE_QUEUE'
        ? Promise.resolve([] as OwnerBookingHistoryRow[])
        : this.prisma.booking.findMany({
            where: {
              salonId,
              ...(bookingStatuses ? { status: { in: bookingStatuses } } : {}),
              ...(bookingDateConditions.length
                ? { AND: bookingDateConditions }
                : {}),
              ...(cursor
                ? this.bookingCursorWhere('slotStart', cursor, 'ONLINE_BOOKING')
                : {}),
            },
            orderBy: [{ slotStart: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            include: historyOwnerBookingInclude,
          }),
      source === 'ONLINE_BOOKING' || filter === 'upcoming'
        ? Promise.resolve([] as OwnerQueueHistoryRow[])
        : this.prisma.queueEntry.findMany({
            where: {
              salonId,
              bookingId: null,
              source: QueueEntrySource.WALK_IN,
              ...(queueStatuses ? { status: { in: queueStatuses } } : {}),
              ...(queueDateConditions.length
                ? { AND: queueDateConditions }
                : {}),
              ...(cursor
                ? this.queueCursorWhere('joinedAt', cursor, 'LIVE_QUEUE')
                : {}),
            },
            orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            include: historyOwnerQueueInclude,
          }),
    );

    const merged = [
      ...bookings.map((row) => this.toOwnerBooking(row)),
      ...queueEntries.map((row) => this.toOwnerQueue(row)),
    ].sort(compareHistoryItems);
    const hasMore = merged.length > limit;
    const items = hasMore ? merged.slice(0, limit) : merged;
    return {
      items,
      nextCursor: hasMore ? this.encodeCursor(items[items.length - 1]) : null,
    };
  }

  private toCustomerBooking(
    row: BookingHistoryRow,
  ): CustomerVisitHistoryItemDto {
    const review = row.reviews.find(
      (item) => item.customerId === row.customerId,
    );
    const base = this.bookingBase(row, review);
    return {
      ...base,
      reviewEligible:
        row.status === BookingStatus.COMPLETED && row.reviews.length === 0,
      myReview: review ? this.reviewDetail(review) : null,
    };
  }

  private toOwnerBooking(
    row: OwnerBookingHistoryRow,
  ): OwnerVisitHistoryItemDto {
    const base = this.bookingBase(row);
    const review = row.reviews[0];
    return {
      ...base,
      reviewEligible:
        row.status === BookingStatus.COMPLETED &&
        Boolean(row.customerId) &&
        !review,
      customerId: row.customerId,
      customerName: null,
      customerPhone: row.customer.phone,
      customerEmail: row.customer.email,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private bookingBase(
    row: BookingHistoryRow,
    review = row.reviews[0],
  ): VisitHistoryItemDto {
    const queueEntry = row.queueEntries[0];
    const serviceItems: VisitHistoryServiceDto[] = row.services.length
      ? row.services.map((service) => ({
          serviceId: service.serviceId,
          name: service.serviceName,
          assignedStaffName: queueEntry?.assignedStaff?.displayName ?? null,
          price: Number(service.price),
        }))
      : [
          {
            serviceId: row.serviceId,
            name: row.service.name,
            assignedStaffName: queueEntry?.assignedStaff?.displayName ?? null,
            price: Number(row.service.price),
          },
        ];
    return {
      id: `ONLINE_BOOKING:${row.id}`,
      source: 'ONLINE_BOOKING',
      bookingId: row.id,
      queueEntryId: null,
      salonId: row.salonId,
      salonName: row.salon.name,
      salonTimezone: resolveSalonTimeZone({
        timezone: row.salon.timezone,
        countryCode: row.salon.city.countryCode,
      }),
      currency: row.salon.currency,
      status: row.status,
      serviceDate: row.slotStart.toISOString(),
      joinedAt: queueEntry?.joinedAt.toISOString() ?? null,
      startedAt:
        queueEntry?.serviceSessions[0]?.startedAt.toISOString() ?? null,
      completedAt: queueEntry?.serviceCompletedAt?.toISOString() ?? null,
      services: serviceItems,
      serviceName: summarizeServiceNames(
        serviceItems.map((service) => service.name),
      ),
      assignedStaffName: queueEntry?.assignedStaff?.displayName ?? null,
      price: serviceItems.every((service) => service.price !== null)
        ? paiseToRupees(
            serviceItems.reduce(
              (sum, service) =>
                sum + decimalStringToPaise(String(service.price)),
              0,
            ),
          )
        : null,
      review: review ? this.reviewSummary(review) : null,
      reviewEligible: row.status === BookingStatus.COMPLETED && !review,
    };
  }

  private toCustomerQueue(
    row: QueueHistoryRow,
    customerId: string,
  ): CustomerVisitHistoryItemDto {
    const review = row.reviews.find((item) => item.customerId === customerId);
    const base = this.queueBase(row, review);
    return {
      ...base,
      reviewEligible:
        row.status === QueueEntryStatus.COMPLETED && row.reviews.length === 0,
      myReview: review ? this.reviewDetail(review) : null,
    };
  }

  private toOwnerQueue(row: OwnerQueueHistoryRow): OwnerVisitHistoryItemDto {
    const base = this.queueBase(row);
    const review = row.reviews[0];
    return {
      ...base,
      reviewEligible:
        row.status === QueueEntryStatus.COMPLETED &&
        Boolean(row.customerId) &&
        !review,
      customerId: row.customerId,
      customerName: row.contactName,
      customerPhone: row.contactPhone ?? row.customer?.phone ?? null,
      customerEmail: row.customer?.email ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private queueBase(
    row: QueueHistoryRow,
    review = row.reviews[0],
  ): VisitHistoryItemDto {
    const serviceById = new Map<string, VisitHistoryServiceDto>();
    for (const session of row.serviceSessions) {
      if (!serviceById.has(session.serviceId)) {
        serviceById.set(session.serviceId, {
          serviceId: session.serviceId,
          name: session.service.name,
          assignedStaffName: session.staff.displayName,
          // QueueEntry has no immutable price snapshot; current catalog prices are not historical
          // truth and therefore are deliberately not represented as a charged amount.
          price: null,
        });
      }
    }
    if (serviceById.size === 0 && row.service) {
      serviceById.set(row.service.id, {
        serviceId: row.service.id,
        name: row.service.name,
        assignedStaffName: row.assignedStaff?.displayName ?? null,
        price: null,
      });
    }
    const services = [...serviceById.values()];
    return {
      id: `LIVE_QUEUE:${row.id}`,
      source: 'LIVE_QUEUE',
      bookingId: null,
      queueEntryId: row.id,
      salonId: row.salonId,
      salonName: row.salon.name,
      salonTimezone: resolveSalonTimeZone({
        timezone: row.salon.timezone,
        countryCode: row.salon.city.countryCode,
      }),
      currency: row.salon.currency,
      status: row.status,
      serviceDate: row.joinedAt.toISOString(),
      joinedAt: row.joinedAt.toISOString(),
      startedAt: row.serviceStartedAt?.toISOString() ?? null,
      completedAt: row.serviceCompletedAt?.toISOString() ?? null,
      services,
      serviceName: services.length
        ? summarizeServiceNames(services.map((service) => service.name))
        : 'Service not recorded',
      assignedStaffName:
        row.assignedStaff?.displayName ??
        services.find((service) => service.assignedStaffName)
          ?.assignedStaffName ??
        null,
      price: null,
      review: review ? this.reviewSummary(review) : null,
      reviewEligible:
        row.status === QueueEntryStatus.COMPLETED &&
        Boolean(row.customerId) &&
        !review,
    };
  }

  private async zonedDayBoundsForSalon(
    salonId: string,
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
    const bounds = timeZone ? zonedDayBounds(new Date(), timeZone) : null;
    if (!bounds) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'This salon has not set a timezone, so today/upcoming cannot be computed safely.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { start: bounds.start, end: bounds.end };
  }

  private reviewSummary(review: {
    id: string;
    rating: number;
    createdAt: Date;
  }) {
    return {
      id: review.id,
      rating: review.rating,
      createdAt: review.createdAt.toISOString(),
    };
  }

  private reviewDetail(review: {
    id: string;
    bookingId: string | null;
    queueEntryId: string | null;
    salonId: string;
    rating: number;
    comment: string | null;
    ownerResponse: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: review.id,
      bookingId: review.bookingId,
      queueEntryId: review.queueEntryId,
      salonId: review.salonId,
      rating: review.rating,
      comment: review.comment,
      ownerResponse: review.ownerResponse,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    };
  }

  private resolveFilter(value: string | undefined): VisitHistoryFilter {
    if (!value) return 'all';
    if (!(VISIT_HISTORY_FILTERS as readonly string[]).includes(value)) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'Unknown visit-history filter.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return value as VisitHistoryFilter;
  }

  private resolveSource(
    value: string | undefined,
  ): VisitHistorySource | undefined {
    if (!value || value === 'all') return undefined;
    if (value === 'ONLINE_BOOKING' || value === 'LIVE_QUEUE') return value;
    throw new AppException(
      BookingErrorCode.INVALID_FILTER,
      'Unknown visit-history source.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private bookingStatuses(filter: VisitHistoryFilter) {
    switch (filter) {
      case 'active':
      case 'upcoming':
        return BOOKING_ACTIVE;
      case 'today':
        return undefined;
      case 'completed':
        return [BookingStatus.COMPLETED];
      case 'cancelled':
        return [BookingStatus.CANCELLED];
      case 'expired':
        return [BookingStatus.EXPIRED];
      case 'no_show':
        return [BookingStatus.NO_SHOW];
      case 'all':
        return undefined;
    }
  }

  private queueStatuses(filter: VisitHistoryFilter) {
    switch (filter) {
      case 'active':
        return QUEUE_ACTIVE;
      case 'today':
      case 'upcoming':
        return undefined;
      case 'completed':
        return [QueueEntryStatus.COMPLETED];
      case 'cancelled':
        return [QueueEntryStatus.CANCELLED];
      case 'expired':
        return [QueueEntryStatus.EXPIRED];
      case 'no_show':
        return [QueueEntryStatus.NO_SHOW];
      case 'all':
        return undefined;
    }
  }

  private resolveDateRange(fromRaw?: string, toRaw?: string) {
    const parse = (value: string | undefined) => {
      if (!value) return undefined;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new AppException(
          BookingErrorCode.INVALID_FILTER,
          'Visit-history dates must be valid ISO timestamps.',
          HttpStatus.BAD_REQUEST,
        );
      }
      return date;
    };
    const from = parse(fromRaw);
    const to = parse(toRaw);
    if (from && to && from > to) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'The visit-history date range is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { from, to };
  }

  private resolveLimit(value: string | undefined): number {
    if (!value) return DEFAULT_PAGE_SIZE;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'Visit-history page size must be a positive integer.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return Math.min(parsed, MAX_PAGE_SIZE);
  }

  private parseCursor(value: string | undefined): HistoryCursor | undefined {
    if (!value) return undefined;
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      );
      if (
        typeof decoded === 'object' &&
        decoded !== null &&
        'at' in decoded &&
        'id' in decoded &&
        'source' in decoded &&
        typeof decoded.at === 'string' &&
        !Number.isNaN(Date.parse(decoded.at)) &&
        typeof decoded.id === 'string' &&
        decoded.id.length > 0 &&
        decoded.id.length <= 128 &&
        (decoded.source === 'ONLINE_BOOKING' || decoded.source === 'LIVE_QUEUE')
      ) {
        return {
          at: new Date(decoded.at).toISOString(),
          id: decoded.id,
          source: decoded.source,
        };
      }
    } catch {
      // Invalid cursors are rejected below; don't echo attacker-controlled input.
    }
    throw new AppException(
      BookingErrorCode.INVALID_FILTER,
      'The visit-history cursor is invalid.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private cursorConditions(
    dateField: 'slotStart' | 'joinedAt',
    cursor: HistoryCursor,
    source: VisitHistorySource,
  ): Record<string, unknown>[] {
    const at = new Date(cursor.at);
    const clauses: Array<Record<string, unknown>> = [
      { [dateField]: { lt: at } },
      { [dateField]: at, id: { lt: cursor.id } },
    ];
    // Tie order is source-descending after event time and database ID; include the other stream's
    // exact tie only when it follows the cursor in that deterministic order.
    if (source < cursor.source)
      clauses.push({ [dateField]: at, id: cursor.id });
    return clauses;
  }

  private bookingCursorWhere(
    dateField: 'slotStart',
    cursor: HistoryCursor,
    source: VisitHistorySource,
  ): Prisma.BookingWhereInput {
    return {
      OR: this.cursorConditions(dateField, cursor, source),
    };
  }

  private queueCursorWhere(
    dateField: 'joinedAt',
    cursor: HistoryCursor,
    source: VisitHistorySource,
  ): Prisma.QueueEntryWhereInput {
    return {
      OR: this.cursorConditions(dateField, cursor, source),
    };
  }

  private encodeCursor(item: VisitHistoryItemDto): string {
    return Buffer.from(
      JSON.stringify({
        at: item.serviceDate,
        id: item.bookingId ?? item.queueEntryId,
        source: item.source,
      }),
      'utf8',
    ).toString('base64url');
  }

  private async readHistoryPair<TBooking, TQueue>(
    scope: 'customer' | 'salon',
    bookings: Promise<TBooking>,
    queueEntries: Promise<TQueue>,
  ): Promise<[TBooking, TQueue]> {
    try {
      return await Promise.all([bookings, queueEntries]);
    } catch (error) {
      // Record availability failures without logging user/salon identifiers or database messages,
      // which may contain query data. The request still fails normally for client-visible handling.
      this.logger.error(
        JSON.stringify({
          event: 'visit_history_read_failed',
          scope,
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      throw error;
    }
  }
}

function compareHistoryItems(
  a: VisitHistoryItemDto,
  b: VisitHistoryItemDto,
): number {
  const byDate = b.serviceDate.localeCompare(a.serviceDate);
  if (byDate !== 0) return byDate;
  const aRecordId = a.bookingId ?? a.queueEntryId ?? a.id;
  const bRecordId = b.bookingId ?? b.queueEntryId ?? b.id;
  const byId = bRecordId.localeCompare(aRecordId);
  if (byId !== 0) return byId;
  return b.source.localeCompare(a.source);
}
