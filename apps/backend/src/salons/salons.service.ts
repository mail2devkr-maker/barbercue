import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SalonStatus,
  type PaginatedResult,
  type RegisterSalonInput,
  type RegisterSalonResultDto,
  type SalonListItemDto,
  type SalonProfileDto,
  type SalonSearchQueryInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { CitiesService } from './cities.service';

const DEFAULT_PAGE_SIZE = 20;
const RECENT_REVIEWS_LIMIT = 10;
// A brand-new shop's slug never collides in practice (name + city is a very sparse space at this
// scale), but the DB-level @@unique([cityId, slug]) constraint is the real guarantee — this cap
// just bounds how many times we retry a P2002 before giving up with a clear error instead of an
// infinite loop.
const MAX_SLUG_ATTEMPTS = 5;

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
    private readonly salonAccess: SalonAccessService,
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
      publicId: salon.publicId,
      name: salon.name,
      slug: salon.slug,
      citySlug: salon.city.slug,
      localitySlug: salon.locality?.slug,
      addressLine: salon.addressLine,
      postalCode: salon.postalCode,
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

  /**
   * Self-serve shop registration (major-upgrade phase). Any authenticated user — including a
   * customer who just signed up seconds ago via Google — may register a shop; a SALON_OWNER
   * UserRole is granted for the new salon in the same transaction, on top of (never replacing)
   * whatever roles they already have. Requires an existing City (by slug) rather than accepting
   * free-text state/country, so a typo can't silently create a duplicate/junk City row — city
   * curation stays CitiesService's existing, separate concern.
   */
  async registerSalon(
    ownerUserId: string,
    input: RegisterSalonInput,
  ): Promise<RegisterSalonResultDto> {
    const city = await this.citiesService.findCityBySlugOrThrow(input.citySlug);

    let localityId: string | null = null;
    if (input.localitySlug) {
      const locality = await this.prisma.locality.findUnique({
        where: { cityId_slug: { cityId: city.id, slug: input.localitySlug } },
      });
      if (!locality) {
        throw new AppException(
          'LOCALITY_NOT_FOUND',
          'Locality not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      localityId = locality.id;
    }

    const baseSlug = slugify(input.name);
    let lastError: Prisma.PrismaClientKnownRequestError | undefined;
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      try {
        const salon = await this.prisma.$transaction(async (tx) => {
          // publicId is never set here — it's a DB column DEFAULT (see the
          // add_salon_public_id migration's sequence), so every real INSERT gets one
          // automatically, with uniqueness guaranteed by Postgres, not app code.
          const created = await tx.salon.create({
            data: {
              ownerUserId,
              name: input.name,
              slug,
              cityId: city.id,
              localityId,
              addressLine: input.addressLine,
              postalCode: input.postalCode,
              // Absent when the owner declined GPS — stored as NULL, not 0/0 (a real place in
              // the Gulf of Guinea), so "unknown" stays distinguishable from "there".
              lat: input.lat ?? null,
              lng: input.lng ?? null,
              phone: input.phone ?? null,
              email: input.email ?? null,
              status: SalonStatus.PENDING,
            },
          });
          await tx.userRole.upsert({
            where: {
              userId_role_salonId: {
                userId: ownerUserId,
                role: 'SALON_OWNER',
                salonId: created.id,
              },
            },
            update: {},
            create: {
              userId: ownerUserId,
              role: 'SALON_OWNER',
              salonId: created.id,
            },
          });
          return created;
        });

        return {
          id: salon.id,
          publicId: salon.publicId,
          slug: salon.slug,
          name: salon.name,
          status: salon.status,
        };
      } catch (err) {
        // Only retry on the specific (cityId, slug) collision — anything else is a real failure.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw (
      lastError ??
      new AppException(
        'SALON_SLUG_UNAVAILABLE',
        'Could not register this shop. Please try again.',
        HttpStatus.CONFLICT,
      )
    );
  }

  /** GET salons/mine — every salon this user owns, for the dashboard's salon-picker landing page. */
  async listOwned(ownerUserId: string): Promise<RegisterSalonResultDto[]> {
    const salons = await this.prisma.salon.findMany({
      where: { ownerUserId },
      orderBy: { name: 'asc' },
    });
    return salons.map((s) => ({
      id: s.id,
      publicId: s.publicId,
      slug: s.slug,
      name: s.name,
      status: s.status,
    }));
  }

  /**
   * GET salons/mine/:salonId — minimal owner/staff-scoped detail (publicId + identity), for the
   * settings page. Reuses SalonAccessService (the same membership check the queue dashboard
   * already relies on) rather than a bespoke ownerUserId check, so access rules can't drift
   * between "can view this salon's settings" and "can operate this salon's queue".
   */
  async getOwnedSalon(
    userId: string,
    salonId: string,
  ): Promise<RegisterSalonResultDto> {
    await this.salonAccess.assertAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: salon.id,
      publicId: salon.publicId,
      slug: salon.slug,
      name: salon.name,
      status: salon.status,
    };
  }

  private async toListItem(
    salon: SalonWithListRelations,
  ): Promise<SalonListItemDto> {
    const { ratingAverage, ratingCount, priceMin, priceMax } =
      await this.aggregate(salon.id);
    return {
      id: salon.id,
      publicId: salon.publicId,
      name: salon.name,
      slug: salon.slug,
      citySlug: salon.city.slug,
      localitySlug: salon.locality?.slug,
      addressLine: salon.addressLine,
      postalCode: salon.postalCode,
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

/** Lowercase, ASCII-hyphenated slug from a shop name — "Fresh Cuts & Co." -> "fresh-cuts-co". */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shop'
  );
}
