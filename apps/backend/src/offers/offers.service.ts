import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingSource,
  OfferErrorCode,
  computePercentageDiscountPaise,
  decimalStringToPaise,
  paiseToRupees,
  paiseToDecimalString,
  type CreateOfferInput,
  type OfferDto,
  type OfferPreviewDto,
  type OfferRedemptionStatsDto,
  type OfferListQuery,
  type PublicOfferDto,
  type PublicOfferQuery,
  type UpdateOfferInput,
  createOfferSchema,
} from '@barbercue/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';

type OffersDb = Prisma.TransactionClient | PrismaService;
type ServicePrice = { id: string; name: string; price: Prisma.Decimal };
type OfferWithRelations = Prisma.OfferGetPayload<{
  include: {
    services: { select: { serviceId: true } };
    _count: { select: { redemptions: true } };
  };
}>;

const publicOfferInclude = {
  services: {
    include: {
      service: {
        select: { id: true, name: true, price: true, isActive: true },
      },
    },
  },
  salon: {
    select: {
      id: true,
      name: true,
      slug: true,
      currency: true,
      city: { select: { name: true, slug: true, countryCode: true } },
    },
  },
  _count: { select: { redemptions: true } },
} satisfies Prisma.OfferInclude;

type PublicOfferWithRelations = Prisma.OfferGetPayload<{
  include: typeof publicOfferInclude;
}>;

export interface LockedOfferApplication {
  offerId: string;
  title: string;
  currency: string;
  percent: number;
  discountAmountPaise: number;
  updatedAt: Date;
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async listForOwner(
    actorUserId: string,
    salonId: string,
    query: OfferListQuery,
  ): Promise<{ items: OfferDto[]; nextCursor: string | null }> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const rows = await this.prisma.offer.findMany({
      where: {
        salonId,
        ...(query.status === 'EXPIRED'
          ? { status: 'ACTIVE', validTo: { lte: new Date() } }
          : query.status === 'ACTIVE'
            ? { status: 'ACTIVE', validTo: { gt: new Date() } }
            : query.status
              ? { status: query.status }
              : {}),
        ...(query.kind ? { kind: query.kind } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        services: { select: { serviceId: true } },
        _count: { select: { redemptions: true } },
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => this.toDto(row)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async getForOwner(
    actorUserId: string,
    salonId: string,
    offerId: string,
  ): Promise<OfferDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const row = await this.getOffer(this.prisma, salonId, offerId);
    if (!row) this.notFound();
    return this.toDto(row);
  }

  async create(
    actorUserId: string,
    salonId: string,
    input: CreateOfferInput,
  ): Promise<OfferDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const parsed = createOfferSchema.safeParse(input);
    if (!parsed.success)
      this.invalid(
        parsed.error.issues[0]?.message ?? 'Offer fields are invalid.',
      );
    const created = await this.prisma.$transaction(async (tx) => {
      const salon = await tx.salon.findUnique({
        where: { id: salonId },
        select: { currency: true },
      });
      if (!salon) this.notFound('Shop not found.');
      await this.assertServices(tx, salonId, parsed.data.serviceIds);
      const row = await tx.offer.create({
        data: {
          salonId,
          kind: parsed.data.kind,
          status: 'DRAFT',
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          discountType: parsed.data.discountType,
          // Persist the declared percentage or flat currency amount as-is.
          discountValue: parsed.data.discountValue.toFixed(2),
          currency: (salon.currency ?? 'INR').toUpperCase(),
          audience: parsed.data.audience,
          inactiveDays: parsed.data.inactiveDays ?? null,
          validFrom: new Date(parsed.data.validFrom),
          validTo: new Date(parsed.data.validTo),
          maxRedemptions: parsed.data.maxRedemptions ?? null,
          perCustomerLimit: parsed.data.perCustomerLimit,
          createdByUserId: actorUserId,
        },
      });
      if (parsed.data.serviceIds.length) {
        await tx.offerService.createMany({
          data: parsed.data.serviceIds.map((serviceId) => ({
            salonId,
            offerId: row.id,
            serviceId,
          })),
        });
      }
      await this.audit(tx, actorUserId, 'OFFER_DRAFT_CREATED', row.id, {
        salonId,
        kind: row.kind,
        discountType: row.discountType,
        serviceCount: parsed.data.serviceIds.length,
      });
      return this.getOffer(tx, salonId, row.id);
    });
    return this.toDto(created!);
  }

  async update(
    actorUserId: string,
    salonId: string,
    offerId: string,
    input: UpdateOfferInput,
  ): Promise<OfferDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOffer(tx, salonId, offerId);
      if (current.status === 'ACTIVE')
        this.fail(
          OfferErrorCode.MUST_PAUSE_TO_EDIT,
          'Pause this offer before editing it.',
          HttpStatus.CONFLICT,
        );
      const existingServices = (
        await tx.offerService.findMany({
          where: { salonId, offerId },
          select: { serviceId: true },
        })
      ).map((x) => x.serviceId);
      const merged = {
        kind: input.kind ?? current.kind,
        title: input.title ?? current.title,
        description:
          input.description === undefined
            ? current.description
            : input.description,
        discountType: input.discountType ?? current.discountType,
        discountValue: input.discountValue ?? Number(current.discountValue),
        audience: input.audience ?? current.audience,
        inactiveDays:
          input.inactiveDays !== undefined
            ? input.inactiveDays
            : input.audience !== undefined && input.audience !== 'INACTIVE'
              ? undefined
              : (current.inactiveDays ?? undefined),
        validFrom: input.validFrom ?? current.validFrom.toISOString(),
        validTo: input.validTo ?? current.validTo.toISOString(),
        maxRedemptions:
          input.maxRedemptions === undefined
            ? current.maxRedemptions
            : input.maxRedemptions,
        perCustomerLimit: input.perCustomerLimit ?? current.perCustomerLimit,
        serviceIds: input.serviceIds ?? existingServices,
      };
      const parsed = createOfferSchema.safeParse(merged);
      if (!parsed.success)
        this.invalid(
          parsed.error.issues[0]?.message ?? 'Offer fields are invalid.',
        );
      await this.assertServices(tx, salonId, parsed.data.serviceIds);
      await tx.offer.update({
        where: { id: offerId },
        data: {
          kind: parsed.data.kind,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          discountType: parsed.data.discountType,
          discountValue: String(parsed.data.discountValue.toFixed(2)),
          audience: parsed.data.audience,
          inactiveDays: parsed.data.inactiveDays ?? null,
          validFrom: new Date(parsed.data.validFrom),
          validTo: new Date(parsed.data.validTo),
          maxRedemptions: parsed.data.maxRedemptions ?? null,
          perCustomerLimit: parsed.data.perCustomerLimit,
        },
      });
      if (input.serviceIds !== undefined) {
        await tx.offerService.deleteMany({ where: { salonId, offerId } });
        if (parsed.data.serviceIds.length) {
          await tx.offerService.createMany({
            data: parsed.data.serviceIds.map((serviceId) => ({
              salonId,
              offerId,
              serviceId,
            })),
          });
        }
      }
      await this.audit(tx, actorUserId, 'OFFER_DRAFT_UPDATED', offerId, {
        salonId,
        changedFields: Object.keys(input).sort(),
      });
      return this.getOffer(tx, salonId, offerId);
    });
    return this.toDto(row!);
  }

  async publish(
    actorUserId: string,
    salonId: string,
    offerId: string,
  ): Promise<OfferDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOffer(tx, salonId, offerId);
      const now = new Date();
      if (current.validTo <= now || current.validTo <= current.validFrom) {
        this.fail(
          OfferErrorCode.NOT_PUBLISHABLE,
          'The offer validity window has ended or is invalid.',
          HttpStatus.CONFLICT,
        );
      }
      const serviceLinks = await tx.offerService.count({
        where: { salonId, offerId },
      });
      const activeServiceCount = await tx.service.count({
        where: { salonId, isActive: true },
      });
      if (
        (serviceLinks === 0 && activeServiceCount === 0) ||
        (serviceLinks > 0 &&
          serviceLinks !==
            (await tx.offerService.count({
              where: { salonId, offerId, service: { isActive: true } },
            })))
      ) {
        this.fail(
          OfferErrorCode.NOT_PUBLISHABLE,
          'Select at least one active service for this offer.',
          HttpStatus.CONFLICT,
        );
      }
      if (current.status === 'ACTIVE')
        return this.getOffer(tx, salonId, offerId);
      const updated = await tx.offer.update({
        where: { id: offerId },
        data: { status: 'ACTIVE' },
      });
      await this.audit(tx, actorUserId, 'OFFER_PUBLISHED', offerId, {
        salonId,
        kind: updated.kind,
        validFrom: updated.validFrom.toISOString(),
        validTo: updated.validTo.toISOString(),
      });
      return this.getOffer(tx, salonId, offerId);
    });
    return this.toDto(row!);
  }

  async pause(
    actorUserId: string,
    salonId: string,
    offerId: string,
  ): Promise<OfferDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockOffer(tx, salonId, offerId);
      if (current.status !== 'PAUSED') {
        await tx.offer.update({
          where: { id: offerId },
          data: { status: 'PAUSED' },
        });
        await this.audit(tx, actorUserId, 'OFFER_PAUSED', offerId, {
          salonId,
          wasActive: current.status === 'ACTIVE',
        });
      }
      return this.getOffer(tx, salonId, offerId);
    });
    return this.toDto(row!);
  }

  async previewDraft(
    actorUserId: string,
    salonId: string,
    input: CreateOfferInput,
  ): Promise<OfferPreviewDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const parsed = createOfferSchema.safeParse(input);
    if (!parsed.success)
      this.invalid(
        parsed.error.issues[0]?.message ?? 'Offer fields are invalid.',
      );
    const [salon, services] = await Promise.all([
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { currency: true },
      }),
      this.loadServices(this.prisma, salonId, parsed.data.serviceIds),
    ]);
    if (!salon) this.notFound('Shop not found.');
    if (parsed.data.serviceIds.length) {
      this.assertFoundServiceIds(services, parsed.data.serviceIds);
    } else if (services.length === 0) {
      this.fail(
        OfferErrorCode.SERVICE_MISMATCH,
        'There are no active services to preview for this shop.',
        HttpStatus.BAD_REQUEST,
      );
    } else if (services.length > 100) {
      this.fail(
        OfferErrorCode.INVALID,
        'This shop has more than 100 active services. Select a bounded set to preview.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.toPreview(
      null,
      parsed.data,
      services,
      salon.currency ?? 'INR',
      null,
    );
  }

  async previewSaved(
    actorUserId: string,
    salonId: string,
    offerId: string,
    input: { serviceIds: string[] },
  ): Promise<OfferPreviewDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const offer = await this.getOffer(this.prisma, salonId, offerId);
    if (!offer) this.notFound();
    const services = await this.loadServices(
      this.prisma,
      salonId,
      input.serviceIds,
    );
    this.assertFoundServiceIds(services, input.serviceIds);
    const allowed = offer.services.map((x) => x.serviceId);
    if (
      allowed.length &&
      input.serviceIds.some((id) => !allowed.includes(id))
    ) {
      this.fail(
        OfferErrorCode.SERVICE_MISMATCH,
        'One or more selected services are outside this offer.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.toPreview(offer.id, offer, services, offer.currency, null);
  }

  async stats(
    actorUserId: string,
    salonId: string,
    offerId: string,
  ): Promise<OfferRedemptionStatsDto> {
    await this.salonAccess.assertOwnerAccess(actorUserId, salonId);
    const offer = await this.getOffer(this.prisma, salonId, offerId);
    if (!offer) this.notFound();
    const [aggregate, customers, completedBookings, cancelledBookings] =
      await Promise.all([
        this.prisma.offerRedemption.aggregate({
          where: { salonId, offerId },
          _count: { _all: true },
          _sum: { discountAmount: true },
        }),
        this.prisma.offerRedemption.findMany({
          where: { salonId, offerId },
          distinct: ['customerId'],
          select: { customerId: true },
        }),
        this.prisma.booking.count({
          where: { salonId, offerId, status: 'COMPLETED' },
        }),
        this.prisma.booking.count({
          where: { salonId, offerId, status: 'CANCELLED' },
        }),
      ]);
    return {
      offerId,
      redemptionCount: aggregate._count._all,
      uniqueCustomers: customers.length,
      completedBookings,
      cancelledBookings,
      recordedDiscount: Number(aggregate._sum.discountAmount ?? 0),
      currency: offer.currency,
    };
  }

  async publicList(
    query: PublicOfferQuery,
  ): Promise<{ items: PublicOfferDto[]; nextCursor: string | null }> {
    const now = new Date();
    const citySlug = query.citySlug ?? query.city?.toLowerCase();
    const cityFilter =
      citySlug || query.countryCode
        ? {
            city: {
              is: {
                ...(citySlug ? { slug: citySlug } : {}),
                ...(query.countryCode
                  ? { countryCode: query.countryCode }
                  : {}),
              },
            },
          }
        : {};
    const applicableServiceFilter = query.service
      ? {
          AND: [
            {
              OR: [
                { services: { none: {} } },
                {
                  services: {
                    some: {
                      serviceId: query.service,
                      service: { isActive: true },
                    },
                  },
                },
              ],
            },
            // An unrestricted campaign is still only relevant to a requested service when that
            // service is actually active at the campaign's salon.
            {
              salon: {
                is: {
                  services: { some: { id: query.service, isActive: true } },
                },
              },
            },
          ],
        }
      : {
          OR: [
            {
              services: { none: {} },
              salon: { is: { services: { some: { isActive: true } } } },
            },
            { services: { some: { service: { isActive: true } } } },
          ],
        };
    const rows = await this.prisma.offer.findMany({
      where: {
        status: 'ACTIVE',
        validFrom: { lte: now },
        validTo: { gt: now },
        salon: { is: { status: 'ACTIVE', ...cityFilter } },
        ...applicableServiceFilter,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: publicOfferInclude,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await this.mapPublicOffers(page, query.service);
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async publicGet(offerId: string): Promise<PublicOfferDto> {
    const now = new Date();
    const offer = await this.prisma.offer.findFirst({
      where: {
        id: offerId,
        status: 'ACTIVE',
        validFrom: { lte: now },
        validTo: { gt: now },
        salon: { is: { status: 'ACTIVE' } },
      },
      include: publicOfferInclude,
    });
    if (!offer) this.notFound();

    const activeServiceCount = offer.services.length
      ? offer.services.filter((link) => link.service.isActive).length
      : await this.prisma.service.count({
          where: { salonId: offer.salonId, isActive: true },
        });
    if (activeServiceCount === 0) this.notFound();
    const [publicOffer] = await this.mapPublicOffers([offer]);
    if (!publicOffer || publicOffer.prices.length === 0) this.notFound();
    return publicOffer;
  }

  private async mapPublicOffers(
    page: PublicOfferWithRelations[],
    serviceId?: string,
  ): Promise<PublicOfferDto[]> {
    const unrestrictedSalonIds = [
      ...new Set(
        page
          .filter((offer) => offer.services.length === 0)
          .map((offer) => offer.salonId),
      ),
    ];
    const unrestrictedServices = unrestrictedSalonIds.length
      ? await this.prisma.service.findMany({
          where: { salonId: { in: unrestrictedSalonIds }, isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: { id: true, salonId: true, name: true, price: true },
        })
      : [];
    const servicesBySalon = new Map<string, ServicePrice[]>();
    for (const service of unrestrictedServices) {
      const list = servicesBySalon.get(service.salonId) ?? [];
      list.push({ id: service.id, name: service.name, price: service.price });
      servicesBySalon.set(service.salonId, list);
    }
    return page.map((offer) => {
      const linkedServices = offer.services
        .filter((link) => link.service.isActive)
        .map((link) => ({
          id: link.service.id,
          name: link.service.name,
          price: link.service.price,
        }));
      const eligibleServices =
        offer.services.length > 0
          ? linkedServices
          : (servicesBySalon.get(offer.salonId) ?? []);
      const selectedServices = serviceId
        ? eligibleServices.filter((service) => service.id === serviceId)
        : eligibleServices;
      // Public prices are per-service estimates. Booking creation recomputes the final total
      // against the complete selected service set, then locks and revalidates the offer.
      const prices = selectedServices
        .slice(0, 50)
        .flatMap((service) =>
          this.calculateLines(offer, [service], offer.currency),
        );
      const dto = this.toDto(offer);
      const publicOffer: Omit<OfferDto, 'salonId' | 'redemptionCount'> = {
        id: dto.id,
        kind: dto.kind,
        status: dto.status,
        title: dto.title,
        description: dto.description,
        discountType: dto.discountType,
        discountValue: dto.discountValue,
        currency: dto.currency,
        audience: dto.audience,
        inactiveDays: dto.inactiveDays,
        validFrom: dto.validFrom,
        validTo: dto.validTo,
        maxRedemptions: dto.maxRedemptions,
        perCustomerLimit: dto.perCustomerLimit,
        serviceIds: dto.serviceIds,
        createdAt: dto.createdAt,
        updatedAt: dto.updatedAt,
      };
      return {
        ...publicOffer,
        salon: {
          id: offer.salon.id,
          name: offer.salon.name,
          slug: offer.salon.slug,
          city: offer.salon.city.name,
          countryCode: offer.salon.city.countryCode,
          citySlug: offer.salon.city.slug,
        },
        eligibility: { audience: offer.audience, accountRequired: true },
        prices,
      };
    });
  }

  async previewForBooking(
    salonId: string,
    customerId: string,
    offerId: string,
    services: ServicePrice[],
    source: BookingSource,
    now = new Date(),
  ): Promise<LockedOfferApplication> {
    return this.validateOfferForBooking(
      this.prisma,
      salonId,
      customerId,
      offerId,
      services,
      source,
      now,
      true,
    );
  }

  async lockAndValidateForBooking(
    tx: Prisma.TransactionClient,
    salonId: string,
    customerId: string,
    offerId: string,
    services: ServicePrice[],
    source: BookingSource,
    now: Date,
  ): Promise<LockedOfferApplication> {
    // Block a concurrent service price/deactivation update until this booking commits, so the
    // server's campaign calculation and the persisted BookingService snapshot use one price set.
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "services"
      WHERE "salonId" = ${salonId} AND "id" IN (${Prisma.join(services.map((service) => service.id))})
        AND "isActive" = true
      FOR SHARE
    `);
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "offers" WHERE "salonId" = ${salonId} AND "id" = ${offerId} FOR UPDATE
    `);
    if (!locked.length) this.notFound();
    const currentServices = await this.loadServices(
      tx,
      salonId,
      services.map((service) => service.id),
    );
    this.assertFoundServiceIds(
      currentServices,
      services.map((service) => service.id),
    );
    const byId = new Map(
      currentServices.map((service) => [service.id, service]),
    );
    if (
      services.some(
        (service) =>
          decimalStringToPaise(service.price.toString()) !==
          decimalStringToPaise(byId.get(service.id)!.price.toString()),
      )
    ) {
      this.fail(
        OfferErrorCode.CHANGED_RETRY,
        'A selected service price changed. Refresh the offer and try again.',
        HttpStatus.CONFLICT,
      );
    }
    return this.validateOfferForBooking(
      tx,
      salonId,
      customerId,
      offerId,
      currentServices,
      source,
      now,
      true,
    );
  }

  async recordRedemption(
    tx: Prisma.TransactionClient,
    application: LockedOfferApplication,
    salonId: string,
    customerId: string,
    bookingId: string,
  ): Promise<void> {
    const redemption = await tx.offerRedemption.create({
      data: {
        salonId,
        offerId: application.offerId,
        bookingId,
        customerId,
        discountAmount: paiseToDecimalString(application.discountAmountPaise),
        currency: application.currency,
      },
    });
    await this.audit(tx, customerId, 'OFFER_REDEEMED', redemption.id, {
      salonId,
      offerId: application.offerId,
      bookingId,
      discountAmount: paiseToDecimalString(application.discountAmountPaise),
      currency: application.currency,
    });
  }

  private async validateOfferForBooking(
    db: OffersDb,
    salonId: string,
    customerId: string,
    offerId: string,
    services: ServicePrice[],
    source: BookingSource,
    now: Date,
    checkLimits: boolean,
  ): Promise<LockedOfferApplication> {
    if (source !== BookingSource.APP && source !== BookingSource.WEB) {
      this.fail(
        OfferErrorCode.NOT_ELIGIBLE,
        'Offers are available only for authenticated online bookings.',
        HttpStatus.CONFLICT,
      );
    }
    const offer = await this.getOffer(db, salonId, offerId);
    if (!offer) this.notFound();
    if (offer.status !== 'ACTIVE')
      this.fail(
        OfferErrorCode.NOT_ELIGIBLE,
        'This offer is not active.',
        HttpStatus.CONFLICT,
      );
    if (now < offer.validFrom || now >= offer.validTo)
      this.fail(
        OfferErrorCode.EXPIRED,
        'This offer is not currently valid.',
        HttpStatus.CONFLICT,
      );
    const allowed = offer.services.map((x) => x.serviceId);
    const eligibleServices = allowed.length
      ? services.filter((service) => allowed.includes(service.id))
      : services;
    if (!eligibleServices.length)
      this.fail(
        OfferErrorCode.SERVICE_MISMATCH,
        'This offer does not apply to the selected services.',
        HttpStatus.CONFLICT,
      );
    if (
      !(await this.isAudienceEligible(
        db,
        salonId,
        customerId,
        offer.audience,
        offer.inactiveDays,
        now,
      ))
    ) {
      this.fail(
        OfferErrorCode.NOT_ELIGIBLE,
        'This account does not meet the offer eligibility rules.',
        HttpStatus.CONFLICT,
      );
    }
    if (checkLimits) {
      const total = await db.offerRedemption.count({
        where: { salonId, offerId },
      });
      if (offer.maxRedemptions !== null && total >= offer.maxRedemptions) {
        this.fail(
          OfferErrorCode.REDEMPTION_LIMIT,
          'This offer has reached its redemption limit.',
          HttpStatus.CONFLICT,
        );
      }
      const customerTotal = await db.offerRedemption.count({
        where: { salonId, offerId, customerId },
      });
      if (customerTotal >= offer.perCustomerLimit) {
        this.fail(
          OfferErrorCode.REDEMPTION_LIMIT,
          'This account has reached its redemption limit for this offer.',
          HttpStatus.CONFLICT,
        );
      }
    }
    const discountAmountPaise = this.calculateLines(
      offer,
      services,
      offer.currency,
    ).reduce(
      (sum, line) => sum + decimalStringToPaise(line.discount.toFixed(2)),
      0,
    );
    if (discountAmountPaise <= 0) {
      this.fail(
        OfferErrorCode.NOT_ELIGIBLE,
        'This offer does not reduce the selected service price.',
        HttpStatus.CONFLICT,
      );
    }
    const percent =
      offer.discountType === 'PERCENT' ? Number(offer.discountValue) : 0;
    return {
      offerId,
      title: offer.title,
      currency: offer.currency,
      percent,
      discountAmountPaise,
      updatedAt: offer.updatedAt,
    };
  }

  private async isAudienceEligible(
    db: OffersDb,
    salonId: string,
    customerId: string,
    audience: string,
    inactiveDays: number | null,
    now: Date,
  ): Promise<boolean> {
    if (audience === 'ALL') return true;
    const rows = await db.$queryRaw<
      Array<{ visitCount: number; lastVisitAt: Date | null }>
    >(Prisma.sql`
      SELECT COUNT(*)::int AS "visitCount", MAX("visitAt") AS "lastVisitAt"
      FROM (
        SELECT "updatedAt" AS "visitAt" FROM "bookings"
        WHERE "salonId" = ${salonId} AND "customerId" = ${customerId} AND "status"::text = 'COMPLETED'
        UNION ALL
        SELECT "serviceCompletedAt" AS "visitAt" FROM "queue_entries"
        WHERE "salonId" = ${salonId} AND "customerId" = ${customerId}
          AND "bookingId" IS NULL AND "status"::text = 'COMPLETED' AND "serviceCompletedAt" IS NOT NULL
      ) visits
    `);
    const count = rows[0]?.visitCount ?? 0;
    if (audience === 'NEW') return count === 0;
    if (audience === 'REPEAT') return count >= 1;
    if (audience === 'INACTIVE') {
      const cutoff = now.getTime() - (inactiveDays ?? 30) * 24 * 60 * 60 * 1000;
      return (
        count > 0 &&
        rows[0]?.lastVisitAt instanceof Date &&
        rows[0].lastVisitAt.getTime() <= cutoff
      );
    }
    return false;
  }

  private calculateLines(
    offer: {
      discountType: string;
      discountValue: Prisma.Decimal | number;
      services?: { serviceId: string }[];
    },
    services: ServicePrice[],
    currency: string,
  ): OfferPreviewDto['lines'] {
    const allowed = offer.services?.map((x) => x.serviceId) ?? [];
    const eligible = services.filter(
      (service) => !allowed.length || allowed.includes(service.id),
    );
    let flatRemaining =
      offer.discountType === 'FLAT'
        ? decimalStringToPaise(String(offer.discountValue))
        : 0;
    return services.map((service) => {
      const basePaise = decimalStringToPaise(service.price.toString());
      let discountPaise = 0;
      if (eligible.some((item) => item.id === service.id)) {
        discountPaise =
          offer.discountType === 'PERCENT'
            ? computePercentageDiscountPaise(
                basePaise,
                Number(offer.discountValue),
              )
            : Math.min(basePaise, flatRemaining);
        if (offer.discountType === 'FLAT') flatRemaining -= discountPaise;
      }
      return {
        serviceId: service.id,
        serviceName: service.name,
        basePrice: paiseToRupees(basePaise),
        discount: paiseToRupees(discountPaise),
        finalPrice: paiseToRupees(basePaise - discountPaise),
        currency,
      };
    });
  }

  private toPreview(
    offerId: string | null,
    offer: {
      discountType: string;
      discountValue: Prisma.Decimal | number;
      audience: string;
    },
    services: ServicePrice[],
    currency: string,
    eligibleByRule: boolean | null,
  ): OfferPreviewDto {
    const lines = this.calculateLines(offer, services, currency);
    const subtotalPaise = lines.reduce(
      (sum, line) => sum + decimalStringToPaise(line.basePrice.toFixed(2)),
      0,
    );
    const discountPaise = lines.reduce(
      (sum, line) => sum + decimalStringToPaise(line.discount.toFixed(2)),
      0,
    );
    return {
      offerId,
      currency,
      eligibleByRule,
      eligibilityRule: offer.audience as OfferPreviewDto['eligibilityRule'],
      lines,
      subtotal: paiseToRupees(subtotalPaise),
      discount: paiseToRupees(discountPaise),
      finalTotal: paiseToRupees(subtotalPaise - discountPaise),
    };
  }

  private async loadServices(
    db: OffersDb,
    salonId: string,
    ids: string[],
  ): Promise<ServicePrice[]> {
    return db.service.findMany({
      where: {
        salonId,
        isActive: true,
        ...(ids.length ? { id: { in: ids } } : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, price: true },
    });
  }

  private async assertServices(
    db: OffersDb,
    salonId: string,
    ids: string[],
  ): Promise<void> {
    if (!ids.length) return;
    const found = await db.service.findMany({
      where: { salonId, isActive: true, id: { in: ids } },
      select: { id: true },
    });
    this.assertFoundServiceIds(found, ids);
  }

  private assertFoundServiceIds(found: { id: string }[], ids: string[]): void {
    if (found.length !== ids.length)
      this.fail(
        OfferErrorCode.SERVICE_MISMATCH,
        'A selected service is missing, inactive, or belongs to another shop.',
        HttpStatus.BAD_REQUEST,
      );
  }

  private async getOffer(
    db: OffersDb,
    salonId: string,
    offerId: string,
  ): Promise<OfferWithRelations | null> {
    return db.offer.findFirst({
      where: { id: offerId, salonId },
      include: {
        services: { select: { serviceId: true } },
        _count: { select: { redemptions: true } },
      },
    });
  }

  private async lockOffer(
    tx: Prisma.TransactionClient,
    salonId: string,
    offerId: string,
  ): Promise<OfferWithRelations> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "offers" WHERE "salonId" = ${salonId} AND "id" = ${offerId} FOR UPDATE
    `);
    if (!rows.length) this.notFound();
    const offer = await this.getOffer(tx, salonId, offerId);
    if (!offer) this.notFound();
    return offer;
  }

  private toDto(row: OfferWithRelations): OfferDto {
    const status =
      row.status === 'ACTIVE' && row.validTo <= new Date()
        ? 'EXPIRED'
        : row.status;
    return {
      id: row.id,
      salonId: row.salonId,
      kind: row.kind,
      status,
      title: row.title,
      description: row.description,
      discountType: row.discountType,
      discountValue: Number(row.discountValue),
      currency: row.currency,
      audience: row.audience,
      inactiveDays: row.inactiveDays,
      validFrom: row.validFrom.toISOString(),
      validTo: row.validTo.toISOString(),
      maxRedemptions: row.maxRedemptions,
      perCustomerLimit: row.perCustomerLimit,
      serviceIds: row.services.map((x) => x.serviceId),
      redemptionCount: row._count.redemptions,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.auditLog.create({
      data: { actorUserId, action, entityType: 'Offer', entityId, metadata },
    });
  }

  private notFound(message = 'Offer not found in this shop.'): never {
    this.fail(OfferErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }

  private invalid(message: string): never {
    this.fail(OfferErrorCode.INVALID, message, HttpStatus.BAD_REQUEST);
  }

  private fail(code: string, message: string, status: HttpStatus): never {
    throw new AppException(code, message, status);
  }
}
