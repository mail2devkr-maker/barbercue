import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CatalogErrorCode,
  normalizeBarcode,
  symbologyOf,
  transactionTypeOfKind,
  type CatalogChangeRequestDto,
  type CatalogChangeRequestInput,
  type CatalogChangeRequestListQuery,
  type InventoryPageDto,
  type InventoryProductDto,
  type OwnerAddCatalogProductInput,
  type OwnerCatalogBrowseQuery,
  type OwnerCatalogProductDto,
  type OwnerInventorySummaryDto,
  type ResolveCatalogChangeRequestInput,
} from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { SalonAccessService } from '../../common/salon-access/salon-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory.service';
import { normalizeProductName } from '../product-catalog.service';

/**
 * Which master products a salon may see and stock: verified GLOBAL products, plus SHOP products
 * that belong to this salon. The salon always comes from the URL and is checked against the
 * caller's own owner role (SalonAccessService) — a shop id in a request body is never trusted.
 */
export function catalogVisibleTo(
  salonId: string,
): Prisma.GlobalProductWhereInput {
  return {
    verificationStatus: 'VERIFIED',
    OR: [
      { visibility: 'GLOBAL' },
      { visibility: 'SHOP', ownerSalonId: salonId },
    ],
  };
}

const changeRequestInclude = {
  salon: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, email: true } },
  globalProduct: {
    select: {
      id: true,
      name: true,
      barcodes: { select: { display: true }, take: 1 },
    },
  },
} as const;

function toChangeRequestDto(
  r: Prisma.CatalogChangeRequestGetPayload<{
    include: typeof changeRequestInclude;
  }>,
): CatalogChangeRequestDto {
  return {
    id: r.id,
    salon: r.salon,
    requestedBy: { id: r.requestedBy.id, name: r.requestedBy.email },
    product: r.globalProduct
      ? {
          id: r.globalProduct.id,
          name: r.globalProduct.name,
          barcode: r.globalProduct.barcodes[0]?.display ?? null,
        }
      : null,
    barcode: r.barcode,
    message: r.message,
    proposedFields: (r.proposedFields as Record<string, string> | null) ?? null,
    status: r.status,
    resolutionNote: r.resolutionNote,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class OwnerCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly inventory: InventoryService,
  ) {}

  /** Catalog products this salon can add, with what the salon already stocks of each. */
  async browse(
    userId: string,
    salonId: string,
    query: OwnerCatalogBrowseQuery,
  ): Promise<
    InventoryPageDto<OwnerCatalogProductDto> & { categories: string[] }
  > {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const q = query.q?.trim();
    // A FastQue product QR carries the internal id, never a retail barcode.
    const qrId = q
      ?.match(/^fastque:product:([0-9a-f-]{36})$/i)?.[1]
      ?.toLowerCase();
    const barcode = q && !qrId ? normalizeBarcode(q) : null;
    const where: Prisma.GlobalProductWhereInput = {
      AND: [
        catalogVisibleTo(salonId),
        ...(qrId ? [{ id: qrId }] : []),
        ...(query.category ? [{ category: query.category }] : []),
        ...(query.notInInventory
          ? [{ inventoryProducts: { none: { salonId } } }]
          : []),
        ...(q && !qrId
          ? [
              {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  { brand: { contains: q, mode: 'insensitive' as const } },
                  { externalRef: { equals: q, mode: 'insensitive' as const } },
                  { barcodes: { some: { display: { contains: q } } } },
                  ...(barcode?.ok
                    ? [{ barcodes: { some: { code: barcode.code } } }]
                    : []),
                ],
              },
            ]
          : []),
        ...(query.cursor ? [{ id: { gt: query.cursor } }] : []),
      ],
    };
    const [rows, categories] = await Promise.all([
      this.prisma.globalProduct.findMany({
        where,
        orderBy: { id: 'asc' },
        take: query.limit + 1,
        include: {
          barcodes: { orderBy: { createdAt: 'asc' } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          inventoryProducts: {
            where: { salonId },
            select: { id: true, usage: true, stockOnHand: true },
          },
        },
      }),
      this.prisma.globalProduct.findMany({
        where: { ...catalogVisibleTo(salonId), category: { not: null } },
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
        take: 100,
      }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        subcategory: p.subcategory,
        variant: p.variantText,
        packSize: p.packSize?.toFixed(3) ?? null,
        packUnit: p.packUnit,
        mrp: p.mrp?.toFixed(2) ?? null,
        visibility: p.visibility,
        isTestData: p.isTestData,
        barcodes: p.barcodes.map((b) => ({
          code: b.code,
          display: b.display,
          symbology: symbologyOf(b.display, b.format),
        })),
        imageUrl: p.images[0]?.url ?? null,
        inMyInventory: p.inventoryProducts.map((i) => ({
          inventoryProductId: i.id,
          usage: i.usage,
          stockOnHand: i.stockOnHand.toFixed(3),
        })),
      })),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      hasMore: rows.length > query.limit,
      categories: categories.map((c) => c.category!).filter(Boolean),
    };
  }

  /**
   * Adds a catalog product to the salon's inventory with zero stock (stock then arrives through the
   * normal ledger: opening stock / purchase). Adding the same product and shelf twice returns the
   * existing row.
   */
  async add(
    userId: string,
    salonId: string,
    input: OwnerAddCatalogProductInput,
  ): Promise<{ product: InventoryProductDto; created: boolean }> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const catalog = await this.prisma.globalProduct.findFirst({
      where: { id: input.globalProductId, ...catalogVisibleTo(salonId) },
      select: { id: true, name: true, packSize: true, packUnit: true },
    });
    if (!catalog)
      throw new AppException(
        CatalogErrorCode.NOT_USABLE,
        'This catalog product is not available to your shop.',
        HttpStatus.NOT_FOUND,
      );
    const existing = await this.prisma.inventoryProduct.findFirst({
      where: { salonId, globalProductId: catalog.id, usage: input.usage },
      select: { id: true },
    });
    if (existing)
      return {
        product: await this.inventory.getProduct(salonId, existing.id),
        created: false,
      };
    const unit = input.unit ?? 'EACH';
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.inventoryProduct.create({
          data: {
            salonId,
            globalProductId: catalog.id,
            usage: input.usage,
            name: catalog.name.slice(0, 120),
            normalizedName: normalizeProductName(catalog.name).slice(0, 120),
            unit,
            ...(['EACH', 'PACK', 'BOX'].includes(unit) &&
            catalog.packSize?.greaterThan(0) &&
            catalog.packUnit &&
            ['GRAM', 'KILOGRAM', 'MILLILITER', 'LITER'].includes(
              catalog.packUnit,
            )
              ? { contentSize: catalog.packSize, contentUnit: catalog.packUnit }
              : {}),
            reorderThreshold: (input.reorderThreshold ?? 0).toFixed(3),
            sellingPrice: input.sellingPrice?.toFixed(2) ?? null,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'INVENTORY_PRODUCT_ADDED_FROM_CATALOG',
            entityType: 'InventoryProduct',
            entityId: row.id,
            metadata: {
              salonId,
              globalProductId: catalog.id,
              usage: input.usage,
            },
          },
        });
        return row;
      });
      return {
        product: await this.inventory.getProduct(salonId, created.id),
        created: true,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.inventoryProduct.findFirstOrThrow({
          where: { salonId, globalProductId: catalog.id, usage: input.usage },
          select: { id: true },
        });
        return {
          product: await this.inventory.getProduct(salonId, raced.id),
          created: false,
        };
      }
      throw error;
    }
  }

  async summary(
    userId: string,
    salonId: string,
  ): Promise<OwnerInventorySummaryDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totals, recent, consumption] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          active: bigint;
          low: bigint;
          out: bigint;
          value: Prisma.Decimal;
          linked: bigint;
        }>
      >(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE "isActive") AS "active",
          COUNT(*) FILTER (WHERE "isActive" AND "stockOnHand" > 0 AND "stockOnHand" <= "reorderThreshold") AS "low",
          COUNT(*) FILTER (WHERE "isActive" AND "stockOnHand" = 0) AS "out",
          COALESCE(SUM("stockOnHand" * "averageUnitCost") FILTER (WHERE "isActive"), 0)::decimal(20,2) AS "value",
          COUNT(*) FILTER (WHERE "isActive" AND "globalProductId" IS NOT NULL) AS "linked"
        FROM "inventory_products" WHERE "salonId" = ${salonId}`),
      this.prisma.inventoryMovement.findMany({
        where: { salonId },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 10,
        include: { product: { select: { name: true } } },
      }),
      this.prisma.$queryRaw<
        Array<{
          productId: string;
          name: string;
          unit: string;
          qty: Prisma.Decimal;
        }>
      >(Prisma.sql`
        SELECT m."productId", p."name", p."unit"::text AS "unit", SUM(-m."quantityDelta")::decimal(20,3) AS "qty"
        FROM "inventory_movements" m JOIN "inventory_products" p ON p."id" = m."productId"
        WHERE m."salonId" = ${salonId} AND m."kind" = 'CONSUMPTION' AND m."recordedAt" >= ${since}
        GROUP BY m."productId", p."name", p."unit" ORDER BY "qty" DESC LIMIT 10`),
    ]);
    const t = totals[0];
    return {
      activeProducts: Number(t?.active ?? 0),
      lowStock: Number(t?.low ?? 0),
      outOfStock: Number(t?.out ?? 0),
      stockValue: new Prisma.Decimal(t?.value ?? 0).toFixed(2),
      catalogLinked: Number(t?.linked ?? 0),
      recentTransactions: recent.map((m) => ({
        id: m.id,
        productId: m.productId,
        productName: m.product.name,
        kind: m.kind,
        transactionType: transactionTypeOfKind(m.kind),
        quantityDelta: m.quantityDelta.toFixed(3),
        stockAfter: m.stockAfter.toFixed(3),
        recordedAt: m.recordedAt.toISOString(),
      })),
      consumption30d: consumption.map((c) => ({
        productId: c.productId,
        productName: c.name,
        unit: c.unit as OwnerInventorySummaryDto['consumption30d'][number]['unit'],
        quantity: new Prisma.Decimal(c.qty).toFixed(3),
      })),
    };
  }

  async createChangeRequest(
    userId: string,
    salonId: string,
    input: CatalogChangeRequestInput,
  ): Promise<CatalogChangeRequestDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    if (input.globalProductId) {
      const visible = await this.prisma.globalProduct.findFirst({
        where: { id: input.globalProductId, ...catalogVisibleTo(salonId) },
        select: { id: true },
      });
      if (!visible)
        throw new AppException(
          CatalogErrorCode.NOT_USABLE,
          'This catalog product is not available to your shop.',
          HttpStatus.NOT_FOUND,
        );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.catalogChangeRequest.create({
        data: {
          salonId,
          requestedByUserId: userId,
          globalProductId: input.globalProductId ?? null,
          barcode: input.barcode?.trim() || null,
          message: input.message.trim(),
          proposedFields: input.proposedFields ?? undefined,
        },
        include: changeRequestInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'CATALOG_CHANGE_REQUESTED',
          entityType: 'CatalogChangeRequest',
          entityId: created.id,
          metadata: { salonId, globalProductId: input.globalProductId ?? null },
        },
      });
      return created;
    });
    return toChangeRequestDto(row);
  }

  async listOwnChangeRequests(
    userId: string,
    salonId: string,
  ): Promise<CatalogChangeRequestDto[]> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const rows = await this.prisma.catalogChangeRequest.findMany({
      where: { salonId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: changeRequestInclude,
    });
    return rows.map(toChangeRequestDto);
  }

  async listChangeRequests(
    query: CatalogChangeRequestListQuery,
  ): Promise<InventoryPageDto<CatalogChangeRequestDto>> {
    const rows = await this.prisma.catalogChangeRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: changeRequestInclude,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toChangeRequestDto),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      hasMore: rows.length > query.limit,
    };
  }

  async resolveChangeRequest(
    adminUserId: string,
    id: string,
    input: ResolveCatalogChangeRequestInput,
  ): Promise<CatalogChangeRequestDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.catalogChangeRequest.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: input.status,
          resolvedByUserId: adminUserId,
          resolvedAt: new Date(),
          resolutionNote: input.note?.trim() || null,
        },
      });
      if (!count)
        throw new AppException(
          'CATALOG_CHANGE_REQUEST_CLOSED',
          'This request is not open.',
          HttpStatus.CONFLICT,
        );
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: `CATALOG_CHANGE_${input.status}`,
          entityType: 'CatalogChangeRequest',
          entityId: id,
        },
      });
      return tx.catalogChangeRequest.findUniqueOrThrow({
        where: { id },
        include: changeRequestInclude,
      });
    });
    return toChangeRequestDto(row);
  }
}
