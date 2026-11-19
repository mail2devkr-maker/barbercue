import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SHOP_CATEGORIES,
  distanceKm,
  expandShopQuery,
  normalizeBarcode,
  symbologyOf,
  type ShopFacetsDto,
  type ShopHomeDto,
  type ShopOfferDto,
  type ShopProductCardDto,
  type ShopProductDetailDto,
  type ShopProductPageDto,
  type ShopProductsQuery,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  availabilityLabel,
  availableUnits,
  reservedUnits,
  showTestData,
} from './shop-stock';

const CANDIDATE_LIMIT = 2000;

const productSelect = {
  id: true,
  name: true,
  brand: true,
  category: true,
  subcategory: true,
  variantText: true,
  description: true,
  manufacturer: true,
  packSize: true,
  packUnit: true,
  mrp: true,
  isTestData: true,
  createdAt: true,
  barcodes: {
    select: { display: true, format: true },
    orderBy: { createdAt: 'asc' as const },
  },
  images: {
    select: { url: true },
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
  },
} satisfies Prisma.GlobalProductSelect;
type ProductRow = Prisma.GlobalProductGetPayload<{
  select: typeof productSelect;
}>;

type Point = { lat: number; lng: number } | null;

const discount = (price: Prisma.Decimal, compareAt: Prisma.Decimal | null) =>
  compareAt && compareAt.greaterThan(price)
    ? Math.round(
        compareAt.minus(price).dividedBy(compareAt).times(100).toNumber(),
      )
    : null;

/**
 * Public, read-only side of Marketplace. Shows verified catalog products and, for each, the offers of
 * salons that have an APPROVED listing, an active salon and real stock. Only public fields leave
 * this service: no cost prices, no stock of unlisted products, no unpublished listings.
 */
@Injectable()
export class ShopCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Products the public may see: verified global ones, plus shop-only ones their salon lists. */
  private visibleWhere(): Prisma.GlobalProductWhereInput {
    return {
      verificationStatus: 'VERIFIED',
      ...(showTestData() ? {} : { isTestData: false }),
      OR: [
        { visibility: 'GLOBAL' },
        {
          shopListings: {
            some: { status: 'APPROVED', salon: { status: 'ACTIVE' } },
          },
        },
      ],
    };
  }

  private categoryWhere(slug?: string): Prisma.GlobalProductWhereInput {
    const cat = SHOP_CATEGORIES.find((c) => c.slug === slug);
    if (!cat || !cat.match.length) return {};
    return {
      OR: cat.match.map((m) => ({
        category: { equals: m, mode: 'insensitive' as const },
      })),
    };
  }

  private textWhere(
    q?: string,
    relaxed = false,
  ): Prisma.GlobalProductWhereInput {
    const text = q?.trim();
    if (!text) return {};
    const barcode = normalizeBarcode(text);
    if (barcode.ok && /^\d{8,14}$/.test(text.replace(/[\s-]/g, '')))
      return { barcodes: { some: { code: barcode.code } } };
    const groups = expandShopQuery(text);
    return {
      [relaxed ? 'OR' : 'AND']: groups.map((words) => ({
        OR: words.flatMap((w) => [
          { name: { contains: w, mode: 'insensitive' as const } },
          { brand: { contains: w, mode: 'insensitive' as const } },
          { category: { contains: w, mode: 'insensitive' as const } },
          { subcategory: { contains: w, mode: 'insensitive' as const } },
          { description: { contains: w, mode: 'insensitive' as const } },
        ]),
      })),
    };
  }

  /** Every live offer for these products (approved listing, active salon, active stock row). */
  async offersFor(
    productIds: string[],
    at: Point,
    citySlug?: string,
  ): Promise<Map<string, ShopOfferDto[]>> {
    const out = new Map<string, ShopOfferDto[]>();
    if (!productIds.length) return out;
    const listings = await this.prisma.shopListing.findMany({
      where: {
        globalProductId: { in: productIds },
        status: 'APPROVED',
        salon: {
          status: 'ACTIVE',
          ...(citySlug ? { city: { slug: citySlug } } : {}),
        },
        inventoryProduct: { isActive: true },
      },
      include: {
        inventoryProduct: { select: { id: true, stockOnHand: true } },
        salon: {
          select: {
            id: true,
            name: true,
            slug: true,
            lat: true,
            lng: true,
            localityText: true,
            city: { select: { name: true } },
          },
        },
      },
    });
    const reserved = await reservedUnits(
      this.prisma,
      listings.map((l) => l.inventoryProductId),
    );
    for (const l of listings) {
      const available = availableUnits(
        l.inventoryProduct.stockOnHand,
        reserved.get(l.inventoryProductId) ?? 0,
      );
      const km =
        at && l.salon.lat != null && l.salon.lng != null
          ? Math.round(
              distanceKm(at, { lat: l.salon.lat, lng: l.salon.lng }) * 10,
            ) / 10
          : null;
      const offer: ShopOfferDto = {
        listingId: l.id,
        salon: {
          id: l.salon.id,
          name: l.salon.name,
          slug: l.salon.slug,
          city: l.salon.city?.name ?? null,
          locality: l.salon.localityText,
        },
        price: l.price.toFixed(2),
        compareAtPrice: l.compareAtPrice?.toFixed(2) ?? null,
        discountPercent: discount(l.price, l.compareAtPrice),
        availability: availabilityLabel(available),
        availableQuantity: available,
        maxPerOrder: l.maxPerOrder,
        pickup: l.pickupEnabled,
        delivery: false, // delivery is not offered yet
        distanceKm: km,
      };
      out.set(l.globalProductId, [
        ...(out.get(l.globalProductId) ?? []),
        offer,
      ]);
    }
    for (const list of out.values())
      list.sort(
        (a, b) =>
          Number(b.availableQuantity > 0) - Number(a.availableQuantity > 0) ||
          Number(a.price) - Number(b.price) ||
          (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
      );
    return out;
  }

  private toCard(
    p: ProductRow,
    offers: ShopOfferDto[],
    radiusKm?: number,
  ): ShopProductCardDto {
    const usable = offers.filter(
      (o) =>
        o.availableQuantity > 0 &&
        (radiusKm == null || o.distanceKm == null || o.distanceKm <= radiusKm),
    );
    const best = usable.reduce<ShopOfferDto | null>(
      (m, o) => (!m || Number(o.price) < Number(m.price) ? o : m),
      null,
    );
    const distances = usable
      .map((o) => o.distanceKm)
      .filter((d): d is number => d != null);
    const maxDiscount = Math.max(
      0,
      ...usable.map((o) => o.discountPercent ?? 0),
    );
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      category: p.category,
      variant: p.variantText,
      imageUrl: p.images[0]?.url ?? null,
      isTestData: p.isTestData,
      barcode: p.barcodes[0]?.display ?? null,
      mrp: p.mrp?.toFixed(2) ?? null,
      fromPrice: best?.price ?? null,
      compareAtPrice: best?.compareAtPrice ?? null,
      discountPercent: best?.discountPercent ?? null,
      maxDiscountPercent: maxDiscount || null,
      sellerCount: usable.length,
      inStock: usable.length > 0,
      nearestKm: distances.length ? Math.min(...distances) : null,
    };
  }

  private async popularity(productIds: string[]): Promise<Map<string, number>> {
    if (!productIds.length) return new Map();
    const since = new Date(Date.now() - 30 * 864e5);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; units: bigint }>
    >(Prisma.sql`
      SELECT i."globalProductId" AS "id", SUM(i."quantity")::bigint AS "units"
      FROM "shop_order_items" i JOIN "shop_orders" o ON o."id" = i."orderId"
      WHERE o."placedAt" >= ${since} AND o."status" NOT IN ('CANCELLED', 'EXPIRED')
        AND i."globalProductId" IN (${Prisma.join(productIds)})
      GROUP BY i."globalProductId"`);
    return new Map(rows.map((r) => [r.id, Number(r.units)]));
  }

  /** Every word must match; if that finds nothing, any word may match (shown as related results). */
  async search(
    query: ShopProductsQuery,
  ): Promise<ShopProductPageDto & { relaxed?: boolean }> {
    const strict = await this.searchOnce(query, false);
    if (
      strict.total > 0 ||
      !query.q?.trim() ||
      expandShopQuery(query.q).length < 2
    )
      return strict;
    return { ...(await this.searchOnce(query, true)), relaxed: true };
  }

  private async searchOnce(
    query: ShopProductsQuery,
    relaxed: boolean,
  ): Promise<ShopProductPageDto> {
    const at =
      query.lat != null && query.lng != null
        ? { lat: query.lat, lng: query.lng }
        : null;
    const where: Prisma.GlobalProductWhereInput = {
      AND: [
        this.visibleWhere(),
        this.categoryWhere(query.category),
        this.textWhere(query.q, relaxed),
        ...(query.brand
          ? [{ brand: { equals: query.brand, mode: 'insensitive' as const } }]
          : []),
        ...(query.salonId
          ? [
              {
                shopListings: {
                  some: { salonId: query.salonId, status: 'APPROVED' as const },
                },
              },
            ]
          : []),
      ],
    };
    const rows = await this.prisma.globalProduct.findMany({
      where,
      select: productSelect,
      orderBy: { id: 'asc' },
      take: CANDIDATE_LIMIT,
    });
    const offers = await this.offersFor(
      rows.map((r) => r.id),
      at,
      query.city,
    );
    let cards = rows.map((r) =>
      this.toCard(r, offers.get(r.id) ?? [], query.radiusKm),
    );
    const onSaleOnly = query.onSale || query.category === 'offers';
    if (query.availableOnly || query.salonId)
      cards = cards.filter((c) => c.inStock);
    if (onSaleOnly)
      cards = cards.filter((c) => (c.maxDiscountPercent ?? 0) > 0);
    if (query.radiusKm != null && at)
      cards = cards.filter(
        (c) => c.nearestKm != null && c.nearestKm <= query.radiusKm!,
      );
    if (query.minPrice != null)
      cards = cards.filter(
        (c) => c.fromPrice != null && Number(c.fromPrice) >= query.minPrice!,
      );
    if (query.maxPrice != null)
      cards = cards.filter(
        (c) => c.fromPrice != null && Number(c.fromPrice) <= query.maxPrice!,
      );

    const created = new Map(rows.map((r) => [r.id, r.createdAt.getTime()]));
    const popular =
      query.sort === 'popular' || query.sort === 'relevance'
        ? await this.popularity(cards.map((c) => c.id))
        : new Map<string, number>();
    const price = (c: ShopProductCardDto) =>
      c.fromPrice == null ? null : Number(c.fromPrice);
    const nameScore = (c: ShopProductCardDto) => {
      const q = query.q?.trim().toLowerCase();
      if (!q) return 0;
      return c.name.toLowerCase().startsWith(q)
        ? 2
        : c.name.toLowerCase().includes(q)
          ? 1
          : 0;
    };
    cards.sort((a, b) => {
      switch (query.sort) {
        case 'price_asc':
          return (price(a) ?? Infinity) - (price(b) ?? Infinity);
        case 'price_desc':
          return (price(b) ?? -Infinity) - (price(a) ?? -Infinity);
        case 'nearest':
          return (a.nearestKm ?? Infinity) - (b.nearestKm ?? Infinity);
        case 'popular':
          return (
            (popular.get(b.id) ?? 0) - (popular.get(a.id) ?? 0) ||
            Number(b.inStock) - Number(a.inStock)
          );
        case 'newest':
          return (created.get(b.id) ?? 0) - (created.get(a.id) ?? 0);
        default:
          return (
            nameScore(b) - nameScore(a) ||
            Number(b.inStock) - Number(a.inStock) ||
            (popular.get(b.id) ?? 0) - (popular.get(a.id) ?? 0) ||
            a.name.localeCompare(b.name)
          );
      }
    });
    const start = (query.page - 1) * query.limit;
    return {
      items: cards.slice(start, start + query.limit),
      total: cards.length,
      page: query.page,
      pageSize: query.limit,
    };
  }

  async home(at: Point, citySlug?: string): Promise<ShopHomeDto> {
    const rows = await this.prisma.globalProduct.findMany({
      where: this.visibleWhere(),
      select: productSelect,
      take: CANDIDATE_LIMIT,
      orderBy: { createdAt: 'desc' },
    });
    const offers = await this.offersFor(
      rows.map((r) => r.id),
      at,
      citySlug,
    );
    const cards = rows.map((r) => this.toCard(r, offers.get(r.id) ?? []));
    const popular = await this.popularity(cards.map((c) => c.id));
    const available = cards.filter((c) => c.inStock);
    const counts = SHOP_CATEGORIES.map((cat) => ({
      slug: cat.slug,
      label: cat.label,
      emoji: cat.emoji,
      products:
        cat.slug === 'offers'
          ? cards.filter((c) => (c.maxDiscountPercent ?? 0) > 0).length
          : rows.filter((r) =>
              cat.match.includes((r.category ?? '').toLowerCase()),
            ).length,
    }));
    const sellingSalons = new Set(
      [...offers.values()]
        .flat()
        .filter((o) => o.availableQuantity > 0)
        .map((o) => o.salon.id),
    );
    return {
      categories: counts,
      availableNow: [...available]
        .sort((a, b) => (a.nearestKm ?? 1e9) - (b.nearestKm ?? 1e9))
        .slice(0, 12),
      onSale: available
        .filter((c) => (c.maxDiscountPercent ?? 0) > 0)
        .sort(
          (a, b) => (b.maxDiscountPercent ?? 0) - (a.maxDiscountPercent ?? 0),
        )
        .slice(0, 12),
      popular: [...available]
        .filter((c) => (popular.get(c.id) ?? 0) > 0)
        .sort((a, b) => (popular.get(b.id) ?? 0) - (popular.get(a.id) ?? 0))
        .slice(0, 12),
      newArrivals: cards.slice(0, 12),
      stats: {
        products: cards.length,
        sellingSalons: sellingSalons.size,
        listedProducts: available.length,
      },
    };
  }

  async facets(): Promise<ShopFacetsDto> {
    const visible = this.visibleWhere();
    const [brands, categories, prices] = await Promise.all([
      this.prisma.globalProduct.groupBy({
        by: ['brand'],
        where: { ...visible, brand: { not: null } },
        _count: { _all: true },
        orderBy: { brand: 'asc' },
        take: 200,
      }),
      this.prisma.globalProduct.groupBy({
        by: ['category'],
        where: { ...visible, category: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.shopListing.aggregate({
        where: { status: 'APPROVED', salon: { status: 'ACTIVE' } },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);
    return {
      brands: brands.map((b) => ({ name: b.brand!, products: b._count._all })),
      categories: SHOP_CATEGORIES.filter((c) => c.match.length).map((c) => ({
        slug: c.slug,
        label: c.label,
        products: categories
          .filter((x) => c.match.includes((x.category ?? '').toLowerCase()))
          .reduce((n, x) => n + x._count._all, 0),
      })),
      priceRange:
        prices._min.price && prices._max.price
          ? {
              min: prices._min.price.toFixed(2),
              max: prices._max.price.toFixed(2),
            }
          : null,
    };
  }

  async product(
    id: string,
    at: Point,
    citySlug?: string,
  ): Promise<ShopProductDetailDto> {
    const row = await this.prisma.globalProduct.findFirst({
      where: { AND: [{ id }, this.visibleWhere()] },
      select: productSelect,
    });
    if (!row)
      throw new AppException(
        'SHOP_PRODUCT_NOT_FOUND',
        'This product is not available in the shop.',
        HttpStatus.NOT_FOUND,
      );
    const relatedRows = row.category
      ? await this.prisma.globalProduct.findMany({
          where: {
            AND: [
              this.visibleWhere(),
              { category: row.category },
              { id: { not: row.id } },
            ],
          },
          select: productSelect,
          take: 8,
          orderBy: { name: 'asc' },
        })
      : [];
    const offers = await this.offersFor(
      [row.id, ...relatedRows.map((r) => r.id)],
      at,
      citySlug,
    );
    const own = offers.get(row.id) ?? [];
    return {
      ...this.toCard(row, own),
      description: row.description,
      subcategory: row.subcategory,
      manufacturer: row.manufacturer,
      packSize: row.packSize?.toFixed(3) ?? null,
      packUnit: row.packUnit,
      barcodes: row.barcodes.map((b) => ({
        display: b.display,
        symbology: symbologyOf(b.display, b.format),
      })),
      offers: at
        ? [...own].sort(
            (a, b) =>
              Number(b.availableQuantity > 0) -
                Number(a.availableQuantity > 0) ||
              (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
          )
        : own,
      related: relatedRows.map((r) => this.toCard(r, offers.get(r.id) ?? [])),
    };
  }

  /** Public ids for the sitemap (verified, visible products only). */
  async sitemapIds(): Promise<Array<{ id: string; updatedAt: string }>> {
    const rows = await this.prisma.globalProduct.findMany({
      where: { AND: [this.visibleWhere(), { isTestData: false }] },
      select: { id: true, updatedAt: true },
      take: 5000,
    });
    return rows.map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
