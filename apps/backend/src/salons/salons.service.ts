import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SalonStatus,
  type PaginatedResult,
  type SalonListItemDto,
  type SalonProfileDto,
  type SalonSearchQueryInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CitiesService } from './cities.service';

const DEFAULT_PAGE_SIZE = 20;
const RECENT_REVIEWS_LIMIT = 10;

// Include shape shared by both the list query and the mapping helper, so the two never drift.
const listInclude = {
  city: true,
  locality: true,
  photos: { where: { type: 'COVER' as const }, take: 1 },
} satisfies Prisma.SalonInclude;

type SalonWithListRelations = Prisma.SalonGetPayload<{
  include: typeof listInclude;
}>;

@Injectable()
export class SalonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly citiesService: CitiesService,
  ) {}

  async search(
    query: SalonSearchQueryInput,
  ): Promise<PaginatedResult<SalonListItemDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.SalonWhereInput = { status: SalonStatus.ACTIVE };
    if (query.city) where.city = { slug: query.city };
    if (query.locality) where.locality = { slug: query.locality };
    if (query.service) {
      where.services = {
        some: {
          isActive: true,
          OR: [
            { name: { contains: query.service, mode: 'insensitive' } },
            { category: { contains: query.service, mode: 'insensitive' } },
          ],
        },
      };
    }
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const salons = await this.prisma.salon.findMany({
      where,
      orderBy: { name: 'asc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: listInclude,
    });

    const hasMore = salons.length > limit;
    const page = hasMore ? salons.slice(0, limit) : salons;
    const items = await Promise.all(page.map((s) => this.toListItem(s)));

    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async getProfile(
    citySlug: string,
    salonSlug: string,
  ): Promise<SalonProfileDto> {
    const city = await this.citiesService.findCityBySlugOrThrow(citySlug);

    const salon = await this.prisma.salon.findFirst({
      where: { slug: salonSlug, cityId: city.id, status: SalonStatus.ACTIVE },
      include: {
        city: true,
        locality: true,
        photos: { orderBy: { sortOrder: 'asc' } },
        services: { where: { isActive: true }, orderBy: { name: 'asc' } },
        operatingHours: { orderBy: { dayOfWeek: 'asc' } },
        reviews: { orderBy: { createdAt: 'desc' }, take: RECENT_REVIEWS_LIMIT },
      },
    });
    if (!salon) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const { ratingAverage, ratingCount, priceMin, priceMax } =
      await this.aggregate(salon.id);

    return {
      id: salon.id,
      name: salon.name,
      slug: salon.slug,
      citySlug: salon.city.slug,
      localitySlug: salon.locality?.slug,
      addressLine: salon.addressLine,
      lat: salon.lat,
      lng: salon.lng,
      coverPhotoUrl:
        salon.photos.find((p) => p.type === 'COVER')?.url ??
        salon.photos[0]?.url ??
        null,
      ratingAverage,
      ratingCount,
      priceMin,
      priceMax,
      description: salon.description,
      phone: salon.phone,
      services: salon.services.map((s) => ({
        id: s.id,
        salonId: s.salonId,
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: Number(s.price),
        category: s.category ?? '',
        isActive: s.isActive,
      })),
      operatingHours: salon.operatingHours.map((h) => ({
        dayOfWeek: h.dayOfWeek,
        openTime: h.openTime,
        closeTime: h.closeTime,
        isClosed: h.isClosed,
      })),
      photos: salon.photos.map((p) => ({
        id: p.id,
        url: p.url,
        altText: p.altText,
        type: p.type,
      })),
      reviews: salon.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private async toListItem(
    salon: SalonWithListRelations,
  ): Promise<SalonListItemDto> {
    const { ratingAverage, ratingCount, priceMin, priceMax } =
      await this.aggregate(salon.id);
    return {
      id: salon.id,
      name: salon.name,
      slug: salon.slug,
      citySlug: salon.city.slug,
      localitySlug: salon.locality?.slug,
      addressLine: salon.addressLine,
      lat: salon.lat,
      lng: salon.lng,
      coverPhotoUrl: salon.photos[0]?.url ?? null,
      ratingAverage,
      ratingCount,
      priceMin,
      priceMax,
    };
  }

  // Computed on read, not stored (no schema change) — see DATABASE.md's existing pattern for
  // derived values. Two small aggregate queries per salon; fine at this data volume, a candidate
  // for denormalization/caching once salon counts grow past a foundation-phase scale.
  private async aggregate(salonId: string): Promise<{
    ratingAverage: number | null;
    ratingCount: number;
    priceMin: number | null;
    priceMax: number | null;
  }> {
    const [ratingAgg, priceAgg] = await Promise.all([
      this.prisma.review.aggregate({
        where: { salonId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.service.aggregate({
        where: { salonId, isActive: true },
        _min: { price: true },
        _max: { price: true },
      }),
    ]);
    return {
      ratingAverage: ratingAgg._avg.rating,
      ratingCount: ratingAgg._count.rating,
      priceMin: priceAgg._min.price ? Number(priceAgg._min.price) : null,
      priceMax: priceAgg._max.price ? Number(priceAgg._max.price) : null,
    };
  }
}
