import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type AdminListingQuery,
  type AdminListingReviewInput,
  type AdminShopListingDto,
  type AdminShopStatsDto,
  type InventoryPageDto,
  type OwnerListingDto,
  type OwnerListingStatusInput,
  type OwnerListingUpsertInput,
  type OwnerSellableProductDto,
  type ShopAnalyticsDto,
  type ShopAnalyticsQuery,
  type ShopListingStatus,
  type ShopOrderStatus,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SELLABLE_UNITS,
  availableUnits,
  commissionPercent,
  reservedUnits,
} from './shop-stock';

const listingInclude = {
  inventoryProduct: { select: { id: true, name: true, stockOnHand: true } },
  globalProduct: {
    select: {
      id: true,
      isTestData: true,
      barcodes: { select: { display: true }, take: 1 },
    },
  },
  salon: { select: { id: true, name: true } },
} satisfies Prisma.ShopListingInclude;
type ListingRow = Prisma.ShopListingGetPayload<{
  include: typeof listingInclude;
}>;

function toListingDto(
  l: ListingRow,
  reserved: Map<string, number>,
): AdminShopListingDto {
  return {
    id: l.id,
    inventoryProductId: l.inventoryProductId,
    productName: l.inventoryProduct.name,
    price: l.price.toFixed(2),
    compareAtPrice: l.compareAtPrice?.toFixed(2) ?? null,
    maxPerOrder: l.maxPerOrder,
    pickupEnabled: l.pickupEnabled,
    status: l.status,
    reviewNote: l.reviewNote,
    availableQuantity: availableUnits(
      l.inventoryProduct.stockOnHand,
      reserved.get(l.inventoryProductId) ?? 0,
    ),
    updatedAt: l.updatedAt.toISOString(),
    salon: l.salon,
    globalProductId: l.globalProductId,
    barcode: l.globalProduct.barcodes[0]?.display ?? null,
    isTestData: l.globalProduct.isTestData,
    stockOnHand: l.inventoryProduct.stockOnHand.toFixed(3),
  };
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;
const ZERO_STATUSES = (): Record<ShopOrderStatus, number> => ({
  PLACED: 0,
  ACCEPTED: 0,
  PREPARING: 0,
  READY_FOR_PICKUP: 0,
  COMPLETED: 0,
  CANCELLED: 0,
  EXPIRED: 0,
});

/**
 * "Sell on FastQue": a salon lists products from ITS OWN inventory (catalog-linked, counted in whole
 * units). New listings wait for FastQue approval; the salon sets price, offer price and per-order
 * limit, and can pause. The salon is always the URL's, verified against the caller's owner role.
 */
@Injectable()
export class ShopSellerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async sellable(
    userId: string,
    salonId: string,
  ): Promise<OwnerSellableProductDto[]> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const rows = await this.prisma.inventoryProduct.findMany({
      where: { salonId, isActive: true },
      include: {
        shopListing: { include: listingInclude },
        globalProduct: {
          select: { barcodes: { select: { display: true }, take: 1 } },
        },
      },
      orderBy: { normalizedName: 'asc' },
      take: 500,
    });
    const reserved = await reservedUnits(
      this.prisma,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      inventoryProductId: r.id,
      name: r.name,
      globalProductId: r.globalProductId,
      barcode: r.globalProduct?.barcodes[0]?.display ?? null,
      usage: r.usage,
      stockOnHand: r.stockOnHand.toFixed(3),
      reserved: reserved.get(r.id) ?? 0,
      sellingPrice: r.sellingPrice?.toFixed(2) ?? null,
      listing: r.shopListing ? toListingDto(r.shopListing, reserved) : null,
    }));
  }

  async upsertListing(
    userId: string,
    salonId: string,
    input: OwnerListingUpsertInput,
  ): Promise<OwnerListingDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const product = await this.prisma.inventoryProduct.findFirst({
      where: { id: input.inventoryProductId, salonId },
      include: {
        globalProduct: {
          select: {
            id: true,
            verificationStatus: true,
            visibility: true,
            ownerSalonId: true,
          },
        },
        shopListing: true,
      },
    });
    if (!product || !product.isActive)
      throw new AppException(
        'SHOP_PRODUCT_NOT_FOUND',
        'That product is not in your active inventory.',
        HttpStatus.NOT_FOUND,
      );
    const gp = product.globalProduct;
    if (
      !gp ||
      gp.verificationStatus !== 'VERIFIED' ||
      (gp.visibility === 'SHOP' && gp.ownerSalonId !== salonId)
    )
      throw new AppException(
        'SHOP_PRODUCT_NOT_SELLABLE',
        'Only products linked to a verified FastQue catalog product can be sold. Link it from Scan / Add stock first.',
        HttpStatus.BAD_REQUEST,
      );
    if (!(SELLABLE_UNITS as readonly string[]).includes(product.unit))
      throw new AppException(
        'SHOP_PRODUCT_NOT_SELLABLE',
        'Only products counted in pieces, packs or boxes can be sold online.',
        HttpStatus.BAD_REQUEST,
      );
    const data = {
      price: input.price.toFixed(2),
      compareAtPrice: input.compareAtPrice?.toFixed(2) ?? null,
      maxPerOrder: input.maxPerOrder,
      pickupEnabled: input.pickupEnabled,
    };
    const listing = await this.prisma.$transaction(async (tx) => {
      const row = product.shopListing
        ? await tx.shopListing.update({
            where: { id: product.shopListing.id },
            // A rejected listing goes back for review when changed; an approved one stays live.
            data: {
              ...data,
              ...(product.shopListing.status === 'REJECTED'
                ? { status: 'PENDING_APPROVAL' as const, reviewNote: null }
                : {}),
            },
            include: listingInclude,
          })
        : await tx.shopListing.create({
            data: {
              ...data,
              salonId,
              inventoryProductId: product.id,
              globalProductId: gp.id,
              status: 'PENDING_APPROVAL',
            },
            include: listingInclude,
          });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: product.shopListing
            ? 'SHOP_LISTING_UPDATED'
            : 'SHOP_LISTING_CREATED',
          entityType: 'ShopListing',
          entityId: row.id,
          metadata: {
            salonId,
            price: data.price,
            compareAtPrice: data.compareAtPrice,
            previousPrice: product.shopListing?.price.toFixed(2) ?? null,
          },
        },
      });
      return row;
    });
    return toListingDto(
      listing,
      await reservedUnits(this.prisma, [listing.inventoryProductId]),
    );
  }

  async setListingStatus(
    userId: string,
    salonId: string,
    listingId: string,
    input: OwnerListingStatusInput,
  ): Promise<OwnerListingDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const l = await this.prisma.shopListing.findFirst({
      where: { id: listingId, salonId },
    });
    if (!l)
      throw new AppException(
        'SHOP_LISTING_NOT_FOUND',
        'Listing not found.',
        HttpStatus.NOT_FOUND,
      );
    const next: ShopListingStatus | null =
      input.action === 'PAUSE' && l.status === 'APPROVED'
        ? 'PAUSED'
        : input.action === 'RESUME' && l.status === 'PAUSED'
          ? l.reviewedAt
            ? 'APPROVED'
            : 'PENDING_APPROVAL'
          : input.action === 'SUBMIT' &&
              (l.status === 'DRAFT' || l.status === 'REJECTED')
            ? 'PENDING_APPROVAL'
            : null;
    if (!next)
      throw new AppException(
        'SHOP_LISTING_STATUS',
        'That change is not possible for this listing right now.',
        HttpStatus.CONFLICT,
      );
    const row = await this.prisma.shopListing.update({
      where: { id: l.id },
      data: { status: next },
      include: listingInclude,
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: `SHOP_LISTING_${input.action}`,
        entityType: 'ShopListing',
        entityId: l.id,
        metadata: { salonId },
      },
    });
    return toListingDto(
      row,
      await reservedUnits(this.prisma, [row.inventoryProductId]),
    );
  }

  async analytics(
    userId: string | null,
    salonId: string | null,
    query: ShopAnalyticsQuery,
  ): Promise<ShopAnalyticsDto> {
    if (userId && salonId)
      await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const to = new Date();
    const from = new Date(to.getTime() - PERIOD_DAYS[query.period] * 864e5);
    const salonFilter = salonId
      ? Prisma.sql`AND o."salonId" = ${salonId}`
      : Prisma.empty;
    const [statusRows, totals, best] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ status: ShopOrderStatus; n: bigint }>
      >(Prisma.sql`
        SELECT o."status", COUNT(*)::bigint AS "n" FROM "shop_orders" o
        WHERE o."placedAt" >= ${from} ${salonFilter} GROUP BY o."status"`),
      this.prisma.$queryRaw<
        Array<{
          gross: Prisma.Decimal | null;
          discounts: Prisma.Decimal | null;
          units: bigint | null;
          completed: bigint;
        }>
      >(Prisma.sql`
        SELECT SUM(o."total") AS "gross", SUM(o."discountTotal") AS "discounts", COUNT(*)::bigint AS "completed",
          (SELECT SUM(i."quantity") FROM "shop_order_items" i JOIN "shop_orders" o2 ON o2."id" = i."orderId"
            WHERE o2."status" = 'COMPLETED' AND o2."completedAt" >= ${from} ${salonId ? Prisma.sql`AND o2."salonId" = ${salonId}` : Prisma.empty})::bigint AS "units"
        FROM "shop_orders" o WHERE o."status" = 'COMPLETED' AND o."completedAt" >= ${from} ${salonFilter}`),
      this.prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          units: bigint;
          revenue: Prisma.Decimal;
        }>
      >(Prisma.sql`
        SELECT i."globalProductId" AS "id", MAX(i."productName") AS "name", SUM(i."quantity")::bigint AS "units", SUM(i."lineTotal") AS "revenue"
        FROM "shop_order_items" i JOIN "shop_orders" o ON o."id" = i."orderId"
        WHERE o."status" = 'COMPLETED' AND o."completedAt" >= ${from} ${salonFilter}
        GROUP BY i."globalProductId" ORDER BY "units" DESC, "revenue" DESC LIMIT 5`),
    ]);
    const byStatus = ZERO_STATUSES();
    for (const r of statusRows) byStatus[r.status] = Number(r.n);
    const t = totals[0];
    const gross = new Prisma.Decimal(t?.gross ?? 0);
    const completed = Number(t?.completed ?? 0);
    const pct = commissionPercent();
    const commission = gross.times(pct).dividedBy(100).toDecimalPlaces(2);
    const refunds = new Prisma.Decimal(0); // pay-at-salon orders are never charged online, so nothing is refunded online
    return {
      period: query.period,
      from: from.toISOString(),
      to: to.toISOString(),
      orders: Object.values(byStatus).reduce((a, b) => a + b, 0),
      completedOrders: completed,
      cancelledOrders: byStatus.CANCELLED + byStatus.EXPIRED,
      unitsSold: Number(t?.units ?? 0),
      grossSales: gross.toFixed(2),
      discounts: new Prisma.Decimal(t?.discounts ?? 0).toFixed(2),
      commissionPercent: pct.toFixed(2),
      commission: commission.toFixed(2),
      refunds: refunds.toFixed(2),
      netProceeds: gross.minus(commission).minus(refunds).toFixed(2),
      averageOrderValue: completed
        ? gross.dividedBy(completed).toFixed(2)
        : '0.00',
      bestSellers: best.map((b) => ({
        productId: b.id,
        name: b.name,
        units: Number(b.units),
        revenue: new Prisma.Decimal(b.revenue).toFixed(2),
      })),
      byStatus,
    };
  }

  // ---------- Admin ----------

  async adminListings(
    query: AdminListingQuery,
  ): Promise<InventoryPageDto<AdminShopListingDto>> {
    const rows = await this.prisma.shopListing.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: listingInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const reserved = await reservedUnits(
      this.prisma,
      page.map((r) => r.inventoryProductId),
    );
    return {
      items: page.map((r) => toListingDto(r, reserved)),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      hasMore: rows.length > query.limit,
    };
  }

  async reviewListing(
    adminUserId: string,
    listingId: string,
    input: AdminListingReviewInput,
  ): Promise<AdminShopListingDto> {
    const l = await this.prisma.shopListing.findUnique({
      where: { id: listingId },
    });
    if (!l)
      throw new AppException(
        'SHOP_LISTING_NOT_FOUND',
        'Listing not found.',
        HttpStatus.NOT_FOUND,
      );
    const next: ShopListingStatus =
      input.action === 'APPROVE'
        ? 'APPROVED'
        : input.action === 'REJECT'
          ? 'REJECTED'
          : 'PAUSED';
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.shopListing.update({
        where: { id: l.id },
        data: {
          status: next,
          reviewNote: input.note ?? null,
          reviewedAt: new Date(),
          reviewedByUserId: adminUserId,
        },
        include: listingInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: `SHOP_LISTING_${input.action}D`,
          entityType: 'ShopListing',
          entityId: l.id,
          metadata: { from: l.status, to: next, note: input.note ?? null },
        },
      });
      return updated;
    });
    return toListingDto(
      row,
      await reservedUnits(this.prisma, [row.inventoryProductId]),
    );
  }

  async adminStats(): Promise<AdminShopStatsDto> {
    const [listings, orders, gross, sellers, lowStock] = await Promise.all([
      this.prisma.shopListing.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.shopOrder.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.shopOrder.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.shopListing.findMany({
        where: { status: 'APPROVED' },
        distinct: ['salonId'],
        select: { salonId: true },
      }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "n" FROM "shop_listings" l JOIN "inventory_products" p ON p."id" = l."inventoryProductId"
        WHERE l."status" = 'APPROVED' AND p."stockOnHand" <= GREATEST(p."reorderThreshold", 2)`),
    ]);
    const listingCounts: Record<ShopListingStatus, number> = {
      DRAFT: 0,
      PENDING_APPROVAL: 0,
      APPROVED: 0,
      REJECTED: 0,
      PAUSED: 0,
    };
    for (const l of listings) listingCounts[l.status] = l._count._all;
    const orderCounts = ZERO_STATUSES();
    for (const o of orders) orderCounts[o.status] = o._count._all;
    return {
      listings: listingCounts,
      sellingSalons: sellers.length,
      orders: orderCounts,
      grossSales: new Prisma.Decimal(gross._sum.total ?? 0).toFixed(2),
      completedOrders: gross._count._all,
      commissionPercent: commissionPercent().toFixed(2),
      lowStockListings: Number(lowStock[0]?.n ?? 0),
    };
  }
}
