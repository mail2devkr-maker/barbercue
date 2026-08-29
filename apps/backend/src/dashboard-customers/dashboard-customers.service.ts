import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  BookingStatus,
  QueueEntryStatus,
  type CustomerSegment,
  type OwnerCustomerSummaryDto,
  type PaginatedResult,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

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
  ): Promise<PaginatedResult<OwnerCustomerSummaryDto>> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const offset = this.resolveOffset(offsetRaw);
    const limit = this.resolveLimit(limitRaw);

    // Ordered by most-recently-active first — the ordering a "customer history" list is actually
    // useful in. groupBy has no natural row id to cursor over (these are aggregated rows, not
    // model rows), so this endpoint uses plain offset paging instead of the cursor convention the
    // rest of the dashboard API uses — the response shape (nextCursor) stays identical, it's just
    // the next offset encoded as a string, so clients page through it exactly the same way.
    const page = await this.prisma.booking.groupBy({
      by: ['customerId'],
      where: { salonId },
      _max: { slotStart: true },
      orderBy: { _max: { slotStart: 'desc' } },
      skip: offset,
      take: limit + 1,
    });
    const hasMore = page.length > limit;
    const rows = hasMore ? page.slice(0, limit) : page;
    const customerIds = rows.map((r) => r.customerId);
    if (customerIds.length === 0) return { items: [], nextCursor: null };

    const summaries = await this.buildSummaries(salonId, customerIds);
    const byId = new Map(summaries.map((s) => [s.customerId, s]));
    const items = rows
      .map((r) => byId.get(r.customerId))
      .filter((s): s is OwnerCustomerSummaryDto => s !== undefined);

    return {
      items,
      nextCursor: hasMore ? String(offset + limit) : null,
    };
  }

  async getOne(
    userId: string,
    salonId: string,
    customerId: string,
  ): Promise<OwnerCustomerSummaryDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
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

  private async buildSummaries(
    salonId: string,
    customerIds: string[],
  ): Promise<OwnerCustomerSummaryDto[]> {
    const [
      users,
      totalGrouped,
      completedGrouped,
      cancelledGrouped,
      noShowGrouped,
      serviceGrouped,
      staffGrouped,
    ] = await Promise.all([
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
      this.prisma.booking.groupBy({
        by: ['customerId', 'serviceId'],
        where: {
          salonId,
          customerId: { in: customerIds },
          status: BookingStatus.COMPLETED,
        },
        _count: { _all: true },
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
      });
    }
    for (const row of totalGrouped) {
      const agg = aggregates.get(row.customerId);
      if (agg) agg.total = row._count._all;
    }
    for (const row of completedGrouped) {
      const agg = aggregates.get(row.customerId);
      if (agg) {
        agg.completed = row._count._all;
        agg.firstVisitAt = row._min.slotStart;
        agg.lastVisitAt = row._max.slotStart;
      }
    }
    for (const row of cancelledGrouped) {
      const agg = aggregates.get(row.customerId);
      if (agg) agg.cancelled = row._count._all;
    }
    for (const row of noShowGrouped) {
      const agg = aggregates.get(row.customerId);
      if (agg) agg.noShow = row._count._all;
    }

    const serviceCounts = new Map<string, Map<string, number>>();
    for (const row of serviceGrouped) {
      if (!row.serviceId) continue;
      const byService =
        serviceCounts.get(row.customerId) ?? new Map<string, number>();
      byService.set(row.serviceId, row._count._all);
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

    return customerIds
      .map((customerId) => {
        const agg = aggregates.get(customerId)!;
        // Skip a customerId that has no bookings at this salon at all — getOne() can be called
        // with an arbitrary id, and this must fail closed (BOOKING_NOT_FOUND), not return zeros.
        if (agg.total === 0) return null;
        const user = userById.get(customerId);
        const dto: OwnerCustomerSummaryDto = {
          customerId,
          phone: user?.phone ?? null,
          email: user?.email ?? null,
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
        };
        return dto;
      })
      .filter((dto): dto is OwnerCustomerSummaryDto => dto !== null);
  }
}
