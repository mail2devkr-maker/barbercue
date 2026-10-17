import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BOOKING_ATTRIBUTION_SOURCES,
  BookingAttributionSource,
  BookingSource,
  BookingErrorCode,
  OwnerOpsErrorCode,
  type BookingAttributionCampaignDto,
  type BookingAttributionSummaryDto,
  type BookingAttributionSummaryQuery,
  type BookingAttributionCampaignListQuery,
  type CreateBookingAttributionCampaignDto,
  type CreateBookingAttributionCampaignInput,
  type PaginatedResult,
} from '@barbercue/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import {
  addZonedCalendarDays,
  resolveSalonTimeZone,
} from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { localRange } from './local-time';

const MAX_CAMPAIGN_PAGE_SIZE = 100;
const DEFAULT_CAMPAIGN_PAGE_SIZE = 25;

const SOURCE_BY_BOOKING_SOURCE: Record<string, BookingAttributionSource> = {
  [BookingSource.WEB]: BookingAttributionSource.FASTQUE_WEB,
  [BookingSource.APP]: BookingAttributionSource.FASTQUE_APP,
  [BookingSource.WALK_IN]: BookingAttributionSource.WALK_IN,
  [BookingSource.IN_SHOP]: BookingAttributionSource.IN_SHOP,
};

type CampaignRow = Prisma.BookingAttributionCampaignGetPayload<{
  include: { _count: { select: { bookings: true } } };
}>;

@Injectable()
export class BookingAttributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async createCampaign(
    actorUserId: string,
    salonId: string,
    input: CreateBookingAttributionCampaignInput,
  ): Promise<CreateBookingAttributionCampaignDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(actorUserId, salonId);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);

    const row = await this.prisma.$transaction(async (tx) => {
      const campaign = await tx.bookingAttributionCampaign.create({
        data: {
          salonId,
          source: input.source,
          label: input.label,
          tokenHash,
          createdByUserId: actorUserId,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
        },
        include: { _count: { select: { bookings: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'BOOKING_ATTRIBUTION_CAMPAIGN_CREATED',
          entityType: 'BookingAttributionCampaign',
          entityId: campaign.id,
          metadata: { salonId, source: input.source, label: input.label },
        },
      });
      return campaign;
    });

    return { ...this.toCampaignDto(row), token };
  }

  async listCampaigns(
    actorUserId: string,
    salonId: string,
    query: BookingAttributionCampaignListQuery,
  ): Promise<PaginatedResult<BookingAttributionCampaignDto>> {
    await this.salonAccess.assertOwnerOrAdminAccess(actorUserId, salonId);
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_CAMPAIGN_PAGE_SIZE, 1),
      MAX_CAMPAIGN_PAGE_SIZE,
    );
    const rows = await this.prisma.bookingAttributionCampaign.findMany({
      where: { salonId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { _count: { select: { bookings: true } } },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => this.toCampaignDto(row)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async revokeCampaign(
    actorUserId: string,
    salonId: string,
    campaignId: string,
  ): Promise<BookingAttributionCampaignDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(actorUserId, salonId);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "booking_attribution_campaigns" WHERE "id" = ${campaignId} AND "salonId" = ${salonId} FOR UPDATE`,
      );
      if (!locked.length) this.throwCampaignNotFound();

      const current = await tx.bookingAttributionCampaign.findFirst({
        where: { id: campaignId, salonId },
        include: { _count: { select: { bookings: true } } },
      });
      if (!current) this.throwCampaignNotFound();
      if (!current.revokedAt) {
        const revokedAt = new Date();
        const updated = await tx.bookingAttributionCampaign.update({
          where: { id: campaignId },
          data: { revokedAt },
          include: { _count: { select: { bookings: true } } },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'BOOKING_ATTRIBUTION_CAMPAIGN_REVOKED',
            entityType: 'BookingAttributionCampaign',
            entityId: campaignId,
            metadata: { salonId, source: current.source, label: current.label },
          },
        });
        return this.toCampaignDto(updated);
      }
      return this.toCampaignDto(current);
    });
  }

  async summarize(
    actorUserId: string,
    salonId: string,
    query: BookingAttributionSummaryQuery,
  ): Promise<BookingAttributionSummaryDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(actorUserId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        timezone: true,
        city: { select: { countryCode: true } },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const timezone = resolveSalonTimeZone({
      timezone: salon.timezone,
      countryCode: salon.city.countryCode,
    });
    if (!timezone) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Set your shop’s timezone before viewing attribution.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const range = localRange(
      query.from,
      addZonedCalendarDays(query.to, 1),
      timezone,
    );
    if (!range) {
      throw new AppException(
        BookingErrorCode.SALON_TIMEZONE_REQUIRED,
        'Could not resolve the attribution dates in this shop’s timezone.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        bookingSource: string;
        campaignId: string | null;
        campaignSource: string | null;
        campaignLabel: string | null;
        bookingCount: number;
      }>
    >(Prisma.sql`
      SELECT b."source"::text AS "bookingSource",
             c."id" AS "campaignId",
             c."source"::text AS "campaignSource",
             c."label" AS "campaignLabel",
             COUNT(*)::int AS "bookingCount"
      FROM "bookings" b
      LEFT JOIN "booking_attribution_campaigns" c
        ON c."id" = b."attributionCampaignId" AND c."salonId" = b."salonId"
      WHERE b."salonId" = ${salonId}
        AND b."createdAt" >= ${range.start}
        AND b."createdAt" < ${range.end}
      GROUP BY b."source", c."id", c."source", c."label"
    `);

    const sourceCounts = new Map<BookingAttributionSource, number>(
      BOOKING_ATTRIBUTION_SOURCES.map((source) => [source, 0]),
    );
    const campaignCounts: BookingAttributionSummaryDto['campaigns'] = [];
    for (const row of rows) {
      const source = row.campaignSource
        ? (row.campaignSource as BookingAttributionSource)
        : (SOURCE_BY_BOOKING_SOURCE[row.bookingSource] ??
          BookingAttributionSource.UNKNOWN);
      const count = Number(row.bookingCount);
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + count);
      if (row.campaignId && row.campaignLabel && row.campaignSource) {
        campaignCounts.push({
          campaignId: row.campaignId,
          source: row.campaignSource as BookingAttributionCampaignDto['source'],
          label: row.campaignLabel,
          bookingCount: count,
        });
      }
    }
    const bySource = BOOKING_ATTRIBUTION_SOURCES.filter(
      (source) => !query.source || source === query.source,
    ).map((source) => ({
      source,
      bookingCount: sourceCounts.get(source) ?? 0,
    }));
    const campaigns = campaignCounts
      .filter((campaign) => !query.source || campaign.source === query.source)
      .sort(
        (a, b) =>
          a.source.localeCompare(b.source) ||
          a.label.localeCompare(b.label) ||
          a.campaignId.localeCompare(b.campaignId),
      );
    return {
      salonId,
      from: query.from,
      to: query.to,
      timezone,
      asOf: new Date().toISOString(),
      bySource,
      campaigns,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private toCampaignDto(row: CampaignRow): BookingAttributionCampaignDto {
    return {
      id: row.id,
      salonId: row.salonId,
      source: row.source,
      label: row.label,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      bookingCount: row._count.bookings,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private throwCampaignNotFound(): never {
    throw new AppException(
      OwnerOpsErrorCode.BOOKING_ATTRIBUTION_CAMPAIGN_NOT_FOUND,
      'Campaign not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
