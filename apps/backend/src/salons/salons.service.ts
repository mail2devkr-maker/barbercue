import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Role,
  SalonStatus,
  ChairStatus,
  QueueEntryStatus,
  currencyForCountry,
  haversineDistanceKm,
  type PaginatedResult,
  type RegisterSalonInput,
  type RegisterSalonResultDto,
  StaffMemberStatus,
  VerificationStatus,
  type LiveStatsDto,
  type SalonListItemDto,
  type SalonProfileDto,
  type PublicSalonStatusDto,
  type SalonSearchQueryInput,
  type SalonWorkplaceDto,
  type TeamMemberDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { CitiesService } from './cities.service';
import { isOpenAt, resolveSalonTimeZone } from '../common/timezone/timezone';

const DEFAULT_PAGE_SIZE = 20;
const RECENT_REVIEWS_LIMIT = 10;
// "Near Me" candidate pool before in-memory distance sort — see search()'s own doc comment.
const NEAR_ME_CANDIDATE_CAP = 200;
// Bounding-box prefilter radii tried in order until enough candidates are found (or the widest
// box is reached) — see boundingBoxDegrees()'s own doc comment for why a box, not PostGIS.
const NEAR_ME_RADII_KM = [25, 100, 400];
const KM_PER_DEGREE_LAT = 111;

// A cheap geographic prefilter for "Near Me", not a distance calculation: converts a radius into a
// lat/lng rectangle so the DB can discard rows that are obviously nowhere near the query point
// before the NEAR_ME_CANDIDATE_CAP applies, rather than capping an unfiltered (or merely
// coordinate-not-null) global scan. Longitude degrees shrink toward the poles (cos(lat) narrows
// them), so the box uses the query point's own latitude to size the longitude span correctly;
// latitude degrees are a constant ~111km everywhere. This is deliberately approximate (a rectangle,
// not a circle) — candidates inside it still get the exact Haversine distance and sort below, so
// the approximation only affects which rows are considered, never how they're ordered once
// considered.
function boundingBoxDegrees(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  // Guards the pole-adjacent case (cos ~ 0, so a degree of longitude is ~0km and the box would
  // otherwise blow up to +/-Infinity) — no real salon is there, but the math shouldn't NaN/Infinity
  // if it's ever asked to.
  const lngDelta = radiusKm / Math.max(kmPerDegreeLng, 1);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
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
  operatingHours: true,
  // Phase 18 — status only; a salon with no row at all (never submitted) is simply not verified.
  verification: { select: { status: true } },
} satisfies Prisma.SalonInclude;

// Resolved per salon (Salon.timezone, falling back to Asia/Kolkata only for an India-city salon —
// see resolveSalonTimeZone's own doc comment) rather than a fixed +05:30 offset. Null — never a
// guessed Open or Closed — when no trustworthy zone exists, same honest-unknown convention as
// isOpenAt's own contract.
function isOpenNow(
  hours: {
    dayOfWeek: number;
    isClosed: boolean;
    openTime: string;
    closeTime: string;
  }[],
  salon: { timezone: string | null; city: { countryCode: string } },
): boolean | null {
  const timeZone = resolveSalonTimeZone({
    timezone: salon.timezone,
    countryCode: salon.city.countryCode,
  });
  return isOpenAt(hours, timeZone);
}

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

  // Issue #13 Mission G — two cheap, independent count queries, no joins. Real zeros on a genuinely
  // empty platform, never a fabricated placeholder; the homepage hides a stat rather than render a
  // misleading "0" (see LiveStatsDto's own doc comment).
  async getLiveStats(): Promise<LiveStatsDto> {
    const [activeShopCount, liveWaitingCount] = await Promise.all([
      this.prisma.salon.count({ where: { status: SalonStatus.ACTIVE } }),
      this.prisma.queueEntry.count({
        where: {
          status: {
            in: [
              QueueEntryStatus.WAITING,
              QueueEntryStatus.CALLED,
              QueueEntryStatus.IN_SERVICE,
            ],
          },
        },
      }),
    ]);
    return { activeShopCount, liveWaitingCount };
  }

  async search(
    query: SalonSearchQueryInput,
  ): Promise<PaginatedResult<SalonListItemDto>> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.SalonWhereInput = { status: SalonStatus.ACTIVE };
    // City.slug is unique only per country (@@unique([countryCode, slug])), so a bare slug filter
    // can match a same-named city in a different country. countryCode is optional here because
    // not every caller has one in hand (free-text search, the landing page's featured shops) —
    // when it's supplied (city/locality pages, sitemap) the filter is exact rather than ambiguous.
    if (query.city) {
      where.city = query.countryCode
        ? { slug: query.city, countryCode: query.countryCode.toUpperCase() }
        : { slug: query.city };
    }
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
    // Issue #13 Mission D: the web search form's field is genuinely labeled "Shop or service" —
    // typing "bear" (or "beard") for a real shop's real "Beard" service returned zero results,
    // because this only ever matched salon name/description, never a service. Now mirrors the
    // same name-or-category match query.service already uses above, so the field actually
    // searches what it claims to.
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        {
          services: {
            some: {
              isActive: true,
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { category: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    // "Near Me" (Phase 4): sorting by a computed haversine distance isn't something Prisma/Postgres
    // can do without a geo extension (PostGIS earthdistance), which isn't set up here. Rather than
    // fake a stable cursor over an in-memory sort, distance mode fetches a capped batch, sorts it
    // in memory, and returns a single unpaginated page (nextCursor always null) — an honest
    // limitation for a foundation-phase, demo-scale salon count, not a hidden bug. Still bounded
    // candidates + in-memory Haversine, never PostGIS/a real nearest-neighbour index. Within that
    // architecture, candidates are now drawn from a geographic bounding box around the query point
    // (see boundingBoxDegrees), not merely "coordinate-bearing" — at real scale, a query point in a
    // dense city could otherwise have its 200-row cap filled entirely by coordinate-bearing salons
    // hundreds of km away in a different city, silently crowding out the genuinely nearby ones the
    // box now excludes them from competing with in the first place. The box widens (NEAR_ME_RADII_KM)
    // if the tightest one doesn't turn up enough candidates to fill a page — a sparse/rural query
    // point still gets a useful result instead of an artificially empty one — capped at the widest
    // configured radius rather than widening indefinitely into an unbounded scan. This remains an
    // honest limitation, not a claim of global correctness: with more than NEAR_ME_CANDIDATE_CAP
    // salons inside whichever box is used, the cap still picks an arbitrary (id-ordered, so at least
    // deterministic) subset of them rather than the exact nearest — the box only guarantees that
    // subset is geographically relevant, not that it's the true top-200-nearest within itself.
    const nearMe = query.lat !== undefined && query.lng !== undefined;
    if (nearMe) {
      const from = { lat: query.lat!, lng: query.lng! };
      // A salon with no lat/lng can never get a distance and is always dropped by the
      // distanceKm-not-null filter below — fetching it into the capped candidate set would only
      // ever waste one of the NEAR_ME_CANDIDATE_CAP slots. Filtering coordinates at the DB level
      // (on top of the bounding box) spends every one of the capped rows on a salon that can
      // actually appear in the sorted result.
      let candidates: SalonWithListRelations[] = [];
      for (const radiusKm of NEAR_ME_RADII_KM) {
        const box = boundingBoxDegrees(from.lat, from.lng, radiusKm);
        candidates = await this.prisma.salon.findMany({
          where: {
            ...where,
            lat: { not: null, gte: box.minLat, lte: box.maxLat },
            lng: { not: null, gte: box.minLng, lte: box.maxLng },
          },
          // Deterministic across widening attempts and repeated calls — Prisma/Postgres give no
          // ordering guarantee without an explicit orderBy, which would otherwise make which 200
          // rows survive the cap (when more than 200 match) merely "incidental," not reproducible.
          orderBy: { id: 'asc' },
          take: NEAR_ME_CANDIDATE_CAP,
          include: listInclude,
        });
        if (candidates.length >= limit) break;
      }
      const withDistance = await Promise.all(
        candidates.map((s) => this.toListItem(s, from)),
      );
      const sorted = withDistance
        .filter((s) => s.distanceKm !== null)
        // Tie-broken by id: the candidate query has no explicit orderBy, so two salons at an
        // identical distance would otherwise sort in whatever incidental row order Postgres
        // happened to return them in — never guaranteed, and not something a client can rely on
        // page-to-page. Sorting is stable (ES2019+), so this tiebreaker makes the full order
        // deterministic rather than merely "probably consistent."
        .sort(
          (a, b) => a.distanceKm! - b.distanceKm! || a.id.localeCompare(b.id),
        )
        .slice(0, limit);
      return { items: sorted, nextCursor: null };
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
    countryCode: string,
    citySlug: string,
    salonSlug: string,
  ): Promise<SalonProfileDto> {
    const city = await this.citiesService.findCityByCountryAndSlugOrThrow(
      countryCode,
      citySlug,
    );

    const salon = await this.prisma.salon.findFirst({
      where: { slug: salonSlug, cityId: city.id, status: SalonStatus.ACTIVE },
      include: {
        city: true,
        locality: true,
        photos: { orderBy: { sortOrder: 'asc' } },
        services: { where: { isActive: true }, orderBy: { name: 'asc' } },
        operatingHours: { orderBy: { dayOfWeek: 'asc' } },
        reviews: { orderBy: { createdAt: 'desc' }, take: RECENT_REVIEWS_LIMIT },
        // Phase 17 (Barber Professional Profile) — "Meet the team". Only staff currently working
        // here; someone marked INACTIVE (left, on leave) isn't shown to customers browsing the shop.
        staff: {
          where: { status: StaffMemberStatus.ACTIVE },
          orderBy: { displayName: 'asc' },
          // Phase 18 — status only, same reasoning as the salon's own verification include below.
          include: { verification: { select: { status: true } } },
        },
        // Phase 18 — status only; no row at all means "never submitted," not verified.
        verification: { select: { status: true } },
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
      countryCode: salon.city.countryCode,
      currency: salon.currency,
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
      // No lat/lng of the viewer to compare against on the profile page (unlike search results)
      // — the customer already navigated here, distance is no longer the decision being made.
      distanceKm: null,
      isOpenNow: isOpenNow(salon.operatingHours, salon),
      verified: salon.verification?.status === VerificationStatus.APPROVED,
      waitingCount: await this.prisma.queueEntry.count({
        where: {
          salonId: salon.id,
          status: {
            in: [
              QueueEntryStatus.WAITING,
              QueueEntryStatus.CALLED,
              QueueEntryStatus.IN_SERVICE,
            ],
          },
        },
      }),
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
      team: salon.staff.map((s): TeamMemberDto => ({
        id: s.id,
        displayName: s.displayName,
        roleInSalon: s.roleInSalon,
        photoUrl: s.photoUrl,
        bio: s.bio,
        yearsExperience: s.yearsExperience,
        verified: s.verification?.status === VerificationStatus.APPROVED,
      })),
    };
  }

  /**
   * Public live operating snapshot for a salon profile/booking page. Only active chairs, active
   * professionals, and aggregate active queue counts are selected. In particular, queue-entry
   * IDs and customer relations are never selected or serialized across this public boundary.
   */
  async getPublicStatus(
    countryCode: string,
    citySlug: string,
    salonSlug: string,
  ): Promise<PublicSalonStatusDto> {
    const city = await this.citiesService.findCityByCountryAndSlugOrThrow(
      countryCode,
      citySlug,
    );
    const salon = await this.prisma.salon.findFirst({
      where: { slug: salonSlug, cityId: city.id, status: SalonStatus.ACTIVE },
      select: {
        chairs: {
          where: { status: ChairStatus.ACTIVE },
          select: { id: true },
        },
        staff: {
          where: { status: StaffMemberStatus.ACTIVE },
          orderBy: { displayName: 'asc' },
          select: {
            displayName: true,
            _count: {
              select: {
                queueEntriesAssigned: {
                  where: {
                    status: {
                      in: [
                        QueueEntryStatus.WAITING,
                        QueueEntryStatus.CALLED,
                        QueueEntryStatus.IN_SERVICE,
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!salon) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      activeChairCount: salon.chairs.length,
      professionals: salon.staff.map((staff) => ({
        displayName: staff.displayName,
        activeQueueCount: staff._count.queueEntriesAssigned,
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

    // The client sends countryCode so postal validation can run before any lookup. Re-check it
    // against the city we actually resolved: without this, a caller could pair a country with a
    // lenient postal rule against a city in a country with a strict one and bypass the rule.
    if (city.countryCode !== input.countryCode) {
      throw new AppException(
        'CITY_COUNTRY_MISMATCH',
        'That city does not belong to the selected country.',
        HttpStatus.BAD_REQUEST,
      );
    }

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
              postalCode: input.postalCode ?? null,
              // Derived from the country, and only where that mapping is authoritative — an
              // unlisted country leaves this null rather than guessing a currency, and the UI
              // then renders a bare amount instead of a wrong symbol. `timezone` is deliberately
              // NOT set here: nothing can determine an IANA zone yet (GPS is optional, no lookup
              // is wired), so inventing one would be worse than leaving it null.
              currency: currencyForCountry(city.countryCode),
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
   * GET salons/workplaces — every salon this user may operate, for owners AND staff.
   *
   * listOwned above keys on Salon.ownerUserId, so a barber (who owns nothing) gets an empty list
   * and no route to the salon they actually work at. This resolves membership from UserRole —
   * byte-for-byte the same condition SalonAccessService.assertAccess enforces — so the list can
   * never show a salon the caller would then be refused, or hide one they can reach.
   *
   * `isOwner` is derived for presentation only. It decides whether the dashboard offers setup
   * links or just the live queue; it confers nothing, since every owner-only route independently
   * checks @Roles(SALON_OWNER) and assertAccess.
   */
  async listWorkplaces(userId: string): Promise<SalonWorkplaceDto[]> {
    const memberships = await this.prisma.userRole.findMany({
      where: {
        userId,
        salonId: { not: null },
        role: { in: [Role.SALON_STAFF, Role.SALON_OWNER] },
      },
      include: { salon: true },
    });

    // One user can hold both SALON_OWNER and SALON_STAFF for the same salon (an owner who also
    // cuts hair), which would otherwise list it twice.
    const bySalon = new Map<string, SalonWorkplaceDto>();
    for (const m of memberships) {
      if (!m.salon) continue;
      const existing = bySalon.get(m.salon.id);
      const isOwner = m.role === Role.SALON_OWNER;
      if (existing) {
        if (isOwner) existing.isOwner = true;
        continue;
      }
      bySalon.set(m.salon.id, {
        id: m.salon.id,
        publicId: m.salon.publicId,
        slug: m.salon.slug,
        name: m.salon.name,
        status: m.salon.status,
        isOwner,
      });
    }

    return [...bySalon.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * GET salons/mine/:salonId — minimal owner/staff-scoped detail (publicId + identity), for the
   * settings page. Reuses SalonAccessService (the same membership check the queue dashboard
   * already relies on) rather than a bespoke ownerUserId check, so access rules can't drift
   * between "can view this salon's settings" and "can operate this salon's queue".
   *
   * Part 2 — falls back to assertOwnerOrAdminAccess only when the normal owner/staff check fails,
   * so a genuine owner/staff request is completely unaffected (same call, same behavior, same
   * error) and a PLATFORM_ADMIN can load this same settings-page data for an ACTIVE salon they are
   * delegated-managing. A caller that is neither still gets assertOwnerOrAdminAccess's own
   * SALON_ACCESS_DENIED, not the original assertAccess error — both are 403s with an equivalent
   * message, so nothing meaningful is lost for a genuinely unauthorized caller.
   */
  async getOwnedSalon(
    userId: string,
    salonId: string,
  ): Promise<RegisterSalonResultDto> {
    try {
      await this.salonAccess.assertAccess(userId, salonId);
    } catch {
      await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    }
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
    from?: { lat: number; lng: number },
  ): Promise<SalonListItemDto> {
    const { ratingAverage, ratingCount, priceMin, priceMax } =
      await this.aggregate(salon.id);
    // Issue #13 Mission F — same per-salon-query convention as aggregate() above (see its own
    // comment: fine at this data volume). Same WAITING/CALLED/IN_SERVICE whitelist
    // getDashboardQueue/getCapacitySummary already use elsewhere, so an EXPIRED/terminal entry is
    // never counted here either.
    const waitingCount = await this.prisma.queueEntry.count({
      where: {
        salonId: salon.id,
        status: {
          in: [
            QueueEntryStatus.WAITING,
            QueueEntryStatus.CALLED,
            QueueEntryStatus.IN_SERVICE,
          ],
        },
      },
    });
    const distanceKm =
      from && salon.lat !== null && salon.lng !== null
        ? Math.round(
            haversineDistanceKm(from.lat, from.lng, salon.lat, salon.lng) * 10,
          ) / 10
        : null;
    return {
      id: salon.id,
      publicId: salon.publicId,
      name: salon.name,
      slug: salon.slug,
      citySlug: salon.city.slug,
      localitySlug: salon.locality?.slug,
      addressLine: salon.addressLine,
      countryCode: salon.city.countryCode,
      currency: salon.currency,
      postalCode: salon.postalCode,
      lat: salon.lat,
      lng: salon.lng,
      coverPhotoUrl: salon.photos[0]?.url ?? null,
      ratingAverage,
      ratingCount,
      priceMin,
      priceMax,
      distanceKm,
      isOpenNow: isOpenNow(salon.operatingHours, salon),
      verified: salon.verification?.status === VerificationStatus.APPROVED,
      waitingCount,
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
