import { HttpStatus, Injectable } from '@nestjs/common';
import type { HomeAddress } from '@prisma/client';
import {
  HOME_TIME_ZONE,
  HomeErrorCode,
  computeHomeEta,
  computeHomePrice,
  homeProviderLabel,
  type HomeEta,
  type HomePrice,
  type HomeQuoteInput,
  type HomeSettings,
} from '@barbercue/shared';
import {
  utcToZonedDateStr,
  zonedDayAndMinutes,
  zonedWallTimeToUtc,
} from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { homeFlag, providerKindEnabled } from './home-config';
import {
  HomeAvailabilityService,
  type ProContext,
  type UnavailableReason,
  type VisitNeed,
} from './home-availability.service';
import {
  HomeCatalogService,
  canPerform,
  coveringArea,
  providerBase,
  verifiedBadges,
  type AreaLike,
  type CatalogProfessional,
  type CatalogProvider,
  type HomePlace,
} from './home-catalog.service';
import { HomeCoreService, addMin } from './home-core.service';
import { homeError, homeInvalid, homeNotFound } from './home-errors';
import { HomeRoutingService } from './home-routing.service';

type Offering = CatalogProvider['offerings'][number];
export interface ResolvedItem {
  offering: Offering;
  variantCode: string | null;
  name: string;
  quantity: number;
  personName: string | null;
  servicePaise: number;
  durationMinutes: number;
}
export interface QuoteOption {
  provider: CatalogProvider;
  pro: CatalogProfessional;
  area: AreaLike;
  items: ResolvedItem[];
  need: VisitNeed;
  serviceStart: Date;
  serviceEnd: Date;
  price: HomePrice;
  eta: HomeEta;
  etaBasis: Record<string, unknown>;
  travelMinutes: number;
  reasons: string[];
  rating: number | null;
  reviewCount: number;
  promotionId: string | null;
}
export interface QuoteResult {
  address: HomePlace & { contactPhone?: string | null };
  options: QuoteOption[];
  rejected: { reason: UnavailableReason | 'PRICE'; count: number }[];
  settings: HomeSettings;
}

export const REASON_TEXT: Record<string, string> = {
  INACTIVE: 'Not currently working',
  OFF_HOURS: 'Outside working hours',
  BUSY: 'Already booked',
  SALON_CUSTOMER: 'Serving a salon customer',
  WORK_SHIFT: 'On a FastQue Work shift',
  SALON_SHIFT: 'On a salon shift',
  TRAVEL: 'Cannot reach you in time',
  MAX_PER_DAY: 'Fully booked that day',
  CAPACITY: 'The salon needs its staff in the shop at that time',
  QUEUE_DEMAND: 'The salon queue is busy',
  PEAK_RESTRICTED: 'The salon does not offer home visits at that time',
  TRAVEL_LIMIT: 'Too far for this professional',
  PRICE: 'Below the minimum booking value',
};

/** One priced, feasible plan per eligible professional. Nothing here reserves time. */
@Injectable()
export class HomeQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: HomeCoreService,
    private readonly catalog: HomeCatalogService,
    private readonly availability: HomeAvailabilityService,
    private readonly routing: HomeRoutingService,
  ) {}

  async resolvePlace(
    q: HomeQuoteInput,
    customerId: string | null,
  ): Promise<HomePlace> {
    const a = q.addressId
      ? await this.ownedAddress(q.addressId, customerId)
      : q.address!;
    return {
      postalCode: a.postalCode,
      locality: a.locality,
      city: a.city,
      society: a.building ?? null,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
    };
  }

  async ownedAddress(
    id: string,
    customerId: string | null,
  ): Promise<HomeAddress> {
    const row = customerId
      ? await this.prisma.homeAddress.findFirst({
          where: { id, userId: customerId, archivedAt: null },
        })
      : null;
    if (!row) throw homeNotFound('Address not found.');
    return row;
  }

  /** Maps the customer's items onto this provider's own offers; null when it does not offer one of them. */
  resolveItems(
    provider: CatalogProvider,
    pro: CatalogProfessional,
    q: HomeQuoteInput,
  ): ResolvedItem[] | null {
    const out: ResolvedItem[] = [];
    for (const item of q.items) {
      const offering = provider.offerings.find((o) =>
        item.offeringId
          ? o.id === item.offeringId
          : o.serviceDef.code === item.serviceCode,
      );
      // Another provider's offeringId falls back to the same catalogue service when alternatives are searched.
      if (!offering || !canPerform(pro, offering)) return null;
      const variants =
        (offering.variants as
          | {
              code: string;
              name: string;
              pricePaise: number;
              durationMinutes: number;
            }[]
          | null) ?? [];
      const variant = item.variantCode
        ? variants.find((v) => v.code === item.variantCode)
        : null;
      if (item.variantCode && !variant) return null;
      out.push({
        offering,
        variantCode: variant?.code ?? null,
        name:
          (offering.title ?? offering.serviceDef.name) +
          (variant ? ` – ${variant.name}` : ''),
        quantity: item.quantity,
        personName: item.personName ?? null,
        servicePaise: variant?.pricePaise ?? offering.pricePaise,
        durationMinutes: variant?.durationMinutes ?? offering.durationMinutes,
      });
    }
    return out;
  }

  needOf(items: ResolvedItem[], place: HomePlace, instant: boolean): VisitNeed {
    return {
      // One professional works sequentially: durations add up, prep and cleanup happen once.
      serviceMinutes: items.reduce(
        (s, i) => s + i.durationMinutes * i.quantity,
        0,
      ),
      prepMinutes: Math.max(
        ...items.map((i) => i.offering.serviceDef.prepMinutes),
      ),
      cleanupMinutes: Math.max(
        ...items.map((i) => i.offering.serviceDef.cleanupMinutes),
      ),
      location: place,
      instant,
    };
  }

  private async promo(code: string | undefined, providerId: string, now: Date) {
    if (!code) return null;
    const p = await this.prisma.homePromotion.findUnique({ where: { code } });
    if (
      !p ||
      !p.active ||
      p.startsAt > now ||
      p.endsAt <= now ||
      (p.providerId && p.providerId !== providerId)
    )
      return null;
    if (p.maxUses != null) {
      const used = await this.prisma.homeBooking.count({
        where: {
          promotionId: p.id,
          status: {
            notIn: [
              'EXPIRED',
              'NO_PROFESSIONAL',
              'CANCELLED_BY_CUSTOMER',
              'CANCELLED_BY_PROFESSIONAL',
              'CANCELLED_BY_SALON',
              'CANCELLED_BY_PLATFORM',
            ],
          },
        },
      });
      if (used >= p.maxUses) return null;
    }
    return p;
  }

  async price(
    provider: CatalogProvider,
    pro: CatalogProfessional,
    area: AreaLike,
    items: ResolvedItem[],
    serviceStart: Date,
    q: Pick<HomeQuoteInput, 'promoCode' | 'packageId'>,
    campaignDiscountPct = 0,
  ): Promise<{
    price: HomePrice;
    promotionId: string | null;
    minOrderOk: boolean;
  }> {
    const local = zonedDayAndMinutes(serviceStart, HOME_TIME_ZONE);
    const mins = (v: string | null) =>
      v ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null;
    const from = mins(provider.peakStart);
    const to = mins(provider.peakEnd);
    const promo = await this.promo(q.promoCode, provider.id, new Date());
    let packageDiscountPaise = 0;
    if (q.packageId) {
      const pkg = await this.prisma.homePackage.findFirst({
        where: { id: q.packageId, providerId: provider.id, active: true },
      });
      const ids = items.map((i) => i.offering.id);
      if (
        pkg &&
        pkg.offeringIds.length === ids.length &&
        pkg.offeringIds.every((id) => ids.includes(id))
      ) {
        const sum = items.reduce((s, i) => s + i.servicePaise * i.quantity, 0);
        packageDiscountPaise = Math.max(0, sum - pkg.pricePaise);
      }
    }
    const base = {
      items: items.map((i) => ({
        name: i.name,
        servicePaise: i.servicePaise,
        productPaise: i.offering.productPaise,
        disposablePaise: i.offering.disposablePaise,
        equipmentPaise: i.offering.equipmentPaise,
        quantity: i.quantity,
      })),
      travelPaise: provider.travelFeePaise,
      areaSurchargePaise: area.surchargePaise,
      upliftPct: pro.priceUpliftPct,
      weekend: local.dayOfWeek === 0 || local.dayOfWeek === 6,
      weekendPct: provider.weekendSurchargePct,
      peak:
        from != null &&
        to != null &&
        local.minutes >= from &&
        local.minutes < to,
      peakPct: provider.peakSurchargePct,
      groupDiscountPct: provider.groupDiscountPct,
      groupDiscountMin: provider.groupDiscountMin,
      packageDiscountPaise,
      campaignDiscountPct,
    };
    const gross = computeHomePrice(base).servicePaise;
    const usable = promo && gross >= promo.minOrderPaise ? promo : null;
    const price = computeHomePrice({
      ...base,
      promo: usable
        ? {
            code: usable.code,
            percentOff: usable.percentOff,
            amountOffPaise: usable.amountOffPaise,
          }
        : null,
    });
    const min = Math.max(provider.minOrderPaise, area.minOrderPaise);
    return {
      price,
      promotionId: usable?.id ?? null,
      minOrderOk: price.servicePaise >= min,
    };
  }

  async quote(
    q: HomeQuoteInput,
    customerId: string | null,
    opts: {
      excludeBookingId?: string;
      excludeProfessionalIds?: string[];
      excludeHoldIds?: string[];
      maxTotalPaise?: number;
      place?: HomePlace;
      /** Continuing an existing booking: flags and lead-time rules for NEW bookings do not apply. */
      internal?: boolean;
    } = {},
  ): Promise<QuoteResult> {
    const settings = await this.core.settings();
    const now = new Date();
    if (
      !opts.internal &&
      q.mode === 'INSTANT' &&
      !homeFlag('HOME_INSTANT_BOOKING_ENABLED')
    )
      throw homeError(
        HomeErrorCode.DISABLED,
        'Instant home booking is not available yet.',
        HttpStatus.NOT_FOUND,
      );
    if (
      !opts.internal &&
      q.mode === 'SCHEDULED' &&
      !homeFlag('HOME_SCHEDULED_BOOKING_ENABLED')
    )
      throw homeError(
        HomeErrorCode.DISABLED,
        'Scheduled home booking is not available yet.',
        HttpStatus.NOT_FOUND,
      );
    const startAt = q.startAt ? new Date(q.startAt) : null;
    if (q.mode === 'SCHEDULED' && !opts.internal) {
      if (startAt! < addMin(now, settings.minScheduledLeadMinutes))
        throw homeInvalid(
          `Choose a time at least ${settings.minScheduledLeadMinutes} minutes from now.`,
        );
      if (startAt! > addMin(now, settings.maxDaysAhead * 1440))
        throw homeInvalid(
          `Bookings open up to ${settings.maxDaysAhead} days ahead.`,
        );
    }
    const place = opts.place ?? (await this.resolvePlace(q, customerId));
    let covering: { provider: CatalogProvider; area: AreaLike }[];
    if (q.preference === 'FASTEST') {
      const ids = q.items
        .map((i) => i.offeringId)
        .filter((v): v is string => !!v);
      const defs = ids.length
        ? await this.prisma.homeOffering.findMany({
            where: { id: { in: ids } },
            select: { id: true, serviceDef: { select: { code: true } } },
          })
        : [];
      // Search every provider by catalogue service, not by one provider's offer id.
      q = {
        ...q,
        items: q.items.map((i) => ({
          ...i,
          offeringId: undefined,
          variantCode: undefined,
          serviceCode:
            i.serviceCode ??
            defs.find((d) => d.id === i.offeringId)?.serviceDef.code ??
            '-',
        })),
      };
      covering = await this.catalog.providersCovering(place, {
        serviceCodes: [...new Set(q.items.map((i) => i.serviceCode!))],
      });
    } else {
      let providerId = q.providerId;
      if (q.preference === 'SPECIFIC_PROFESSIONAL') {
        const row = await this.prisma.homeProfessional.findUnique({
          where: { id: q.professionalId! },
          select: { providerId: true },
        });
        if (!row) throw homeNotFound('Professional not found.');
        providerId = row.providerId;
      }
      const provider = await this.catalog.loadProvider(providerId!);
      if (
        !provider ||
        (!opts.internal &&
          (!providerKindEnabled(provider.kind) || provider.paused))
      )
        throw homeNotFound('This provider is not taking home bookings now.');
      const area = coveringArea(provider.areas, providerBase(provider), place);
      if (!area)
        throw homeError(
          HomeErrorCode.NOT_SERVICEABLE,
          'This provider does not serve that address.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      covering = [{ provider, area }];
    }
    if (covering.length === 0)
      throw homeError(
        HomeErrorCode.NOT_SERVICEABLE,
        'No home-service provider covers this address for the selected services yet.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const blocked = customerId
      ? await this.prisma.homeBlock.findMany({
          where: {
            OR: [{ blockerUserId: customerId }, { blockedUserId: customerId }],
          },
        })
      : [];
    const blockedUsers = new Set(
      blocked.flatMap((b) => [b.blockerUserId, b.blockedUserId]),
    );
    const candidates = covering.flatMap(({ provider, area }) =>
      provider.professionals
        .filter(
          (p) =>
            (q.preference !== 'SPECIFIC_PROFESSIONAL' ||
              p.id === q.professionalId) &&
            !opts.excludeProfessionalIds?.includes(p.id) &&
            !blockedUsers.has(p.userId) &&
            p.userId !== customerId &&
            (q.mode === 'SCHEDULED'
              ? provider.scheduledEnabled
              : provider.instantEnabled && p.isOnline),
        )
        .map((pro) => ({
          provider,
          area,
          pro,
          items: this.resolveItems(provider, pro, q),
        })),
    );
    const able = candidates.filter((c) => c.items !== null);
    if (candidates.length > 0 && able.length === 0) {
      // Say which services one person cannot combine, so the customer can split knowingly.
      const all = covering.flatMap((c) =>
        c.provider.professionals.map((p) => ({ p, provider: c.provider })),
      );
      throw homeInvalid(
        'One professional cannot perform all selected services. Please book them as separate appointments.',
        {
          splitRequired: true,
          perService: q.items.map((i) => ({
            serviceCode: i.serviceCode ?? null,
            offeringId: i.offeringId ?? null,
            professionals: all.filter(({ p, provider }) =>
              this.resolveItems(provider, p, { ...q, items: [i] }),
            ).length,
          })),
        },
      );
    }
    // Road answers (or the fallback) are fetched once, in parallel, before the pure evaluation.
    const limited = able.slice(0, 60);
    const anchor = startAt ?? now;
    const contexts = await this.availability.load(
      this.prisma,
      limited.map((c) => c.pro.id),
      addMin(anchor, -180),
      addMin(anchor, settings.maxInstantLeadMinutes + 480),
      { bookingId: opts.excludeBookingId, holdIds: opts.excludeHoldIds },
    );
    const travel = await Promise.all(
      limited.map((c) =>
        this.routing.travel(
          providerBase(c.provider),
          place,
          c.provider.travelMode,
        ),
      ),
    );
    const ids = limited.map((c) => c.pro.id);
    const [ratings, completed, history, prior, favorites] = await Promise.all([
      this.catalog.ratingMap(ids),
      this.catalog.completedMap(ids),
      this.prisma.homeVisitMetric.groupBy({
        by: ['professionalId'],
        where: { professionalId: { in: ids } },
        _count: { _all: true },
        _avg: { etaErrorMinutes: true },
      }),
      customerId
        ? this.prisma.homeAssignment.findMany({
            where: {
              booking: { customerId },
              status: 'COMPLETED',
              professionalId: { in: ids },
            },
            select: { professionalId: true },
            distinct: ['professionalId'],
          })
        : [],
      customerId
        ? this.prisma.homeFavorite.findMany({
            where: { userId: customerId, professionalId: { in: ids } },
          })
        : [],
    ]);
    const rejected = new Map<UnavailableReason | 'PRICE', number>();
    const reject = (r: UnavailableReason | 'PRICE') =>
      rejected.set(r, (rejected.get(r) ?? 0) + 1);
    const options: QuoteOption[] = [];
    for (let i = 0; i < limited.length; i += 1) {
      const c = limited[i];
      const ctx = contexts.get(c.pro.id) as ProContext;
      const items = c.items!;
      const need = this.needOf(items, place, q.mode === 'INSTANT');
      let serviceStart: Date;
      let availableFrom = now;
      let travelMinutes = travel[i].minutes;
      if (q.mode === 'INSTANT') {
        const e = this.availability.earliest(ctx, need, {
          accessBuffer: settings.accessBufferMinutes,
          maxLeadMinutes: settings.maxInstantLeadMinutes,
          now,
        });
        if (!e) {
          const probe = this.availability.evaluate(
            ctx,
            need,
            addMin(
              now,
              travelMinutes + need.prepMinutes + settings.accessBufferMinutes,
            ),
            now,
          );
          reject(probe.reason ?? 'BUSY');
          continue;
        }
        serviceStart = e.serviceStart;
        availableFrom = e.availableFrom;
        travelMinutes = e.evaluation.travelMinutes;
      } else {
        const ev = this.availability.evaluate(ctx, need, startAt!, now);
        if (!ev.ok) {
          reject(ev.reason!);
          continue;
        }
        serviceStart = startAt!;
        travelMinutes = ev.travelMinutes;
      }
      const priced = await this.price(
        c.provider,
        c.pro,
        c.area,
        items,
        serviceStart,
        q,
      );
      if (
        !priced.minOrderOk ||
        (opts.maxTotalPaise != null &&
          priced.price.totalPaise > opts.maxTotalPaise)
      ) {
        reject('PRICE');
        continue;
      }
      const h = history.find((x) => x.professionalId === c.pro.id);
      const eta =
        q.mode === 'INSTANT'
          ? computeHomeEta({
              now,
              availableFrom,
              prepMinutes: need.prepMinutes,
              travelMinutes,
              travelSource: travel[i].source,
              accessBufferMinutes: settings.accessBufferMinutes,
              serviceMinutes: need.serviceMinutes,
              cleanupMinutes: need.cleanupMinutes,
              historySamples: h?._count._all ?? 0,
            })
          : {
              departure: addMin(
                serviceStart,
                -(travelMinutes + need.prepMinutes),
              ),
              arrival: serviceStart,
              windowFrom: addMin(serviceStart, -5),
              windowTo: addMin(serviceStart, 15),
              completion: addMin(
                serviceStart,
                need.serviceMinutes + need.cleanupMinutes,
              ),
              confidence: travel[i].source.startsWith('ROAD')
                ? ('MEDIUM' as const)
                : ('LOW' as const),
              approximate: !travel[i].source.startsWith('ROAD'),
            };
      const r = ratings.get(c.pro.id);
      options.push({
        provider: c.provider,
        pro: c.pro,
        area: c.area,
        items,
        need,
        serviceStart,
        serviceEnd: addMin(serviceStart, need.serviceMinutes),
        price: priced.price,
        promotionId: priced.promotionId,
        eta,
        etaBasis: {
          source: travel[i].source,
          travelMinutes,
          prepMinutes: need.prepMinutes,
          accessBufferMinutes: settings.accessBufferMinutes,
          availableFrom: availableFrom.toISOString(),
          historySamples: h?._count._all ?? 0,
          // Present only when a routing provider gave a real road distance.
          roadKm: travel[i].roadKm,
        },
        travelMinutes,
        reasons: [],
        rating: r?.rating ?? null,
        reviewCount: r?.count ?? 0,
      });
    }
    this.rank(
      options,
      q.mode === 'INSTANT',
      completed,
      new Set(prior.map((p) => p.professionalId)),
      new Set(favorites.map((f) => f.professionalId)),
    );
    return {
      address: place,
      options,
      rejected: [...rejected].map(([reason, count]) => ({ reason, count })),
      settings,
    };
  }

  /** Explainable ranking: every reason shown is a fact about this result set. No personal traits, no paid boost. */
  private rank(
    options: QuoteOption[],
    instant: boolean,
    completed: Map<string, number>,
    prior: Set<string>,
    favorites: Set<string>,
  ) {
    if (options.length === 0) return;
    const minTotal = Math.min(...options.map((o) => o.price.totalPaise));
    const minArrival = Math.min(...options.map((o) => o.eta.arrival.getTime()));
    const minTravel = Math.min(...options.map((o) => o.travelMinutes));
    const score = (o: QuoteOption) =>
      (instant
        ? (o.eta.arrival.getTime() - minArrival) / 60_000
        : o.travelMinutes - minTravel) +
      ((o.price.totalPaise - minTotal) / Math.max(1, minTotal)) * 40 -
      (o.reviewCount >= 3 ? ((o.rating ?? 0) - 3) * 4 : 0) -
      Math.min(5, (completed.get(o.pro.id) ?? 0) / 10) -
      (favorites.has(o.pro.id) ? 12 : 0) -
      (prior.has(o.pro.id) ? 8 : 0);
    options.sort(
      (a, b) => score(a) - score(b) || a.pro.id.localeCompare(b.pro.id),
    );
    for (const o of options) {
      if (
        options.length > 1 &&
        instant &&
        o.eta.arrival.getTime() === minArrival
      )
        o.reasons.push('Fastest available');
      if (prior.has(o.pro.id)) o.reasons.push('Previously booked');
      if (favorites.has(o.pro.id)) o.reasons.push('Your favourite');
      if (options.length > 1 && o.price.totalPaise === minTotal)
        o.reasons.push('Lowest total price');
      if (o.reviewCount >= 3 && (o.rating ?? 0) >= 4.5)
        o.reasons.push('Highly rated');
      if (options.length > 1 && o.travelMinutes === minTravel)
        o.reasons.push('Shortest estimated travel');
      if (o.reasons.length === 0) o.reasons.push('Available and eligible');
    }
  }

  /** Public shape: no provider base location, no private contact. */
  dto(result: QuoteResult) {
    return {
      options: result.options.slice(0, 12).map((o) => this.optionDto(o)),
      unavailable: result.rejected.map((r) => ({
        reason: r.reason,
        text: REASON_TEXT[r.reason],
        count: r.count,
      })),
      policies: {
        cancellation: result.settings.cancellationPolicy,
        cancellationHi: result.settings.cancellationPolicyHi,
        reService: result.settings.reServicePolicy,
      },
    };
  }

  optionDto(o: QuoteOption) {
    return {
      professionalId: o.pro.id,
      professionalName: o.pro.displayName,
      photoUrl: o.pro.photoUrl,
      providerId: o.provider.id,
      providerName: o.provider.displayName,
      kind: o.provider.kind,
      label: homeProviderLabel(o.provider.kind, o.provider.salon?.name),
      rating: o.rating,
      reviewCount: o.reviewCount,
      badges: verifiedBadges(o.pro.verifications),
      serviceStart: o.serviceStart.toISOString(),
      serviceEnd: o.serviceEnd.toISOString(),
      durationMinutes: o.need.serviceMinutes,
      eta: {
        from: o.eta.windowFrom.toISOString(),
        to: o.eta.windowTo.toISOString(),
        confidence: o.eta.confidence,
        approximate: o.eta.approximate,
        roadKm: (o.etaBasis.roadKm as number | null) ?? null,
      },
      price: o.price,
      reasons: o.reasons,
      paymentCollectedBy: o.provider.displayName,
      invoiceIssuedBy: o.provider.invoiceIssuer ?? o.provider.displayName,
      upiVpa: o.provider.upiVpa ? true : false,
      items: o.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        durationMinutes: i.durationMinutes,
        safety: i.offering.serviceDef.safetyInstructions,
        preparation: i.offering.serviceDef.customerPreparation,
        customerProducts: i.offering.serviceDef.customerProducts,
        productNotes: i.offering.serviceDef.productNotes,
        eligibility: i.offering.serviceDef.eligibility,
      })),
    };
  }

  /** Dynamically generated start times for one local day. Nothing is listed unless someone can really do it. */
  async slots(
    q: Omit<HomeQuoteInput, 'startAt' | 'mode'>,
    date: string,
    customerId: string | null,
  ) {
    if (!homeFlag('HOME_SCHEDULED_BOOKING_ENABLED'))
      throw homeError(
        HomeErrorCode.DISABLED,
        'Scheduled home booking is not available yet.',
        HttpStatus.NOT_FOUND,
      );
    const settings = await this.core.settings();
    const place = await this.resolvePlace(q as HomeQuoteInput, customerId);
    const dayStart = zonedWallTimeToUtc(date, '00:00', HOME_TIME_ZONE);
    if (!dayStart) throw homeInvalid('Choose a valid date.');
    const now = new Date();
    const codes = q.items
      .map((i) => i.serviceCode)
      .filter((v): v is string => !!v);
    let covering = await this.catalog.providersCovering(place, {
      providerId:
        q.preference === 'SPECIFIC_PROVIDER' ? q.providerId : undefined,
      serviceCodes:
        q.preference === 'FASTEST' && codes.length === q.items.length
          ? codes
          : undefined,
    });
    if (q.preference === 'SPECIFIC_PROFESSIONAL')
      covering = covering.filter((c) =>
        c.provider.professionals.some((p) => p.id === q.professionalId),
      );
    const cands = covering
      .flatMap(({ provider }) =>
        provider.professionals
          .filter(
            (p) =>
              provider.scheduledEnabled &&
              (q.preference !== 'SPECIFIC_PROFESSIONAL' ||
                p.id === q.professionalId) &&
              p.userId !== customerId,
          )
          .map((pro) => ({
            provider,
            pro,
            items: this.resolveItems(provider, pro, q as HomeQuoteInput),
          })),
      )
      .filter((c) => c.items)
      .slice(0, 40);
    await Promise.all(
      cands.map((c) =>
        this.routing.travel(
          providerBase(c.provider),
          place,
          c.provider.travelMode,
        ),
      ),
    );
    const contexts = await this.availability.load(
      this.prisma,
      cands.map((c) => c.pro.id),
      dayStart,
      addMin(dayStart, 1440),
    );
    const slots: { startAt: string; available: number }[] = [];
    for (let m = 0; m < 1440; m += 30) {
      const at = addMin(dayStart, m);
      if (
        at < addMin(now, settings.minScheduledLeadMinutes) ||
        at > addMin(now, settings.maxDaysAhead * 1440)
      )
        continue;
      const available = cands.filter(
        (c) =>
          this.availability.evaluate(
            contexts.get(c.pro.id)!,
            this.needOf(c.items!, place, false),
            at,
            now,
          ).ok,
      ).length;
      if (available > 0) slots.push({ startAt: at.toISOString(), available });
    }
    return {
      date: utcToZonedDateStr(dayStart, HOME_TIME_ZONE),
      timeZone: HOME_TIME_ZONE,
      slots,
    };
  }
}
