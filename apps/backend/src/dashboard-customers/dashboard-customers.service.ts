import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  BookingStatus,
  LedgerReason,
  LedgerStatus,
  NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT,
  QueueEntryStatus,
  type CustomerLedgerEntryDto,
  type CustomerSegment,
  type LedgerActionResultDto,
  type OwnerCustomerHistoryEntryDto,
  type OwnerCustomerHistoryPageDto,
  type OwnerCustomerHistoryQuery,
  type OwnerCustomerSummaryDto,
  type PaginatedResult,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  ledgerRowSelect,
  toLedgerEntryDto,
  type LedgerRow,
} from './ledger-entry';
import { resolveEffectiveBookingServices } from '../bookings/effective-booking-services';
import {
  addZonedCalendarDays,
  resolveSalonTimeZone,
} from '../common/timezone/timezone';
import { localRange } from '../owner-ops/local-time';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// A repeat visitor becomes "frequent" at this many COMPLETED visits — a plain, documented
// threshold, not a data-driven cutoff. Owners reading this label should understand it as "5 or
// more finished visits at this salon," nothing more inferred about the customer.
export const FREQUENT_CUSTOMER_THRESHOLD = 5;

interface CustomerAggregates {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
  preferredServiceId: string | null;
  preferredStaffId: string | null;
  queueTotal: number;
  queueCompleted: number;
  queueCancelled: number;
  queueNoShow: number;
  queueExpired: number;
  firstQueueCompletedAt: Date | null;
  lastQueueCompletedAt: Date | null;
}

interface CustomerListRow {
  customerId: string;
}

interface CustomerHistoryCursor {
  v: 1;
  salonId: string;
  customerId: string;
  filterKey: string;
  occurredAt: string;
  rank: 0 | 1 | 2;
  id: string;
}

interface CustomerHistoryBookingRow {
  id: string;
  slotStart: Date;
  status: string;
  source: string;
  createdAt: Date;
  guestName: string | null;
  services: { serviceName: string }[];
  service: { name: string };
  queueEntries: {
    serviceStartedAt: Date | null;
    serviceCompletedAt: Date | null;
    assignedStaff: { displayName: string } | null;
  }[];
}

interface CustomerHistoryQueueRow {
  id: string;
  joinedAt: Date;
  createdAt: Date;
  status: string;
  contactName: string | null;
  serviceStartedAt: Date | null;
  serviceCompletedAt: Date | null;
  assignedStaff: { displayName: string } | null;
  service: { name: string } | null;
  serviceSessions: { status: string; service: { name: string } }[];
}

interface CustomerHistoryInvoiceRow {
  id: string;
  number: string;
  status: 'ISSUED' | 'VOID';
  currency: string;
  total: { toString(): string };
  discountTotal: { toString(): string };
  bookingId: string | null;
  queueEntryId: string | null;
  payments: {
    kind: 'PAYMENT' | 'REFUND';
    method: 'CASH' | 'UPI' | 'CARD' | 'OTHER';
    amount: { toString(): string };
    recordedAt: Date;
  }[];
}

function historyFilterKey(
  actorId: string,
  query: OwnerCustomerHistoryQuery,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        actorId,
        source: query.source ?? null,
        status: query.status ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      }),
    )
    .digest('hex');
}

function historyCursorSigningKey(): Buffer {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppException(
      BookingErrorCode.CUSTOMER_HISTORY_CURSOR_UNAVAILABLE,
      'Customer history pagination is temporarily unavailable.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return createHmac('sha256', secret)
    .update('fastque:customer-history-cursor:v1')
    .digest();
}

function historyRank(
  source: OwnerCustomerHistoryEntryDto['source'],
): 0 | 1 | 2 {
  return source === 'ONLINE_BOOKING'
    ? 0
    : source === 'IN_SHOP_APPOINTMENT'
      ? 1
      : 2;
}

function encodeHistoryCursor(
  actorId: string,
  salonId: string,
  customerId: string,
  item: Pick<OwnerCustomerHistoryEntryDto, 'id' | 'source' | 'occurredAt'>,
  query: OwnerCustomerHistoryQuery,
): string {
  const cursor: CustomerHistoryCursor = {
    v: 1,
    salonId,
    customerId,
    filterKey: historyFilterKey(actorId, query),
    occurredAt: item.occurredAt,
    rank: historyRank(item.source),
    id: item.id,
  };
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  const signature = createHmac('sha256', historyCursorSigningKey())
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function decodeHistoryCursor(
  raw: string | undefined,
  actorId: string,
  salonId: string,
  customerId: string,
  query: OwnerCustomerHistoryQuery,
): CustomerHistoryCursor | null {
  if (!raw) return null;
  const signingKey = historyCursorSigningKey();
  try {
    const [payload, suppliedSignature, extra] = raw.split('.');
    if (!payload || !suppliedSignature || extra !== undefined) return null;
    const expectedSignature = createHmac('sha256', signingKey)
      .update(payload)
      .digest();
    const receivedSignature = Buffer.from(suppliedSignature, 'base64url');
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return null;
    }
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<CustomerHistoryCursor>;
    if (
      parsed.v !== 1 ||
      parsed.salonId !== salonId ||
      parsed.customerId !== customerId ||
      parsed.filterKey !== historyFilterKey(actorId, query) ||
      (parsed.rank !== 0 && parsed.rank !== 1 && parsed.rank !== 2) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length < 1 ||
      parsed.id.length > 128 ||
      typeof parsed.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.occurredAt))
    ) {
      return null;
    }
    return {
      v: 1,
      salonId,
      customerId,
      filterKey: parsed.filterKey,
      occurredAt: parsed.occurredAt,
      rank: parsed.rank,
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

function segmentFor(completedCount: number): CustomerSegment | null {
  if (completedCount >= FREQUENT_CUSTOMER_THRESHOLD) return 'frequent';
  if (completedCount >= 2) return 'repeat';
  if (completedCount === 1) return 'new';
  return null;
}

/** Picks the key with the highest count from a `customerId -> (key -> count)` nested map. */
function topKeyByCustomer(
  counts: Map<string, Map<string, number>>,
  customerId: string,
): string | null {
  const byKey = counts.get(customerId);
  if (!byKey || byKey.size === 0) return null;
  let bestKey: string | null = null;
  let bestCount = -1;
  for (const [key, count] of byKey) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

/**
 * Owner-side salon customer history/CRM (Phase 8) — read-only aggregation over this salon's own
 * Booking/QueueEntry rows, scoped by salonId in every query so Owner A can never see Salon B's
 * customer relationships. Never infers anything about a customer beyond their own booking counts
 * at this one salon (see CustomerSegment's own doc comment).
 *
 * No dedicated "customer" row exists in the schema — a customer is just a User who has booked
 * here, so this is entirely derived from Booking/QueueEntry via groupBy, not a stored table.
 */
@Injectable()
export class DashboardCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async list(
    userId: string,
    salonId: string,
    offsetRaw: string | undefined,
    limitRaw: string | undefined,
    searchRaw?: string,
  ): Promise<PaginatedResult<OwnerCustomerSummaryDto>> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);

    const offset = this.resolveOffset(offsetRaw);
    const limit = this.resolveLimit(limitRaw);
    const search = searchRaw?.trim();
    if (search && (search.length < 1 || search.length > 120)) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'Customer search must be between 1 and 120 characters.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Project authenticated account activity from both source tables. Booking-linked queue rows
    // are excluded because they are the same visit; guest rows (customerId NULL) are never
    // identity-matched by phone/name. Search can match a record-name snapshot only within rows
    // already linked to that exact account, and never merges accounts by names or phone numbers.
    const searchClause = search
      ? Prisma.sql`AND (
          u."id" ILIKE ${`%${search}%`}
          OR COALESCE(u."phone", '') ILIKE ${`%${search}%`}
          OR COALESCE(u."email", '') ILIKE ${`%${search}%`}
          OR EXISTS (
            SELECT 1 FROM "bookings" bn
            WHERE bn."salonId" = ${salonId}
              AND bn."customerId" = u."id"
              AND COALESCE(bn."guestName", '') ILIKE ${`%${search}%`}
          )
          OR EXISTS (
            SELECT 1 FROM "queue_entries" qn
            WHERE qn."salonId" = ${salonId}
              AND qn."customerId" = u."id"
              AND qn."bookingId" IS NULL
              AND COALESCE(qn."contactName", '') ILIKE ${`%${search}%`}
          )
          OR EXISTS (
            SELECT 1 FROM "booking_services" bsn
            INNER JOIN "bookings" bsnb ON bsnb."id" = bsn."bookingId"
            WHERE bsnb."salonId" = ${salonId}
              AND bsnb."customerId" = u."id"
              AND bsn."serviceName" ILIKE ${`%${search}%`}
          )
          OR EXISTS (
            SELECT 1 FROM "queue_entries" qsvc
            INNER JOIN "services" sv ON sv."id" = qsvc."serviceId"
            WHERE qsvc."salonId" = ${salonId}
              AND qsvc."customerId" = u."id"
              AND sv."name" ILIKE ${`%${search}%`}
          )
          OR EXISTS (
            SELECT 1 FROM "queue_entries" qstaff
            INNER JOIN "salon_staff" st ON st."id" = qstaff."assignedStaffId"
            WHERE qstaff."salonId" = ${salonId}
              AND qstaff."customerId" = u."id"
              AND st."displayName" ILIKE ${`%${search}%`}
          )
        )`
      : Prisma.empty;
    const page = await this.prisma.$queryRaw<CustomerListRow[]>(Prisma.sql`
      WITH customer_activity AS (
        SELECT b."customerId", MAX(b."slotStart") AS "activityAt"
        FROM "bookings" b
        WHERE b."salonId" = ${salonId} AND b."customerId" IS NOT NULL
        GROUP BY b."customerId"
        UNION ALL
        SELECT q."customerId", MAX(COALESCE(q."serviceCompletedAt", q."joinedAt")) AS "activityAt"
        FROM "queue_entries" q
        WHERE q."salonId" = ${salonId}
          AND q."customerId" IS NOT NULL
          AND q."bookingId" IS NULL
        GROUP BY q."customerId"
      ), latest_customer_activity AS (
        SELECT "customerId", MAX("activityAt") AS "activityAt"
        FROM customer_activity
        GROUP BY "customerId"
      )
      SELECT l."customerId"
      FROM latest_customer_activity l
      INNER JOIN "users" u ON u."id" = l."customerId"
      WHERE u."deletedAt" IS NULL ${searchClause}
      ORDER BY l."activityAt" DESC, l."customerId" ASC
      OFFSET ${offset}
      LIMIT ${limit + 1}
    `);
    const hasMore = page.length > limit;
    const rows = hasMore ? page.slice(0, limit) : page;
    const customerIds = rows.map((r) => r.customerId);
    if (customerIds.length === 0) return { items: [], nextCursor: null };

    const summaries = await this.buildSummaries(salonId, customerIds);
    const byId = new Map(summaries.map((s) => [s.customerId, s]));
    const items = rows
      .map((r) => (r.customerId ? byId.get(r.customerId) : undefined))
      .filter((s): s is OwnerCustomerSummaryDto => s !== undefined);

    return {
      items,
      nextCursor: hasMore ? String(offset + limit) : null,
    };
  }

  /** Owner-only unified account history over bookings and standalone authenticated Live Queue visits. */
  async history(
    userId: string,
    salonId: string,
    customerId: string,
    query: OwnerCustomerHistoryQuery,
  ): Promise<OwnerCustomerHistoryPageDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);

    const [salon, bookingCount, queueCount] = await Promise.all([
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { timezone: true, city: { select: { countryCode: true } } },
      }),
      this.prisma.booking.count({ where: { salonId, customerId } }),
      this.prisma.queueEntry.count({
        where: { salonId, customerId, bookingId: null },
      }),
    ]);
    if (bookingCount === 0 && queueCount === 0) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'This customer has no visits at this salon.',
        HttpStatus.NOT_FOUND,
      );
    }

    const salonTimezone = salon
      ? resolveSalonTimeZone({
          timezone: salon.timezone,
          countryCode: salon.city.countryCode,
        })
      : null;
    if (!salonTimezone) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'This salon has not set a timezone, so customer history dates cannot be filtered safely.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const range = this.historyRange(query, salonTimezone);
    const cursor = decodeHistoryCursor(
      query.cursor,
      userId,
      salonId,
      customerId,
      query,
    );
    if (query.cursor && !cursor) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'The customer-history cursor is invalid or belongs to a different salon/customer.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const bookingStatuses = new Set([
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.CONFIRMED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETED,
      BookingStatus.NO_SHOW,
      BookingStatus.EXPIRED,
    ] as string[]);
    const queueStatuses = new Set(Object.values(QueueEntryStatus) as string[]);
    const bookingWhere: Prisma.BookingWhereInput = {
      salonId,
      customerId,
      ...(query.status && bookingStatuses.has(query.status)
        ? { status: query.status as BookingStatus }
        : {}),
      ...(query.source === 'IN_SHOP_APPOINTMENT'
        ? { source: 'IN_SHOP' }
        : query.source === 'ONLINE_BOOKING'
          ? { source: { not: 'IN_SHOP' } }
          : {}),
      ...(range
        ? {
            slotStart: {
              ...(range.start ? { gte: range.start } : {}),
              ...(range.end ? { lt: range.end } : {}),
            },
          }
        : {}),
      ...(cursor ? { AND: [this.bookingAfterCursor(cursor)] } : {}),
    };
    const queueWhere: Prisma.QueueEntryWhereInput = {
      salonId,
      customerId,
      bookingId: null,
      ...(query.status && queueStatuses.has(query.status)
        ? { status: query.status as QueueEntryStatus }
        : {}),
      ...(range
        ? {
            joinedAt: {
              ...(range.start ? { gte: range.start } : {}),
              ...(range.end ? { lt: range.end } : {}),
            },
          }
        : {}),
      ...(cursor ? { AND: [this.queueAfterCursor(cursor)] } : {}),
    };
    const limit = query.limit;
    const bookingStatusMatches =
      !query.status || bookingStatuses.has(query.status);
    const queueStatusMatches = !query.status || queueStatuses.has(query.status);
    const [bookingRows, queueRows] = (await Promise.all([
      query.source === 'LIVE_QUEUE' || !bookingStatusMatches
        ? Promise.resolve([])
        : this.prisma.booking.findMany({
            where: bookingWhere,
            orderBy: [{ slotStart: 'desc' }, { id: 'asc' }],
            take: limit + 1,
            select: {
              id: true,
              slotStart: true,
              status: true,
              source: true,
              createdAt: true,
              guestName: true,
              services: {
                orderBy: { sortOrder: 'asc' },
                select: { serviceName: true },
              },
              service: { select: { name: true } },
              queueEntries: {
                select: {
                  serviceStartedAt: true,
                  serviceCompletedAt: true,
                  assignedStaff: { select: { displayName: true } },
                },
                take: 1,
              },
            },
          }),
      query.source === 'ONLINE_BOOKING' ||
      query.source === 'IN_SHOP_APPOINTMENT' ||
      !queueStatusMatches
        ? Promise.resolve([])
        : this.prisma.queueEntry.findMany({
            where: queueWhere,
            orderBy: [{ joinedAt: 'desc' }, { id: 'asc' }],
            take: limit + 1,
            select: {
              id: true,
              joinedAt: true,
              createdAt: true,
              status: true,
              contactName: true,
              serviceStartedAt: true,
              serviceCompletedAt: true,
              assignedStaff: { select: { displayName: true } },
              service: { select: { name: true } },
              serviceSessions: {
                orderBy: { startedAt: 'asc' },
                select: {
                  status: true,
                  service: { select: { name: true } },
                },
              },
            },
          }),
    ])) as unknown as [CustomerHistoryBookingRow[], CustomerHistoryQueueRow[]];
    const bookings = bookingRows;
    const queueEntries = queueRows;
    const bookingIds = bookings.map((row) => row.id);
    const queueIds = queueEntries.map((row) => row.id);
    const invoices =
      bookingIds.length > 0 || queueIds.length > 0
        ? await this.prisma.invoice.findMany({
            where: {
              salonId,
              customerId,
              OR: [
                ...(bookingIds.length > 0
                  ? [{ bookingId: { in: bookingIds } }]
                  : []),
                ...(queueIds.length > 0
                  ? [{ queueEntryId: { in: queueIds } }]
                  : []),
              ],
            },
            orderBy: { issuedAt: 'desc' },
            select: {
              id: true,
              number: true,
              status: true,
              currency: true,
              total: true,
              discountTotal: true,
              bookingId: true,
              queueEntryId: true,
              payments: {
                orderBy: { recordedAt: 'asc' },
                select: {
                  kind: true,
                  method: true,
                  amount: true,
                  recordedAt: true,
                },
              },
            },
          })
        : [];
    const historyInvoices = invoices as CustomerHistoryInvoiceRow[];

    const invoicesByBooking = new Map<
      string,
      OwnerCustomerHistoryPageDto['items'][number]['invoices']
    >();
    const invoicesByQueue = new Map<
      string,
      OwnerCustomerHistoryPageDto['items'][number]['invoices']
    >();
    for (const invoice of historyInvoices) {
      const dto = {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        total: invoice.total.toString(),
        discountTotal: invoice.discountTotal.toString(),
        payments: invoice.payments.map((payment) => ({
          kind: payment.kind,
          method: payment.method,
          amount: payment.amount.toString(),
          recordedAt: payment.recordedAt.toISOString(),
        })),
      };
      if (invoice.bookingId) {
        const rows = invoicesByBooking.get(invoice.bookingId) ?? [];
        rows.push(dto);
        invoicesByBooking.set(invoice.bookingId, rows);
      }
      if (invoice.queueEntryId) {
        const rows = invoicesByQueue.get(invoice.queueEntryId) ?? [];
        rows.push(dto);
        invoicesByQueue.set(invoice.queueEntryId, rows);
      }
    }

    const items: OwnerCustomerHistoryEntryDto[] = [
      ...bookings.map((booking) => {
        const linkedQueue = booking.queueEntries[0];
        return {
          id: booking.id,
          source:
            booking.source === 'IN_SHOP'
              ? ('IN_SHOP_APPOINTMENT' as const)
              : ('ONLINE_BOOKING' as const),
          occurredAt: booking.slotStart.toISOString(),
          createdAt: booking.createdAt.toISOString(),
          status: booking.status,
          recordedName: booking.guestName,
          serviceNames:
            booking.services.length > 0
              ? booking.services.map((entry) => entry.serviceName)
              : [booking.service.name],
          staffName: linkedQueue?.assignedStaff?.displayName ?? null,
          startedAt: linkedQueue?.serviceStartedAt?.toISOString() ?? null,
          completedAt: linkedQueue?.serviceCompletedAt?.toISOString() ?? null,
          invoices: invoicesByBooking.get(booking.id) ?? [],
        };
      }),
      ...queueEntries.map((entry) => {
        const sessionServices = [
          ...new Set(
            entry.serviceSessions.map((session) => session.service.name),
          ),
        ];
        return {
          id: entry.id,
          source: 'LIVE_QUEUE' as const,
          occurredAt: entry.joinedAt.toISOString(),
          createdAt: entry.createdAt.toISOString(),
          status: entry.status,
          recordedName: entry.contactName,
          serviceNames:
            sessionServices.length > 0
              ? sessionServices
              : entry.service?.name
                ? [entry.service.name]
                : [],
          staffName: entry.assignedStaff?.displayName ?? null,
          startedAt: entry.serviceStartedAt?.toISOString() ?? null,
          completedAt: entry.serviceCompletedAt?.toISOString() ?? null,
          invoices: invoicesByQueue.get(entry.id) ?? [],
        };
      }),
    ].sort((a, b) => {
      const timeDiff = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
      if (timeDiff !== 0) return timeDiff;
      const rankDiff = historyRank(a.source) - historyRank(b.source);
      if (rankDiff !== 0) return rankDiff;
      return a.id.localeCompare(b.id);
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    return {
      salonId,
      customerId,
      salonTimezone,
      items: page,
      nextCursor:
        hasMore && last
          ? encodeHistoryCursor(userId, salonId, customerId, last, query)
          : null,
    };
  }

  async getOne(
    userId: string,
    salonId: string,
    customerId: string,
  ): Promise<OwnerCustomerSummaryDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const [summary] = await this.buildSummaries(salonId, [customerId]);
    if (!summary) {
      throw new AppException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'This customer has no bookings at this salon.',
        HttpStatus.NOT_FOUND,
      );
    }
    return summary;
  }

  private resolveOffset(offsetRaw: string | undefined): number {
    const parsed = offsetRaw ? Number(offsetRaw) : 0;
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  private resolveLimit(limitRaw: string | undefined): number {
    const parsed = limitRaw ? Number(limitRaw) : DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
    return Math.min(parsed, MAX_PAGE_SIZE);
  }

  private historyRange(
    query: OwnerCustomerHistoryQuery,
    timeZone: string,
  ): { start?: Date; end?: Date } | null {
    if (!query.from && !query.to) return null;
    const first = query.from ?? query.to!;
    const lastExclusive = addZonedCalendarDays(query.to ?? query.from!, 1);
    const range = localRange(first, lastExclusive, timeZone);
    if (!range) {
      throw new AppException(
        BookingErrorCode.INVALID_FILTER,
        'The requested salon-local date range could not be resolved.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return {
      ...(query.from ? { start: range.start } : {}),
      ...(query.to ? { end: range.end } : {}),
    };
  }

  private bookingAfterCursor(
    cursor: CustomerHistoryCursor,
  ): Prisma.BookingWhereInput {
    const occurredAt = new Date(cursor.occurredAt);
    if (cursor.rank === 2) return { slotStart: { lt: occurredAt } };
    const sameTimeAfter: Prisma.BookingWhereInput[] =
      cursor.rank === 0
        ? [
            {
              slotStart: occurredAt,
              source: { not: 'IN_SHOP' },
              id: { gt: cursor.id },
            },
            { slotStart: occurredAt, source: 'IN_SHOP' },
          ]
        : [
            {
              slotStart: occurredAt,
              source: 'IN_SHOP',
              id: { gt: cursor.id },
            },
          ];
    return { OR: [{ slotStart: { lt: occurredAt } }, ...sameTimeAfter] };
  }

  private queueAfterCursor(
    cursor: CustomerHistoryCursor,
  ): Prisma.QueueEntryWhereInput {
    const occurredAt = new Date(cursor.occurredAt);
    return cursor.rank < 2
      ? { joinedAt: { lte: occurredAt } }
      : {
          OR: [
            { joinedAt: { lt: occurredAt } },
            { joinedAt: occurredAt, id: { gt: cursor.id } },
          ],
        };
  }

  private async buildSummaries(
    salonId: string,
    customerIds: string[],
  ): Promise<OwnerCustomerSummaryDto[]> {
    const [
      salon,
      users,
      totalGrouped,
      completedGrouped,
      cancelledGrouped,
      noShowGrouped,
      serviceGrouped,
      staffGrouped,
      queueVisitGrouped,
      ledgerRows,
    ] = await Promise.all([
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { currency: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, phone: true, email: true },
      }),
      this.prisma.booking.groupBy({
        by: ['customerId'],
        where: { salonId, customerId: { in: customerIds } },
        _count: { _all: true },
      }),
      this.prisma.booking.groupBy({
        by: ['customerId'],
        where: {
          salonId,
          customerId: { in: customerIds },
          status: BookingStatus.COMPLETED,
        },
        _count: { _all: true },
        _min: { slotStart: true },
        _max: { slotStart: true },
      }),
      this.prisma.booking.groupBy({
        by: ['customerId'],
        where: {
          salonId,
          customerId: { in: customerIds },
          status: BookingStatus.CANCELLED,
        },
        _count: { _all: true },
      }),
      this.prisma.booking.groupBy({
        by: ['customerId'],
        where: {
          salonId,
          customerId: { in: customerIds },
          status: BookingStatus.NO_SHOW,
        },
        _count: { _all: true },
      }),
      // Multi-service booking core mission follow-up — a booking.groupBy on the legacy
      // Booking.serviceId alone would only ever count a multi-service appointment toward its
      // FIRST selected service, undercounting every other one (the same bug servicePopularity in
      // dashboard-analytics.service.ts was fixed for). Fetch the full snapshot per booking instead
      // and tally every selected service via resolveEffectiveBookingServices below.
      this.prisma.booking.findMany({
        where: {
          salonId,
          customerId: { in: customerIds },
          status: BookingStatus.COMPLETED,
        },
        select: {
          customerId: true,
          serviceId: true,
          service: {
            select: { name: true, durationMinutes: true, price: true },
          },
          services: {
            select: {
              serviceId: true,
              serviceName: true,
              durationMinutes: true,
              price: true,
            },
          },
        },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['customerId', 'assignedStaffId'],
        where: {
          salonId,
          customerId: { in: customerIds },
          assignedStaffId: { not: null },
          status: QueueEntryStatus.COMPLETED,
        },
        _count: { _all: true },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['customerId', 'status'],
        where: {
          salonId,
          customerId: { in: customerIds },
          bookingId: null,
        },
        _count: { _all: true },
        _min: { serviceCompletedAt: true },
        _max: { serviceCompletedAt: true },
      }),
      // Part E: outstanding/waived dues shown on the customer detail screen. SETTLED entries are
      // deliberately excluded — those are resolved history the owner doesn't need surfaced as an
      // actionable due, unlike OUTSTANDING/WAIVED.
      this.prisma.customerLedgerEntry.findMany({
        where: {
          salonId,
          customerId: { in: customerIds },
          status: { in: [LedgerStatus.OUTSTANDING, LedgerStatus.WAIVED] },
        },
        orderBy: { createdAt: 'desc' },
        select: ledgerRowSelect,
      }),
    ]);

    const aggregates = new Map<string, CustomerAggregates>();
    for (const id of customerIds) {
      aggregates.set(id, {
        total: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        firstVisitAt: null,
        lastVisitAt: null,
        preferredServiceId: null,
        preferredStaffId: null,
        queueTotal: 0,
        queueCompleted: 0,
        queueCancelled: 0,
        queueNoShow: 0,
        queueExpired: 0,
        firstQueueCompletedAt: null,
        lastQueueCompletedAt: null,
      });
    }
    for (const row of totalGrouped) {
      const agg = row.customerId ? aggregates.get(row.customerId) : undefined;
      if (agg) agg.total = row._count._all;
    }
    for (const row of completedGrouped) {
      const agg = row.customerId ? aggregates.get(row.customerId) : undefined;
      if (agg) {
        agg.completed = row._count._all;
        agg.firstVisitAt = row._min.slotStart;
        agg.lastVisitAt = row._max.slotStart;
      }
    }
    for (const row of cancelledGrouped) {
      const agg = row.customerId ? aggregates.get(row.customerId) : undefined;
      if (agg) agg.cancelled = row._count._all;
    }
    for (const row of noShowGrouped) {
      const agg = row.customerId ? aggregates.get(row.customerId) : undefined;
      if (agg) agg.noShow = row._count._all;
    }
    for (const row of queueVisitGrouped) {
      const agg = row.customerId ? aggregates.get(row.customerId) : undefined;
      if (!agg) continue;
      agg.queueTotal += row._count._all;
      if (row.status === QueueEntryStatus.COMPLETED) {
        agg.queueCompleted += row._count._all;
        agg.firstQueueCompletedAt = row._min.serviceCompletedAt;
        agg.lastQueueCompletedAt = row._max.serviceCompletedAt;
      } else if (row.status === QueueEntryStatus.CANCELLED) {
        agg.queueCancelled += row._count._all;
      } else if (row.status === QueueEntryStatus.NO_SHOW) {
        agg.queueNoShow += row._count._all;
      } else if (row.status === QueueEntryStatus.EXPIRED) {
        agg.queueExpired += row._count._all;
      }
    }

    const serviceCounts = new Map<string, Map<string, number>>();
    for (const row of serviceGrouped) {
      // IN_SHOP guest appointments have no account and are not part of customer management.
      if (!row.customerId) continue;
      const byService =
        serviceCounts.get(row.customerId) ?? new Map<string, number>();
      for (const svc of resolveEffectiveBookingServices(row)) {
        byService.set(svc.serviceId, (byService.get(svc.serviceId) ?? 0) + 1);
      }
      serviceCounts.set(row.customerId, byService);
    }
    const staffCounts = new Map<string, Map<string, number>>();
    for (const row of staffGrouped) {
      // QueueEntry.customerId is nullable in the schema (a walk-in the owner logged for someone
      // with no account) — the `where: { customerId: { in: customerIds } }` filter above already
      // excludes those rows at the DB level, but Prisma's generated groupBy type doesn't narrow
      // customerId to non-null based on the where clause, so this guard is required for TS, not
      // just defensive.
      if (!row.assignedStaffId || !row.customerId) continue;
      const byStaff =
        staffCounts.get(row.customerId) ?? new Map<string, number>();
      byStaff.set(row.assignedStaffId, row._count._all);
      staffCounts.set(row.customerId, byStaff);
    }
    for (const id of customerIds) {
      const agg = aggregates.get(id)!;
      agg.preferredServiceId = topKeyByCustomer(serviceCounts, id);
      agg.preferredStaffId = topKeyByCustomer(staffCounts, id);
    }

    const serviceIds = [
      ...new Set(
        [...aggregates.values()]
          .map((a) => a.preferredServiceId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const staffIds = [
      ...new Set(
        [...aggregates.values()]
          .map((a) => a.preferredStaffId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const services =
      serviceIds.length > 0
        ? await this.prisma.service.findMany({
            where: { id: { in: serviceIds } },
            select: { id: true, name: true },
          })
        : [];
    const staff =
      staffIds.length > 0
        ? await this.prisma.salonStaff.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, displayName: true },
          })
        : [];
    const serviceNameById = new Map<string, string>();
    for (const s of services) serviceNameById.set(s.id, s.name);
    const staffNameById = new Map<string, string>();
    for (const s of staff) staffNameById.set(s.id, s.displayName);
    const userById = new Map(users.map((u) => [u.id, u] as const));

    const ledgerByCustomer = new Map<string, CustomerLedgerEntryDto[]>();
    for (const row of ledgerRows as LedgerRow[]) {
      const dto = toLedgerEntryDto(row);
      const list = ledgerByCustomer.get(row.customerId) ?? [];
      list.push(dto);
      ledgerByCustomer.set(row.customerId, list);
    }

    return customerIds
      .map((customerId) => {
        const agg = aggregates.get(customerId)!;
        // A customer may have only authenticated standalone Live Queue visits. Arbitrary IDs with
        // neither booking nor queue activity still fail closed rather than returning zeros.
        if (agg.total === 0 && agg.queueTotal === 0) return null;
        const user = userById.get(customerId);
        const ledgerEntries = ledgerByCustomer.get(customerId) ?? [];
        const outstandingTotalAmount = ledgerEntries
          .filter((e) => e.status === LedgerStatus.OUTSTANDING)
          .reduce((sum, e) => sum + e.amount, 0);
        const dto: OwnerCustomerSummaryDto = {
          customerId,
          phone: user?.phone ?? null,
          email: user?.email ?? null,
          currency: salon?.currency ?? null,
          totalBookings: agg.total,
          completedCount: agg.completed,
          cancelledCount: agg.cancelled,
          noShowCount: agg.noShow,
          firstVisitAt: agg.firstVisitAt
            ? agg.firstVisitAt.toISOString()
            : null,
          lastVisitAt: agg.lastVisitAt ? agg.lastVisitAt.toISOString() : null,
          preferredServiceName: agg.preferredServiceId
            ? (serviceNameById.get(agg.preferredServiceId) ?? null)
            : null,
          preferredStaffName: agg.preferredStaffId
            ? (staffNameById.get(agg.preferredStaffId) ?? null)
            : null,
          segment: segmentFor(agg.completed),
          newCustomerGraceEligible:
            agg.completed < NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT,
          ledgerEntries,
          outstandingTotalAmount,
          totalVisitCount: agg.total + agg.queueTotal,
          completedVisitCount: agg.completed + agg.queueCompleted,
          firstCompletedVisitAt:
            this.earliestDate(
              agg.firstVisitAt,
              agg.firstQueueCompletedAt,
            )?.toISOString() ?? null,
          lastCompletedVisitAt:
            this.latestDate(
              agg.lastVisitAt,
              agg.lastQueueCompletedAt,
            )?.toISOString() ?? null,
          liveQueueVisitCount: agg.queueTotal,
          completedLiveQueueVisitCount: agg.queueCompleted,
          cancelledLiveQueueVisitCount: agg.queueCancelled,
          expiredLiveQueueVisitCount: agg.queueExpired,
          noShowLiveQueueVisitCount: agg.queueNoShow,
        };
        return dto;
      })
      .filter((dto): dto is OwnerCustomerSummaryDto => dto !== null);
  }

  private earliestDate(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a <= b ? a : b;
  }

  private latestDate(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a >= b ? a : b;
  }

  /**
   * Part C/D/F/G — owner-authenticated reversible New Customer No-Show Grace waiver.
   * OUTSTANDING -> WAIVED, only for a NO_SHOW_CHARGE entry belonging to THIS salon and THIS
   * customer, and only while the customer has fewer than NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT
   * COMPLETED bookings at this salon. CANCELLATION_CHARGE entries are never eligible (Part D).
   */
  async waiveNoShowDue(
    userId: string,
    salonId: string,
    customerId: string,
    ledgerEntryId: string,
  ): Promise<LedgerActionResultDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const entry = await this.getOwnedLedgerEntry(
      salonId,
      customerId,
      ledgerEntryId,
    );

    if (entry.reason !== LedgerReason.NO_SHOW_CHARGE) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
        'Only a no-show charge is eligible for the New Customer Grace waiver.',
        HttpStatus.CONFLICT,
      );
    }

    // Idempotent no-op: a retried request against an entry this exact action already succeeded on
    // returns the current (already-WAIVED) state rather than erroring or double-auditing.
    if (entry.status === LedgerStatus.WAIVED) {
      return { ledgerEntry: entry };
    }
    if (entry.status !== LedgerStatus.OUTSTANDING) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
        'This due is not outstanding and cannot be waived.',
        HttpStatus.CONFLICT,
      );
    }

    const completedVisitCount = await this.prisma.booking.count({
      where: { salonId, customerId, status: BookingStatus.COMPLETED },
    });
    if (completedVisitCount >= NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_WAIVABLE,
        'This customer has completed 3 or more visits and is no longer eligible for the New Customer Grace waiver.',
        HttpStatus.CONFLICT,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Claim-based conditional update — same pattern as booking-no-show.service.ts /
      // queue-entry-expiry.service.ts: the where clause re-checks status, so a second concurrent
      // waive request (double-click) can never transition twice or write two audit rows.
      const claim = await tx.customerLedgerEntry.updateMany({
        where: {
          id: ledgerEntryId,
          salonId,
          customerId,
          reason: LedgerReason.NO_SHOW_CHARGE,
          status: LedgerStatus.OUTSTANDING,
        },
        data: { status: LedgerStatus.WAIVED },
      });
      if (claim.count === 0) return null;

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'NO_SHOW_DUE_WAIVED',
          entityType: 'CustomerLedgerEntry',
          entityId: ledgerEntryId,
          metadata: {
            ledgerEntryId,
            customerId,
            salonId,
            bookingId: entry.bookingId,
            amount: entry.amount,
            actorUserId: userId,
            completedVisitCount,
            previousStatus: LedgerStatus.OUTSTANDING,
            newStatus: LedgerStatus.WAIVED,
          },
        },
      });

      return tx.customerLedgerEntry.findUniqueOrThrow({
        where: { id: ledgerEntryId },
        select: ledgerRowSelect,
      });
    });

    if (!result) {
      // Lost the race to a concurrent waive/restore between the read above and this transaction —
      // re-read and return the current state rather than a confusing generic error.
      return {
        ledgerEntry: await this.getOwnedLedgerEntry(
          salonId,
          customerId,
          ledgerEntryId,
        ),
      };
    }
    return { ledgerEntry: toLedgerEntryDto(result) };
  }

  /** Part C — the same waiver, reversed. WAIVED -> OUTSTANDING. Never touches SETTLED entries. */
  async restoreNoShowDue(
    userId: string,
    salonId: string,
    customerId: string,
    ledgerEntryId: string,
  ): Promise<LedgerActionResultDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const entry = await this.getOwnedLedgerEntry(
      salonId,
      customerId,
      ledgerEntryId,
    );

    if (entry.status === LedgerStatus.OUTSTANDING) {
      // Idempotent no-op — mirrors waiveNoShowDue's own retry handling.
      return { ledgerEntry: entry };
    }
    if (entry.status !== LedgerStatus.WAIVED) {
      throw new AppException(
        BookingErrorCode.LEDGER_ENTRY_NOT_RESTORABLE,
        'This due is not waived and cannot be restored.',
        HttpStatus.CONFLICT,
      );
    }
    // A due waived because its booking was corrected NO_SHOW -> COMPLETED (BookingNoShowService.
    // correctToCompleted) must never be resurrected: the customer was served, so re-opening the
    // charge would both bill them for a visit they attended and block their next booking via the
    // OUTSTANDING_BALANCE gate.
    if (entry.bookingId) {
      const linkedBooking = await this.prisma.booking.findUnique({
        where: { id: entry.bookingId },
        select: { status: true },
      });
      if (linkedBooking?.status === BookingStatus.COMPLETED) {
        throw new AppException(
          BookingErrorCode.LEDGER_ENTRY_NOT_RESTORABLE,
          'This due belongs to a booking that was corrected to completed and cannot be restored.',
          HttpStatus.CONFLICT,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.customerLedgerEntry.updateMany({
        where: {
          id: ledgerEntryId,
          salonId,
          customerId,
          status: LedgerStatus.WAIVED,
        },
        data: { status: LedgerStatus.OUTSTANDING },
      });
      if (claim.count === 0) return null;

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'NO_SHOW_DUE_RESTORED',
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
          },
        },
      });

      return tx.customerLedgerEntry.findUniqueOrThrow({
        where: { id: ledgerEntryId },
        select: ledgerRowSelect,
      });
    });

    if (!result) {
      return {
        ledgerEntry: await this.getOwnedLedgerEntry(
          salonId,
          customerId,
          ledgerEntryId,
        ),
      };
    }
    return { ledgerEntry: toLedgerEntryDto(result) };
  }

  /**
   * Fetches a ledger entry and proves — before any mutation — that it belongs to both THIS salon
   * and THIS customer (Part F: "Do not accept arbitrary customerId/salonId combinations that could
   * allow another salon's financial records to be modified"). Looked up by id alone and then
   * checked, rather than folding salonId/customerId into the WHERE, so a mismatch reports the
   * correct 404 instead of leaking whether some other salon's ledgerEntryId exists at all.
   */
  private async getOwnedLedgerEntry(
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
    return toLedgerEntryDto(row);
  }
}
