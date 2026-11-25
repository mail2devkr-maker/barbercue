import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HOME_VERIFICATION_LABEL,
  homeProviderLabel,
  straightLineKm,
  type HomeSearchQuery,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { homeFlags, providerKindEnabled } from './home-config';
import { homeNotFound } from './home-errors';
import type { HomePoint } from './home-routing.service';

export interface HomePlace extends HomePoint {
  locality?: string | null;
  city?: string | null;
  society?: string | null;
}
export interface AreaLike {
  kind: string;
  value: string;
  radiusKm: number | null;
  excluded: boolean;
  surchargePaise: number;
  minOrderPaise: number;
}
const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

/** Which area (if any) covers the place. Any excluded match wins. Radius is straight-line eligibility only. */
export function coveringArea(
  areas: AreaLike[],
  base: HomePoint,
  place: HomePlace,
): AreaLike | null {
  const match = (a: AreaLike): boolean => {
    switch (a.kind) {
      case 'PINCODE':
        return !!place.postalCode && a.value.trim() === place.postalCode;
      case 'LOCALITY':
        return !!place.locality && norm(a.value) === norm(place.locality);
      case 'CITY':
        return !!place.city && norm(a.value) === norm(place.city);
      case 'SOCIETY':
        return !!place.society && norm(a.value) === norm(place.society);
      case 'RADIUS':
        return (
          a.radiusKm != null &&
          base.lat != null &&
          base.lng != null &&
          place.lat != null &&
          place.lng != null &&
          straightLineKm(
            { lat: base.lat, lng: base.lng },
            { lat: place.lat, lng: place.lng },
          ) <= a.radiusKm
        );
      default:
        return false;
    }
  };
  if (areas.some((a) => a.excluded && match(a))) return null;
  const order = ['SOCIETY', 'PINCODE', 'LOCALITY', 'RADIUS', 'CITY'];
  return (
    areas
      .filter((a) => !a.excluded && match(a))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0] ?? null
  );
}

const providerInclude = {
  salon: {
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      postalCode: true,
      status: true,
      isClosedForToday: true,
    },
  },
  areas: true,
  offerings: {
    where: {
      active: true,
      serviceDef: {
        status: 'ACTIVE' as const,
        category: { active: true },
      },
    },
    include: { serviceDef: { include: { category: true } } },
  },
  professionals: {
    where: { active: true, suspendedAt: null, consentAt: { not: null } },
    include: { services: true, verifications: true },
  },
} satisfies Prisma.HomeProviderInclude;
export type CatalogProvider = Prisma.HomeProviderGetPayload<{
  include: typeof providerInclude;
}>;
export type CatalogProfessional = CatalogProvider['professionals'][number];

export const providerBase = (p: CatalogProvider): HomePoint =>
  p.salon
    ? { lat: p.salon.lat, lng: p.salon.lng, postalCode: p.salon.postalCode }
    : { lat: p.baseLat, lng: p.baseLng };

/** Only currently valid, completed checks become a badge, and each badge says what was checked. */
export function verifiedBadges(
  verifications: {
    scope: string;
    subject: string;
    status: string;
    expiresAt: Date | null;
    verifiedAt: Date | null;
  }[],
  now = new Date(),
) {
  return verifications
    .filter(
      (v) => v.status === 'VERIFIED' && (!v.expiresAt || v.expiresAt > now),
    )
    .map((v) => ({
      scope: v.scope,
      subject: v.subject,
      label:
        HOME_VERIFICATION_LABEL[
          v.scope as keyof typeof HOME_VERIFICATION_LABEL
        ] + (v.subject ? ` (${v.subject.replace(/-/g, ' ')})` : ''),
      verifiedAt: v.verifiedAt?.toISOString() ?? null,
    }));
}

/** May this professional be booked for this offering (assigned skill + qualification)? */
export function canPerform(
  pro: CatalogProfessional,
  offering: CatalogProvider['offerings'][number],
): boolean {
  if (!pro.services.some((s) => s.offeringId === offering.id)) return false;
  const category = offering.serviceDef.category;
  if (!category.requiresQualification) return true;
  return verifiedBadges(pro.verifications).some(
    (b) => b.scope === 'SERVICE_QUALIFICATION' && b.subject === category.code,
  );
}

@Injectable()
export class HomeCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async config() {
    const flags = homeFlags();
    return { flags, enabled: flags.FASTQUE_HOME_ENABLED };
  }

  async categories() {
    const rows = await this.prisma.homeCategory.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        services: {
          where: { status: 'ACTIVE' },
          orderBy: { name: 'asc' },
          select: {
            code: true,
            name: true,
            nameHi: true,
            description: true,
            imageUrl: true,
            durationMinutes: true,
            synonyms: true,
            addOnCodes: true,
            customerPreparation: true,
            eligibility: true,
            safetyInstructions: true,
            customerProducts: true,
            forChildren: true,
          },
        },
      },
    });
    return rows.map((c) => ({
      code: c.code,
      group: c.groupCode,
      name: c.name,
      nameHi: c.nameHi,
      requiresQualification: c.requiresQualification,
      services: c.services,
    }));
  }

  /** Approved, enabled providers whose service area covers the place. */
  async providersCovering(
    place: HomePlace,
    filter: {
      serviceCodes?: string[];
      kind?: 'SALON_MANAGED' | 'INDEPENDENT_PROFESSIONAL';
      providerId?: string;
    } = {},
  ): Promise<{ provider: CatalogProvider; area: AreaLike }[]> {
    const kinds = (
      ['SALON_MANAGED', 'INDEPENDENT_PROFESSIONAL'] as const
    ).filter(
      (k) => providerKindEnabled(k) && (!filter.kind || filter.kind === k),
    );
    if (kinds.length === 0) return [];
    const areaOr: Prisma.HomeServiceAreaWhereInput[] = [];
    if (place.postalCode)
      areaOr.push({ kind: 'PINCODE', value: place.postalCode });
    for (const [kind, value] of [
      ['LOCALITY', place.locality],
      ['CITY', place.city],
      ['SOCIETY', place.society],
    ] as const)
      if (value)
        areaOr.push({
          kind,
          value: { equals: value.trim(), mode: 'insensitive' },
        });
    if (place.lat != null && place.lng != null) areaOr.push({ kind: 'RADIUS' });
    if (areaOr.length === 0) return [];
    // Radius providers are narrowed by a bounding box (largest radius is 50 km) before the exact check.
    const box =
      place.lat != null && place.lng != null
        ? {
            lat: { gte: place.lat - 0.6, lte: place.lat + 0.6 },
            lng: { gte: place.lng - 0.7, lte: place.lng + 0.7 },
          }
        : null;
    const rows = await this.prisma.homeProvider.findMany({
      where: {
        status: 'APPROVED',
        paused: false,
        kind: { in: [...kinds] },
        ...(filter.providerId ? { id: filter.providerId } : {}),
        professionals: {
          some: { active: true, suspendedAt: null, consentAt: { not: null } },
        },
        offerings: {
          some: {
            active: true,
            ...(filter.serviceCodes?.length
              ? { serviceDef: { code: { in: filter.serviceCodes } } }
              : {}),
          },
        },
        OR: [
          {
            areas: {
              some: {
                excluded: false,
                OR: areaOr.filter((a) => a.kind !== 'RADIUS'),
              },
            },
          },
          ...(box
            ? [
                {
                  areas: { some: { excluded: false, kind: 'RADIUS' as const } },
                  OR: [{ salon: box }, { baseLat: box.lat, baseLng: box.lng }],
                },
              ]
            : []),
        ],
        AND: [{ OR: [{ salonId: null }, { salon: { status: 'ACTIVE' } }] }],
      },
      include: providerInclude,
      orderBy: { id: 'asc' },
      take: 300,
    });
    return rows
      .map((provider) => ({
        provider,
        area: coveringArea(
          provider.areas,
          providerBase(provider),
          place,
        ) as AreaLike,
      }))
      .filter(
        (r) =>
          r.area &&
          (!filter.serviceCodes?.length ||
            filter.serviceCodes.every((code) =>
              r.provider.offerings.some((o) => o.serviceDef.code === code),
            )),
      );
  }

  async ratingMap(professionalIds: string[]) {
    const rows = professionalIds.length
      ? await this.prisma.homeReview.groupBy({
          by: ['professionalId'],
          where: {
            professionalId: { in: professionalIds },
            status: 'PUBLISHED',
          },
          _avg: { overall: true },
          _count: { _all: true },
        })
      : [];
    return new Map(
      rows.map((r) => [
        r.professionalId,
        {
          rating: r._avg.overall ? Math.round(r._avg.overall * 10) / 10 : null,
          count: r._count._all,
        },
      ]),
    );
  }

  async completedMap(professionalIds: string[]) {
    const rows = professionalIds.length
      ? await this.prisma.homeAssignment.groupBy({
          by: ['professionalId'],
          where: {
            professionalId: { in: professionalIds },
            status: 'COMPLETED',
          },
          _count: { _all: true },
        })
      : [];
    return new Map(rows.map((r) => [r.professionalId, r._count._all]));
  }

  professionalCard(
    provider: CatalogProvider,
    pro: CatalogProfessional,
    extra: {
      rating?: { rating: number | null; count: number };
      completed?: number;
    } = {},
  ) {
    const offerings = provider.offerings.filter((o) => canPerform(pro, o));
    return {
      id: pro.id,
      providerId: provider.id,
      kind: provider.kind,
      label: homeProviderLabel(provider.kind, provider.salon?.name),
      salonName: provider.salon?.name ?? null,
      name: pro.displayName,
      photoUrl: pro.photoUrl,
      bio: pro.bio,
      yearsExperience: pro.yearsExperience,
      skills: pro.skills,
      languages: pro.languages.length ? pro.languages : provider.languages,
      city: provider.city,
      locality: provider.locality,
      online: pro.isOnline && provider.instantEnabled,
      instantEnabled: provider.instantEnabled,
      scheduledEnabled: provider.scheduledEnabled,
      badges: verifiedBadges(pro.verifications),
      rating: extra.rating?.rating ?? null,
      reviewCount: extra.rating?.count ?? 0,
      completedServices: extra.completed ?? 0,
      fromPaise: offerings.length
        ? Math.min(...offerings.map((o) => o.pricePaise))
        : null,
      services: offerings.map((o) => ({
        offeringId: o.id,
        code: o.serviceDef.code,
        name: o.title ?? o.serviceDef.name,
        nameHi: o.serviceDef.nameHi,
        categoryCode: o.serviceDef.category.code,
        pricePaise:
          o.pricePaise + Math.round((o.pricePaise * pro.priceUpliftPct) / 100),
        productPaise: o.productPaise + o.disposablePaise + o.equipmentPaise,
        durationMinutes: o.durationMinutes,
        variants: o.variants ?? [],
      })),
    };
  }

  async search(q: HomeSearchQuery) {
    const place: HomePlace = {
      postalCode: q.pincode,
      locality: q.locality,
      city: q.city,
      society: q.society,
      lat: q.lat ?? null,
      lng: q.lng ?? null,
    };
    let codes = q.service ? [q.service] : undefined;
    let groupCodes: Set<string> | null = null;
    if (q.q) {
      const defs = await this.prisma.homeServiceDef.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { name: { contains: q.q, mode: 'insensitive' } },
            { nameHi: { contains: q.q } },
            { synonyms: { has: q.q.toLowerCase() } },
          ],
        },
        select: { code: true },
      });
      groupCodes = new Set(defs.map((d) => d.code));
    }
    const covering = await this.providersCovering(place, {
      serviceCodes: codes,
      kind: q.kind,
    });
    const entries = covering.flatMap(({ provider }) =>
      provider.professionals.map((pro) => ({ provider, pro })),
    );
    const ids = entries.map((e) => e.pro.id);
    const [ratings, completed] = await Promise.all([
      this.ratingMap(ids),
      this.completedMap(ids),
    ]);
    const text = norm(q.q);
    let cards = entries
      .map(({ provider, pro }) =>
        this.professionalCard(provider, pro, {
          rating: ratings.get(pro.id),
          completed: completed.get(pro.id),
        }),
      )
      .filter((c) => {
        if (c.services.length === 0) return false;
        if (
          codes &&
          !codes.every((code) => c.services.some((s) => s.code === code))
        )
          return false;
        if (q.group && !c.services.some((s) => s.categoryCode === q.group))
          return false;
        if (
          q.language &&
          !c.languages.some((l) => norm(l) === norm(q.language))
        )
          return false;
        if (
          q.maxPricePaise != null &&
          !c.services.some(
            (s) =>
              s.pricePaise <= q.maxPricePaise! &&
              (!codes || codes.includes(s.code)),
          )
        )
          return false;
        if (
          text &&
          !norm(c.name).includes(text) &&
          !norm(c.salonName).includes(text) &&
          !c.services.some(
            (s) => norm(s.name).includes(text) || groupCodes!.has(s.code),
          )
        )
          return false;
        if (q.instant && !c.online) return false;
        return true;
      });
    codes = codes ?? [];
    const price = (c: (typeof cards)[number]) =>
      codes.length
        ? c.services
            .filter((s) => codes.includes(s.code))
            .reduce((s, x) => s + x.pricePaise + x.productPaise, 0)
        : (c.fromPaise ?? 0);
    const score = (c: (typeof cards)[number]) =>
      (c.rating ?? 0) * Math.min(1, c.reviewCount / 5) +
      Math.min(2, c.completedServices / 20) +
      (c.online ? 1 : 0);
    cards = cards.sort((a, b) =>
      q.sort === 'PRICE'
        ? price(a) - price(b)
        : q.sort === 'RATING'
          ? (b.rating ?? 0) - (a.rating ?? 0)
          : q.sort === 'FASTEST'
            ? Number(b.online) - Number(a.online)
            : score(b) - score(a),
    );
    const size = 20;
    return {
      total: cards.length,
      page: q.page,
      pageSize: size,
      items: cards.slice((q.page - 1) * size, q.page * size),
      salons: covering
        .filter((c) => c.provider.kind === 'SALON_MANAGED')
        .slice(0, 12)
        .map(({ provider }) => ({
          providerId: provider.id,
          name: provider.displayName,
          salonName: provider.salon?.name ?? null,
          locality: provider.locality,
          professionals: provider.professionals.length,
          fromPaise: provider.offerings.length
            ? Math.min(...provider.offerings.map((o) => o.pricePaise))
            : null,
        })),
    };
  }

  async loadProvider(providerId: string): Promise<CatalogProvider | null> {
    return this.prisma.homeProvider.findFirst({
      where: { id: providerId, status: 'APPROVED' },
      include: providerInclude,
    });
  }

  async professional(id: string) {
    const row = await this.prisma.homeProfessional.findFirst({
      where: {
        id,
        active: true,
        suspendedAt: null,
        consentAt: { not: null },
        provider: { status: 'APPROVED', paused: false },
      },
      select: { providerId: true, portfolioUrls: true },
    });
    const provider = row && (await this.loadProvider(row.providerId));
    const pro = provider?.professionals.find((p) => p.id === id);
    if (!provider || !pro || !providerKindEnabled(provider.kind))
      throw homeNotFound('Professional not found.');
    const [ratings, completed, reviews] = await Promise.all([
      this.ratingMap([id]),
      this.completedMap([id]),
      this.prisma.homeReview.findMany({
        where: { professionalId: id, status: 'PUBLISHED' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          overall: true,
          quality: true,
          behaviour: true,
          punctuality: true,
          hygiene: true,
          transparency: true,
          comment: true,
          response: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      ...this.professionalCard(provider, pro, {
        rating: ratings.get(id),
        completed: completed.get(id),
      }),
      portfolioUrls: row.portfolioUrls,
      coverage: provider.areas
        .filter((a) => !a.excluded)
        .map((a) =>
          a.kind === 'RADIUS'
            ? `Within ${a.radiusKm} km (straight line) of their base`
            : a.value,
        ),
      reviews,
    };
  }

  /** Landing page blocks - real rows only; empty blocks stay empty. */
  async landing(customerId: string | null) {
    const now = new Date();
    const kinds = (
      ['SALON_MANAGED', 'INDEPENDENT_PROFESSIONAL'] as const
    ).filter(providerKindEnabled);
    const [
      categories,
      popular,
      offers,
      packages,
      recent,
      favorites,
      societies,
    ] = await Promise.all([
      this.categories(),
      this.prisma.homeBookingItem.groupBy({
        by: ['serviceDefId'],
        where: {
          booking: {
            status: {
              in: [
                'COMPLETED',
                'PAYMENT_PENDING',
                'PAYMENT_CONFIRMED',
                'CLOSED',
              ],
            },
          },
        },
        _count: { _all: true },
        orderBy: { _count: { serviceDefId: 'desc' } },
        take: 8,
      }),
      this.prisma.homePromotion.findMany({
        where: {
          active: true,
          startsAt: { lte: now },
          endsAt: { gt: now },
          OR: [
            { providerId: null },
            {
              provider: {
                status: 'APPROVED',
                paused: false,
                kind: { in: [...kinds] },
              },
            },
          ],
        },
        select: {
          code: true,
          title: true,
          endsAt: true,
          provider: { select: { displayName: true } },
        },
        take: 8,
      }),
      this.prisma.homePackage.findMany({
        where: {
          active: true,
          provider: {
            status: 'APPROVED',
            paused: false,
            kind: { in: [...kinds] },
          },
        },
        include: {
          provider: { select: { id: true, displayName: true, kind: true } },
        },
        take: 12,
      }),
      customerId
        ? this.prisma.homeAssignment.findMany({
            where: { booking: { customerId }, status: 'COMPLETED' },
            orderBy: { assignedAt: 'desc' },
            distinct: ['professionalId'],
            take: 6,
            select: {
              professional: {
                select: { id: true, displayName: true, photoUrl: true },
              },
            },
          })
        : [],
      customerId
        ? this.prisma.homeFavorite.findMany({
            where: {
              userId: customerId,
              professional: { active: true, consentAt: { not: null } },
            },
            take: 12,
            select: {
              professional: {
                select: { id: true, displayName: true, photoUrl: true },
              },
            },
          })
        : [],
      this.prisma.homeCampaign.findMany({
        where: { status: 'OPEN', joinBy: { gt: now } },
        take: 6,
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          title: true,
          startsAt: true,
          minParticipants: true,
          discountPct: true,
          society: { select: { name: true, locality: true, city: true } },
        },
      }),
    ]);
    const defs = popular.length
      ? await this.prisma.homeServiceDef.findMany({
          where: { id: { in: popular.map((p) => p.serviceDefId) } },
          select: { id: true, code: true, name: true, nameHi: true },
        })
      : [];
    return {
      ...(await this.config()),
      categories,
      popular: popular.flatMap((p) =>
        defs.filter((d) => d.id === p.serviceDefId),
      ),
      offers: offers.map((o) => ({
        ...o,
        provider: o.provider?.displayName ?? 'FastQue',
      })),
      packages,
      recentProfessionals: recent.map((r) => r.professional),
      favorites: favorites.map((f) => f.professional),
      campaigns: societies,
    };
  }
}
