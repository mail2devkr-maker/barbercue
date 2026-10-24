import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingErrorCode,
  type OwnerCustomerDirectoryItemDto,
  type OwnerCustomerDirectoryPageDto,
  type OwnerCustomerDirectoryQuery,
  type OwnerCustomerServiceHistoryItemDto,
  type OwnerCustomerServiceHistoryPageDto,
  type OwnerCustomerServicesQuery,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  decodeCustomerDirectoryCursor,
  decodeCustomerServicesCursor,
  encodeCustomerDirectoryCursor,
  encodeCustomerServicesCursor,
  invalidCustomerCursor,
} from './customer-directory-cursor';

interface DirectoryRow {
  customerId: string;
  phone: string | null;
  email: string | null;
  totalBookings: number | bigint;
  completedBookings: number | bigint;
  cancelledBookings: number | bigint;
  noShowBookings: number | bigint;
  totalQueueVisits: number | bigint;
  completedQueueVisits: number | bigint;
  cancelledQueueVisits: number | bigint;
  expiredQueueVisits: number | bigint;
  noShowQueueVisits: number | bigint;
  firstCompletedAt: Date | null;
  lastVisitAt: Date | null;
  displayName: string | null;
  displayNameSource: 'CONTACT_NAME_ON_VISIT' | 'GUEST_NAME_ON_BOOKING' | null;
  collectedPaise: bigint | number | string;
  refundedPaise: bigint | number | string;
  netSpentPaise: bigint | number | string;
  segment: 'new' | 'repeat' | 'frequent' | null;
}

interface CustomerServiceRow {
  visitId: string;
  bookingId: string | null;
  source: 'ONLINE_BOOKING' | 'IN_SHOP_APPOINTMENT' | 'LIVE_QUEUE';
  sourceRank: number;
  serviceId: string;
  serviceName: string;
  staffName: string | null;
  eventAt: Date;
  completedAt: Date | null;
  serviceOrder: number;
  invoicedAmount: string | null;
}

function asCount(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function amountFromPaise(value: bigint | number | string): number {
  const paise = BigInt(value);
  const number = Number(paise);
  if (!Number.isSafeInteger(number)) {
    throw new AppException(
      BookingErrorCode.INVALID_FILTER,
      'The customer financial summary exceeds the supported display range.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return number / 100;
}

function nullableAmount(value: string | null): number | null {
  if (value === null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function directoryMetrics(salonId: string): Prisma.Sql {
  return Prisma.sql`
    WITH booking_activity AS (
      SELECT
        b."customerId",
        COUNT(*)::bigint AS "totalBookings",
        COUNT(*) FILTER (WHERE b."status" = 'COMPLETED')::bigint AS "completedBookings",
        COUNT(*) FILTER (WHERE b."status" = 'CANCELLED')::bigint AS "cancelledBookings",
        COUNT(*) FILTER (WHERE b."status" = 'NO_SHOW')::bigint AS "noShowBookings",
        MIN(b."slotStart") FILTER (WHERE b."status" = 'COMPLETED') AS "firstBookingAt",
        MAX(b."slotStart") FILTER (WHERE b."status" = 'COMPLETED') AS "lastBookingAt"
      FROM "bookings" b
      WHERE b."salonId" = ${salonId} AND b."customerId" IS NOT NULL
      GROUP BY b."customerId"
    ), queue_activity AS (
      SELECT
        q."customerId",
        COUNT(*)::bigint AS "totalQueueVisits",
        COUNT(*) FILTER (WHERE q."status" = 'COMPLETED')::bigint AS "completedQueueVisits",
        COUNT(*) FILTER (WHERE q."status" = 'CANCELLED')::bigint AS "cancelledQueueVisits",
        COUNT(*) FILTER (WHERE q."status" = 'EXPIRED')::bigint AS "expiredQueueVisits",
        COUNT(*) FILTER (WHERE q."status" = 'NO_SHOW')::bigint AS "noShowQueueVisits",
        MIN(COALESCE(q."serviceCompletedAt", q."joinedAt")) FILTER (WHERE q."status" = 'COMPLETED') AS "firstQueueAt",
        MAX(COALESCE(q."serviceCompletedAt", q."joinedAt")) FILTER (WHERE q."status" = 'COMPLETED') AS "lastQueueAt"
      FROM "queue_entries" q
      WHERE q."salonId" = ${salonId}
        AND q."customerId" IS NOT NULL
        AND q."bookingId" IS NULL
      GROUP BY q."customerId"
    ), payment_activity AS (
      SELECT
        COALESCE(b."customerId", q."customerId") AS "customerId",
        SUM(CASE WHEN ip."kind" = 'PAYMENT' THEN ip."amount" ELSE 0 END) AS "collected",
        SUM(CASE WHEN ip."kind" = 'REFUND' THEN ip."amount" ELSE 0 END) AS "refunded"
      FROM "invoices" i
      INNER JOIN "invoice_payments" ip
        ON ip."invoiceId" = i."id" AND ip."salonId" = i."salonId"
      LEFT JOIN "bookings" b
        ON b."id" = i."bookingId" AND b."salonId" = i."salonId"
      LEFT JOIN "queue_entries" q
        ON q."id" = i."queueEntryId" AND q."salonId" = i."salonId"
          AND q."bookingId" IS NULL
      WHERE i."salonId" = ${salonId}
        AND COALESCE(b."customerId", q."customerId") IS NOT NULL
      GROUP BY COALESCE(b."customerId", q."customerId")
    ), name_activity AS (
      -- The name this customer most recently gave THIS shop (queue contact name, or the guest name on one of
      -- their own bookings). It is a visit-supplied label with its source, never a verified identity, and it
      -- is scoped to this salon and keyed by the customer's own account (people sharing a phone are not merged).
      SELECT DISTINCT ON (n."customerId") n."customerId", n."name", n."source"
      FROM (
        SELECT
          q."customerId",
          LEFT(NULLIF(BTRIM(REGEXP_REPLACE(q."contactName", '[[:cntrl:]]', '', 'g')), ''), 120) AS "name",
          'CONTACT_NAME_ON_VISIT' AS "source",
          q."joinedAt" AS "at"
        FROM "queue_entries" q
        WHERE q."salonId" = ${salonId} AND q."customerId" IS NOT NULL AND q."bookingId" IS NULL
        UNION ALL
        SELECT
          bk."customerId",
          LEFT(NULLIF(BTRIM(REGEXP_REPLACE(bk."guestName", '[[:cntrl:]]', '', 'g')), ''), 120) AS "name",
          'GUEST_NAME_ON_BOOKING' AS "source",
          bk."createdAt" AS "at"
        FROM "bookings" bk
        WHERE bk."salonId" = ${salonId} AND bk."customerId" IS NOT NULL
      ) n
      WHERE n."name" IS NOT NULL
      ORDER BY n."customerId", n."at" DESC
    ), metrics AS (
      SELECT
        u."id" AS "customerId",
        u."phone",
        u."email",
        nm."name" AS "displayName",
        nm."source" AS "displayNameSource",
        COALESCE(b."totalBookings", 0)::bigint AS "totalBookings",
        COALESCE(b."completedBookings", 0)::bigint AS "completedBookings",
        COALESCE(b."cancelledBookings", 0)::bigint AS "cancelledBookings",
        COALESCE(b."noShowBookings", 0)::bigint AS "noShowBookings",
        COALESCE(q."totalQueueVisits", 0)::bigint AS "totalQueueVisits",
        COALESCE(q."completedQueueVisits", 0)::bigint AS "completedQueueVisits",
        COALESCE(q."cancelledQueueVisits", 0)::bigint AS "cancelledQueueVisits",
        COALESCE(q."expiredQueueVisits", 0)::bigint AS "expiredQueueVisits",
        COALESCE(q."noShowQueueVisits", 0)::bigint AS "noShowQueueVisits",
        CASE
          WHEN b."firstBookingAt" IS NULL THEN q."firstQueueAt"
          WHEN q."firstQueueAt" IS NULL THEN b."firstBookingAt"
          ELSE LEAST(b."firstBookingAt", q."firstQueueAt")
        END AS "firstCompletedAt",
        CASE
          WHEN b."lastBookingAt" IS NULL THEN q."lastQueueAt"
          WHEN q."lastQueueAt" IS NULL THEN b."lastBookingAt"
          ELSE GREATEST(b."lastBookingAt", q."lastQueueAt")
        END AS "lastVisitAt",
        ROUND(COALESCE(p."collected", 0) * 100)::bigint AS "collectedPaise",
        ROUND(COALESCE(p."refunded", 0) * 100)::bigint AS "refundedPaise",
        ROUND((COALESCE(p."collected", 0) - COALESCE(p."refunded", 0)) * 100)::bigint AS "netSpentPaise",
        (COALESCE(b."completedBookings", 0) + COALESCE(q."completedQueueVisits", 0))::bigint AS "completedVisitCount",
        CASE
          WHEN COALESCE(b."completedBookings", 0) + COALESCE(q."completedQueueVisits", 0) >= 5 THEN 'frequent'
          WHEN COALESCE(b."completedBookings", 0) + COALESCE(q."completedQueueVisits", 0) >= 2 THEN 'repeat'
          WHEN COALESCE(b."completedBookings", 0) + COALESCE(q."completedQueueVisits", 0) = 1 THEN 'new'
          ELSE NULL
        END AS "segment"
      FROM "users" u
      LEFT JOIN booking_activity b ON b."customerId" = u."id"
      LEFT JOIN queue_activity q ON q."customerId" = u."id"
      LEFT JOIN payment_activity p ON p."customerId" = u."id"
      LEFT JOIN name_activity nm ON nm."customerId" = u."id"
      WHERE u."deletedAt" IS NULL
        AND (b."customerId" IS NOT NULL OR q."customerId" IS NOT NULL)
    )
  `;
}

function countCompletedExpression(): Prisma.Sql {
  return Prisma.sql`(m."completedBookings" + m."completedQueueVisits")`;
}

function sortExpression(sort: OwnerCustomerDirectoryQuery['sort']): Prisma.Sql {
  if (sort === 'totalSpent') return Prisma.sql`m."netSpentPaise"`;
  if (sort === 'visits') return countCompletedExpression();
  return Prisma.sql`m."lastVisitAt"`;
}

function directoryCursorClause(
  cursor: ReturnType<typeof decodeCustomerDirectoryCursor>,
  sort: OwnerCustomerDirectoryQuery['sort'],
): Prisma.Sql {
  if (!cursor) return Prisma.empty;
  if (sort === 'lastVisit') {
    if (cursor.sortValue === null) {
      return Prisma.sql`AND (m."lastVisitAt" IS NULL AND m."customerId" > ${cursor.customerId})`;
    }
    // The source columns are PostgreSQL TIMESTAMP(3) (without time zone), storing UTC wall-clock
    // values. A JavaScript Date sent as a raw-query parameter can be adapted as a timezone-aware
    // value, which makes the comparison session-TimeZone dependent and can leave the boundary row
    // eligible on the next page. Normalize to the stored millisecond precision and explicitly cast
    // the text parameter back to TIMESTAMP(3), so keyset comparison is independent of connection TZ.
    const value = new Date(cursor.sortValue).toISOString().replace(/Z$/, '');
    const timestamp = Prisma.sql`CAST(${value} AS TIMESTAMP(3))`;
    return Prisma.sql`AND (
      m."lastVisitAt" < ${timestamp}
      OR m."lastVisitAt" IS NULL
      OR (m."lastVisitAt" = ${timestamp} AND m."customerId" > ${cursor.customerId})
    )`;
  }
  const value = BigInt(cursor.sortValue!);
  const expression = sortExpression(sort);
  return Prisma.sql`AND (${expression} < ${value} OR (${expression} = ${value} AND m."customerId" > ${cursor.customerId}))`;
}

function directoryOrderBy(
  sort: OwnerCustomerDirectoryQuery['sort'],
): Prisma.Sql {
  if (sort === 'totalSpent') {
    return Prisma.sql`ORDER BY m."netSpentPaise" DESC, m."customerId" ASC`;
  }
  if (sort === 'visits') {
    return Prisma.sql`ORDER BY ${sortExpression(sort)} DESC, m."customerId" ASC`;
  }
  return Prisma.sql`ORDER BY m."lastVisitAt" DESC NULLS LAST, m."customerId" ASC`;
}

function directorySearchClause(
  salonId: string,
  query: OwnerCustomerDirectoryQuery,
): Prisma.Sql {
  const text = query.q?.trim();
  if (!text) return Prisma.empty;
  const digits = text.replace(/\D/g, '');
  const digitSearch = digits
    ? Prisma.sql`OR POSITION(${digits} IN REGEXP_REPLACE(COALESCE(m."phone", ''), '[^0-9]', '', 'g')) > 0`
    : Prisma.empty;
  return Prisma.sql`
    AND (
      POSITION(LOWER(${text}) IN LOWER(m."customerId")) > 0
      OR POSITION(LOWER(${text}) IN LOWER(COALESCE(m."email", ''))) > 0
      OR POSITION(LOWER(${text}) IN LOWER(COALESCE(m."phone", ''))) > 0
      ${digitSearch}
      OR EXISTS (
        SELECT 1 FROM "bookings" sb
        WHERE sb."salonId" = ${salonId} AND sb."customerId" = m."customerId"
          AND (
            POSITION(LOWER(${text}) IN LOWER(COALESCE(sb."guestName", ''))) > 0
            OR POSITION(LOWER(${text}) IN LOWER(COALESCE(sb."guestPhone", ''))) > 0
            ${digits ? Prisma.sql`OR POSITION(${digits} IN REGEXP_REPLACE(COALESCE(sb."guestPhone", ''), '[^0-9]', '', 'g')) > 0` : Prisma.empty}
          )
      )
      OR EXISTS (
        SELECT 1 FROM "queue_entries" sq
        WHERE sq."salonId" = ${salonId} AND sq."customerId" = m."customerId"
          AND sq."bookingId" IS NULL
          AND (
            POSITION(LOWER(${text}) IN LOWER(COALESCE(sq."contactName", ''))) > 0
            OR POSITION(LOWER(${text}) IN LOWER(COALESCE(sq."contactPhone", ''))) > 0
            ${digits ? Prisma.sql`OR POSITION(${digits} IN REGEXP_REPLACE(COALESCE(sq."contactPhone", ''), '[^0-9]', '', 'g')) > 0` : Prisma.empty}
          )
      )
      OR EXISTS (
        SELECT 1 FROM "booking_services" sbs
        INNER JOIN "bookings" sbb ON sbb."id" = sbs."bookingId"
        WHERE sbb."salonId" = ${salonId} AND sbb."customerId" = m."customerId"
          AND POSITION(LOWER(${text}) IN LOWER(sbs."serviceName")) > 0
      )
      OR EXISTS (
        SELECT 1 FROM "queue_entries" qs
        INNER JOIN "services" qservice ON qservice."id" = qs."serviceId"
        WHERE qs."salonId" = ${salonId} AND qs."customerId" = m."customerId"
          AND qs."bookingId" IS NULL
          AND POSITION(LOWER(${text}) IN LOWER(qservice."name")) > 0
      )
    )
  `;
}

@Injectable()
export class CustomerDirectoryQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async directory(
    actorId: string,
    salonId: string,
    query: OwnerCustomerDirectoryQuery,
  ): Promise<OwnerCustomerDirectoryPageDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(actorId, salonId);
    const cursor = decodeCustomerDirectoryCursor(
      query.cursor,
      actorId,
      salonId,
      query,
    );
    if (query.cursor && !cursor) throw invalidCustomerCursor();

    const segmentClause = query.segment
      ? Prisma.sql`AND m."segment" = ${query.segment}`
      : Prisma.empty;
    const minimumVisitsClause = Prisma.sql`AND ${countCompletedExpression()} >= ${query.minVisits}`;
    const searchClause = directorySearchClause(salonId, query);
    const afterClause = directoryCursorClause(cursor, query.sort);
    const orderBy = directoryOrderBy(query.sort);
    const limit = query.limit;
    const [rows, salon] = await Promise.all([
      this.prisma.$queryRaw<DirectoryRow[]>(Prisma.sql`
        ${directoryMetrics(salonId)}
        SELECT m.*
        FROM metrics m
        WHERE TRUE
          ${searchClause}
          ${segmentClause}
          ${minimumVisitsClause}
          ${afterClause}
        ${orderBy}
        LIMIT ${limit + 1}
      `),
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { currency: true },
      }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items: OwnerCustomerDirectoryItemDto[] = page.map((row) => {
      const totalBookings = asCount(row.totalBookings);
      const completedCount = asCount(row.completedBookings);
      const completedLiveQueueVisitCount = asCount(row.completedQueueVisits);
      const completedVisitCount = completedCount + completedLiveQueueVisitCount;
      const totalVisitCount = totalBookings + asCount(row.totalQueueVisits);
      return {
        customerId: row.customerId,
        displayName: row.displayName ?? null,
        displayNameSource: row.displayName
          ? (row.displayNameSource ?? 'CONTACT_NAME_ON_VISIT')
          : 'NOT_ON_FILE',
        phone: row.phone,
        email: row.email,
        currency: salon?.currency ?? null,
        totalBookings,
        completedCount,
        cancelledCount: asCount(row.cancelledBookings),
        noShowCount: asCount(row.noShowBookings),
        firstVisitAt: row.firstCompletedAt?.toISOString() ?? null,
        lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
        totalVisitCount,
        completedVisitCount,
        repeatVisitCount: Math.max(completedVisitCount - 1, 0),
        liveQueueVisitCount: asCount(row.totalQueueVisits),
        completedLiveQueueVisitCount,
        cancelledLiveQueueVisitCount: asCount(row.cancelledQueueVisits),
        expiredLiveQueueVisitCount: asCount(row.expiredQueueVisits),
        noShowLiveQueueVisitCount: asCount(row.noShowQueueVisits),
        recordedCollections: amountFromPaise(row.collectedPaise),
        recordedRefunds: amountFromPaise(row.refundedPaise),
        totalSpent: amountFromPaise(row.netSpentPaise),
        segment: row.segment,
      };
    });
    const last = page[page.length - 1];
    const lastRow = rows[page.length - 1];
    const sortValue = lastRow
      ? query.sort === 'lastVisit'
        ? (lastRow.lastVisitAt?.toISOString() ?? null)
        : query.sort === 'totalSpent'
          ? BigInt(lastRow.netSpentPaise).toString()
          : String(
              asCount(lastRow.completedBookings) +
                asCount(lastRow.completedQueueVisits),
            )
      : null;

    return {
      salonId,
      currency: salon?.currency ?? null,
      items,
      nextCursor:
        hasMore && last
          ? encodeCustomerDirectoryCursor(
              actorId,
              salonId,
              query,
              sortValue,
              last.customerId,
            )
          : null,
    };
  }

  async services(
    actorId: string,
    salonId: string,
    customerId: string,
    query: OwnerCustomerServicesQuery,
  ): Promise<OwnerCustomerServiceHistoryPageDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(actorId, salonId);
    const cursor = decodeCustomerServicesCursor(
      query.cursor,
      actorId,
      salonId,
      customerId,
    );
    if (query.cursor && !cursor) throw invalidCustomerCursor();
    const afterClause = cursor
      ? Prisma.sql`WHERE (
          r."eventAt" < ${new Date(cursor.completedAt)}
          OR (r."eventAt" = ${new Date(cursor.completedAt)} AND r."sourceRank" > ${cursor.sourceRank})
          OR (r."eventAt" = ${new Date(cursor.completedAt)} AND r."sourceRank" = ${cursor.sourceRank} AND r."visitId" > ${cursor.visitId})
          OR (r."eventAt" = ${new Date(cursor.completedAt)} AND r."sourceRank" = ${cursor.sourceRank} AND r."visitId" = ${cursor.visitId} AND r."serviceOrder" > ${cursor.serviceOrder})
          OR (r."eventAt" = ${new Date(cursor.completedAt)} AND r."sourceRank" = ${cursor.sourceRank} AND r."visitId" = ${cursor.visitId} AND r."serviceOrder" = ${cursor.serviceOrder} AND r."serviceId" > ${cursor.serviceId})
        )`
      : Prisma.empty;
    const limit = query.limit;
    const rows = await this.prisma.$queryRaw<CustomerServiceRow[]>(Prisma.sql`
      WITH service_rows AS (
        SELECT
          b."id" AS "visitId",
          b."id" AS "bookingId",
          CASE WHEN b."source" = 'IN_SHOP' THEN 'IN_SHOP_APPOINTMENT' ELSE 'ONLINE_BOOKING' END AS "source",
          CASE WHEN b."source" = 'IN_SHOP' THEN 1 ELSE 0 END::int AS "sourceRank",
          COALESCE(bs."serviceId", b."serviceId") AS "serviceId",
          COALESCE(bs."serviceName", svc."name") AS "serviceName",
          performer."staffName",
          COALESCE(completion."completedAt", b."slotStart") AS "eventAt",
          completion."completedAt",
          COALESCE(bs."sortOrder", 0)::int AS "serviceOrder",
          invoice_line."amount" AS "invoicedAmount"
        FROM "bookings" b
        LEFT JOIN "booking_services" bs ON bs."bookingId" = b."id"
        INNER JOIN "services" svc ON svc."id" = COALESCE(bs."serviceId", b."serviceId")
        LEFT JOIN LATERAL (
          SELECT ss."endedAt" AS "completedAt"
          FROM "queue_entries" qe
          INNER JOIN "service_sessions" ss ON ss."queueEntryId" = qe."id" AND ss."status" = 'COMPLETED'
          WHERE qe."salonId" = b."salonId" AND qe."bookingId" = b."id"
            AND ss."serviceId" = COALESCE(bs."serviceId", b."serviceId")
          ORDER BY ss."endedAt" DESC NULLS LAST, ss."id" ASC
          LIMIT 1
        ) completion ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(completed_staff."displayName", assigned_staff."displayName") AS "staffName"
          FROM "queue_entries" qe
          LEFT JOIN LATERAL (
            SELECT ss."staffId"
            FROM "service_sessions" ss
            WHERE ss."queueEntryId" = qe."id" AND ss."status" = 'COMPLETED'
            ORDER BY ss."endedAt" DESC NULLS LAST, ss."id" ASC
            LIMIT 1
          ) completed_session ON TRUE
          LEFT JOIN "salon_staff" completed_staff
            ON completed_staff."id" = completed_session."staffId" AND completed_staff."salonId" = b."salonId"
          LEFT JOIN "salon_staff" assigned_staff
            ON assigned_staff."id" = qe."assignedStaffId" AND assigned_staff."salonId" = b."salonId"
          WHERE qe."salonId" = b."salonId" AND qe."bookingId" = b."id"
          ORDER BY (completed_session."staffId" IS NOT NULL) DESC, qe."id" ASC
          LIMIT 1
        ) performer ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE WHEN COUNT(DISTINCT i."id") = 1 THEN SUM(il."lineTotal")::text ELSE NULL END AS "amount"
          FROM "invoices" i
          INNER JOIN "invoice_lines" il ON il."invoiceId" = i."id"
          WHERE i."salonId" = b."salonId" AND i."bookingId" = b."id"
            AND i."status" = 'ISSUED' AND il."serviceId" = COALESCE(bs."serviceId", b."serviceId")
        ) invoice_line ON TRUE
        WHERE b."salonId" = ${salonId}
          AND b."customerId" = ${customerId}
          AND b."status" = 'COMPLETED'

        UNION ALL

        SELECT
          q."id" AS "visitId",
          NULL::text AS "bookingId",
          'LIVE_QUEUE'::text AS "source",
          2::int AS "sourceRank",
          completed_service."serviceId",
          completed_service."serviceName",
          completed_service."staffName",
          COALESCE(q."serviceCompletedAt", completed_service."endedAt", q."joinedAt") AS "eventAt",
          COALESCE(q."serviceCompletedAt", completed_service."endedAt") AS "completedAt",
          completed_service."serviceOrder",
          invoice_line."amount" AS "invoicedAmount"
        FROM "queue_entries" q
        INNER JOIN LATERAL (
          SELECT
            ss."serviceId",
            svc."name" AS "serviceName",
            staff."displayName" AS "staffName",
            ss."startedAt",
            ss."endedAt",
            (ROW_NUMBER() OVER (ORDER BY ss."startedAt" ASC, ss."id" ASC) - 1)::int AS "serviceOrder",
            COUNT(*) OVER (PARTITION BY ss."serviceId")::int AS "matchingSessionCount"
          FROM "service_sessions" ss
          INNER JOIN "services" svc ON svc."id" = ss."serviceId"
          INNER JOIN "salon_staff" staff ON staff."id" = ss."staffId" AND staff."salonId" = q."salonId"
          WHERE ss."queueEntryId" = q."id" AND ss."status" = 'COMPLETED'
          UNION ALL
          SELECT
            q."serviceId",
            fallback_service."name",
            assigned_staff."displayName",
            q."serviceStartedAt",
            q."serviceCompletedAt",
            0::int,
            1::int
          FROM "services" fallback_service
          LEFT JOIN "salon_staff" assigned_staff
            ON assigned_staff."id" = q."assignedStaffId" AND assigned_staff."salonId" = q."salonId"
          WHERE fallback_service."id" = q."serviceId"
            AND NOT EXISTS (
              SELECT 1 FROM "service_sessions" old_ss
              WHERE old_ss."queueEntryId" = q."id" AND old_ss."status" = 'COMPLETED'
            )
        ) completed_service ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN completed_service."matchingSessionCount" = 1 AND COUNT(DISTINCT i."id") = 1
              THEN SUM(il."lineTotal")::text
            ELSE NULL
          END AS "amount"
          FROM "invoices" i
          INNER JOIN "invoice_lines" il ON il."invoiceId" = i."id"
          WHERE i."salonId" = q."salonId" AND i."queueEntryId" = q."id"
            AND i."status" = 'ISSUED' AND il."serviceId" = completed_service."serviceId"
        ) invoice_line ON TRUE
        WHERE q."salonId" = ${salonId}
          AND q."customerId" = ${customerId}
          AND q."bookingId" IS NULL
          AND q."status" = 'COMPLETED'
      )
      SELECT r.*
      FROM service_rows r
      ${afterClause}
      ORDER BY r."eventAt" DESC, r."sourceRank" ASC, r."visitId" ASC, r."serviceOrder" ASC, r."serviceId" ASC
      LIMIT ${limit + 1}
    `);

    if (rows.length === 0 && !query.cursor) {
      const [bookingCount, queueCount] = await Promise.all([
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
    }

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { currency: true },
    });
    const items: OwnerCustomerServiceHistoryItemDto[] = page.map((row) => ({
      id: `${row.source}:${row.visitId}:${row.serviceOrder}:${row.serviceId}`,
      visitId: row.visitId,
      bookingId: row.bookingId,
      source: row.source,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      staffName: row.staffName,
      date: row.eventAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      amount: nullableAmount(row.invoicedAmount),
      amountKind: row.invoicedAmount === null ? null : 'INVOICED',
      currency: row.invoicedAmount === null ? null : (salon?.currency ?? null),
    }));
    const lastRow = page[page.length - 1];
    return {
      salonId,
      customerId,
      items,
      nextCursor:
        hasMore && lastRow
          ? encodeCustomerServicesCursor({
              actorId,
              salonId,
              customerId,
              completedAt: lastRow.eventAt.toISOString(),
              sourceRank: lastRow.sourceRank as 0 | 1 | 2,
              visitId: lastRow.visitId,
              serviceOrder: lastRow.serviceOrder,
              serviceId: lastRow.serviceId,
            })
          : null,
    };
  }
}
