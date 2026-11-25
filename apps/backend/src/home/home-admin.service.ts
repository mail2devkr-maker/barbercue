import { Injectable } from '@nestjs/common';
import { Prisma, type HomeBookingStatus } from '@prisma/client';
import {
  HOME_SERVED,
  HOME_TIME_ZONE,
  parseHomeRequest,
  type HomeSettings,
} from '@barbercue/shared';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedHourOf,
  zonedWallTimeToUtc,
} from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { homeFlag, homeFlags } from './home-config';
import { HomeBookingService } from './home-booking.service';
import {
  HomeCoreService,
  TX,
  addMin,
  minutesBetween,
} from './home-core.service';
import { homeInvalid, homeNotFound, homeState } from './home-errors';
import { HomeRoutingService } from './home-routing.service';

const LIVE: HomeBookingStatus[] = [
  'PREPARING',
  'ON_THE_WAY',
  'ARRIVED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'ADDRESS_ISSUE',
  'INTERRUPTED',
];
const SEARCH: HomeBookingStatus[] = [
  'REQUESTED',
  'AWAITING_ASSIGNMENT',
  'INVITED',
  'NO_PROFESSIONAL',
  'REPLACEMENT_REQUESTED',
];
const CANCELLED: HomeBookingStatus[] = [
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROFESSIONAL',
  'CANCELLED_BY_SALON',
  'CANCELLED_BY_PLATFORM',
];
const MIN_SAMPLE = 5;

/** Admin operations, analytics from real records, and advisory insights (people decide). */
@Injectable()
export class HomeAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: HomeCoreService,
    private readonly bookings: HomeBookingService,
    private readonly routing: HomeRoutingService,
  ) {}

  async overview() {
    const now = new Date();
    const c = (where: Prisma.HomeBookingWhereInput) =>
      this.prisma.homeBooking.count({ where });
    const [
      providers,
      professionals,
      pendingProviders,
      pendingVerifications,
      search,
      upcoming,
      live,
      late,
      incidents,
      tickets,
    ] = await Promise.all([
      this.prisma.homeProvider.groupBy({
        by: ['kind', 'status'],
        _count: { _all: true },
      }),
      this.prisma.homeProfessional.count({
        where: { active: true, consentAt: { not: null } },
      }),
      this.prisma.homeProvider.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.homeVerification.count({
        where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
      }),
      c({ status: { in: SEARCH } }),
      c({ status: 'CONFIRMED' }),
      c({ status: { in: LIVE } }),
      c({
        status: { in: ['CONFIRMED', 'PREPARING', 'ON_THE_WAY'] },
        OR: [{ delayMinutes: { gt: 0 } }, { serviceStart: { lt: now } }],
      }),
      this.prisma.homeIncident.count({ where: { status: { not: 'CLOSED' } } }),
      this.prisma.homeTicket.count({
        where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
      }),
    ]);
    return {
      flags: homeFlags(),
      routingConfigured: this.routing.configured,
      providers: providers.map((p) => ({
        kind: p.kind,
        status: p.status,
        count: p._count._all,
      })),
      professionals,
      pendingProviders,
      pendingVerifications,
      searching: search,
      upcoming,
      live,
      late,
      openIncidents: incidents,
      openTickets: tickets,
    };
  }

  /** Dispatch board. Street addresses and live coordinates are not in this list. */
  async dispatch() {
    const now = new Date();
    const inc = {
      items: { select: { serviceName: true } },
      address: { select: { locality: true, city: true, postalCode: true } },
      provider: { select: { displayName: true, kind: true } },
      assignments: {
        where: { status: 'ACTIVE' as const },
        select: {
          professionalId: true,
          professional: { select: { displayName: true } },
        },
      },
      invitations: {
        orderBy: { createdAt: 'desc' as const },
        take: 5,
        select: {
          status: true,
          expiresAt: true,
          professional: { select: { displayName: true } },
        },
      },
    };
    const [bookings, online, busy] = await Promise.all([
      this.prisma.homeBooking.findMany({
        where: {
          status: {
            in: [
              ...SEARCH,
              ...LIVE,
              'CONFIRMED',
              'RESCHEDULE_REQUESTED',
              'DRAFT',
            ],
          },
          serviceStart: { gt: addMin(now, -24 * 60) },
        },
        include: inc,
        orderBy: { serviceStart: 'asc' },
        take: 300,
      }),
      this.prisma.homeProfessional.findMany({
        where: {
          isOnline: true,
          active: true,
          suspendedAt: null,
          consentAt: { not: null },
          provider: { status: 'APPROVED' },
        },
        select: {
          id: true,
          displayName: true,
          userId: true,
          provider: { select: { displayName: true, kind: true, city: true } },
        },
        take: 300,
      }),
      this.prisma.professionalCommitment.findMany({
        where: {
          kind: 'HOME_BOOKING',
          releasedAt: null,
          startAt: { lte: now },
          endAt: { gt: now },
        },
        select: { userId: true },
      }),
    ]);
    const busyUsers = new Set(busy.map((b) => b.userId));
    const row = (b: (typeof bookings)[number]) => ({
      id: b.id,
      code: b.code,
      status: b.status,
      mode: b.mode,
      preference: b.preference,
      serviceStart: b.serviceStart,
      services: b.items.map((i) => i.serviceName),
      area: `${b.address.locality}, ${b.address.city}`,
      provider: b.provider,
      professional: b.assignments[0]?.professional.displayName ?? null,
      professionalId: b.assignments[0]?.professionalId ?? null,
      delayMinutes: b.delayMinutes,
      etaTo: b.etaTo,
      invitations: b.invitations.map((i) => ({
        name: i.professional.displayName,
        status: i.status,
        expiresAt: i.expiresAt,
      })),
      atRisk:
        (['CONFIRMED', 'PREPARING'].includes(b.status) &&
          b.serviceStart < addMin(now, 15)) ||
        (b.status === 'ON_THE_WAY' && !!b.etaTo && b.etaTo < now) ||
        b.delayMinutes >= 15,
    });
    const rows = bookings.map(row);
    const of = (s: HomeBookingStatus[]) =>
      rows.filter((r) => s.includes(r.status));
    return {
      generatedAt: now,
      mapAvailable: false,
      mapNote:
        'No map provider is configured for dispatch, so this board is a list.',
      unassigned: of([
        'REQUESTED',
        'AWAITING_ASSIGNMENT',
        'INVITED',
        'NO_PROFESSIONAL',
      ]),
      replacements: of(['REPLACEMENT_REQUESTED', 'RESCHEDULE_REQUESTED']),
      preparing: of(['PREPARING']),
      traveling: of(['ON_THE_WAY', 'ADDRESS_ISSUE']),
      serving: of(['ARRIVED', 'CHECKED_IN', 'IN_PROGRESS', 'INTERRUPTED']),
      upcoming: of(['CONFIRMED']),
      atRisk: rows.filter((r) => r.atRisk),
      availableNow: online
        .filter((o) => !busyUsers.has(o.userId))
        .map(({ userId: _u, ...o }) => o),
      onVisit: online
        .filter((o) => busyUsers.has(o.userId))
        .map(({ userId: _u, ...o }) => o),
    };
  }

  /** Who could take it, why, and why the others cannot - the same engine customers use. */
  async candidates(bookingId: string) {
    const b = await this.prisma.homeBooking.findUnique({
      where: { id: bookingId },
      include: {
        address: true,
        items: { include: { offering: { include: { serviceDef: true } } } },
      },
    });
    if (!b) throw homeNotFound();
    return {
      code: b.code,
      preference: b.preference,
      allowAlternatives: b.allowAlternatives,
      services: b.items.map((i) => i.offering?.serviceDef.code),
    };
  }

  async providers(q: {
    kind?: string;
    status?: string;
    q?: string;
    page: number;
  }) {
    const where: Prisma.HomeProviderWhereInput = {
      ...(q.kind ? { kind: q.kind as never } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q
        ? {
            OR: [
              { displayName: { contains: q.q, mode: 'insensitive' } },
              { city: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.homeProvider.count({ where }),
      this.prisma.homeProvider.findMany({
        where,
        select: {
          id: true,
          kind: true,
          status: true,
          displayName: true,
          city: true,
          locality: true,
          paused: true,
          submittedAt: true,
          reviewNote: true,
          salonId: true,
          minStaffInSalon: true,
          maxHomeStaff: true,
          instantEnabled: true,
          scheduledEnabled: true,
          travelFeePaise: true,
          minOrderPaise: true,
          areas: {
            select: { kind: true, value: true, radiusKm: true, excluded: true },
          },
          offerings: {
            select: {
              id: true,
              pricePaise: true,
              active: true,
              serviceDef: { select: { name: true, code: true } },
            },
          },
          professionals: {
            select: {
              id: true,
              displayName: true,
              consentAt: true,
              active: true,
              suspendedAt: true,
              isOnline: true,
            },
          },
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * 25,
        take: 25,
      }),
    ]);
    return { total, page: q.page, items };
  }

  async reviewProvider(
    adminId: string,
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED',
    note: string,
  ) {
    const p = await this.prisma.homeProvider.findUnique({
      where: { id },
      include: { salon: { select: { ownerUserId: true } } },
    });
    if (!p) throw homeNotFound();
    if (p.userId === adminId)
      throw homeState('You cannot review your own profile.');
    if (
      decision === 'APPROVED' &&
      !['SUBMITTED', 'SUSPENDED'].includes(p.status)
    )
      throw homeState('Only submitted profiles can be approved.');
    await this.prisma.$transaction(async (tx) => {
      await tx.homeProvider.update({
        where: { id },
        data: {
          status: decision,
          reviewedAt: new Date(),
          reviewedByUserId: adminId,
          reviewNote: note,
        },
      });
      if (decision === 'SUSPENDED')
        await tx.homeProfessional.updateMany({
          where: { providerId: id },
          data: { isOnline: false },
        });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: `PROVIDER_${decision}`,
        entityType: 'PROVIDER',
        entityId: id,
        note,
        metadata: { from: p.status },
      });
    });
    await this.core.notify(
      p.userId ?? p.salon?.ownerUserId,
      'home.provider.update',
      `${id}:${decision}:${Date.now()}`,
      'FastQue Home profile update',
      `Your profile is ${decision.toLowerCase()}. ${note}`,
      p.salonId ? `/dashboard/salons/${p.salonId}/home-services` : '/home-pro',
    );
    return { ok: true };
  }

  async suspendProfessional(
    adminId: string,
    id: string,
    suspended: boolean,
    note: string,
  ) {
    const p = await this.prisma.homeProfessional.findUnique({ where: { id } });
    if (!p) throw homeNotFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.homeProfessional.update({
        where: { id },
        data: {
          suspendedAt: suspended ? new Date() : null,
          ...(suspended ? { isOnline: false } : {}),
        },
      });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: suspended
          ? 'PROFESSIONAL_SUSPENDED'
          : 'PROFESSIONAL_REINSTATED',
        entityType: 'PROFESSIONAL',
        entityId: id,
        note,
      });
    });
    return { ok: true };
  }

  verifications(status?: string) {
    return this.prisma.homeVerification.findMany({
      where: status
        ? { status: status as never }
        : { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
      select: {
        id: true,
        scope: true,
        subject: true,
        status: true,
        evidenceNote: true,
        evidenceType: true,
        submittedAt: true,
        verifiedAt: true,
        expiresAt: true,
        reviewNote: true,
        professional: {
          select: {
            id: true,
            displayName: true,
            provider: { select: { displayName: true, kind: true, city: true } },
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
  }

  async bookingList(q: {
    scope: 'active' | 'scheduled' | 'all';
    status?: string;
    q?: string;
    from?: string;
    to?: string;
    page: number;
  }) {
    const where: Prisma.HomeBookingWhereInput = {
      ...(q.scope === 'active'
        ? { status: { in: [...SEARCH, ...LIVE] } }
        : q.scope === 'scheduled'
          ? { status: { in: ['CONFIRMED', 'RESCHEDULE_REQUESTED'] } }
          : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q.toUpperCase() } },
              {
                provider: {
                  displayName: { contains: q.q, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
      ...(q.from || q.to
        ? {
            serviceStart: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.homeBooking.count({ where }),
      this.prisma.homeBooking.findMany({
        where,
        orderBy: { serviceStart: q.scope === 'all' ? 'desc' : 'asc' },
        skip: (q.page - 1) * 25,
        take: 25,
        include: {
          items: { select: { serviceName: true } },
          provider: { select: { displayName: true, kind: true } },
          address: { select: { locality: true, city: true } },
          assignments: {
            where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
            take: 1,
            select: { professional: { select: { displayName: true } } },
          },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      items: rows.map((b) => ({
        id: b.id,
        code: b.code,
        status: b.status,
        paymentStatus: b.paymentStatus,
        complaintStatus: b.complaintStatus,
        mode: b.mode,
        serviceStart: b.serviceStart,
        totalPaise: b.totalPaise,
        services: b.items.map((i) => i.serviceName).join(', '),
        provider: b.provider.displayName,
        kind: b.provider.kind,
        professional: b.assignments[0]?.professional.displayName ?? null,
        area: `${b.address.locality}, ${b.address.city}`,
      })),
    };
  }

  // ---------- Catalogue ----------

  catalog() {
    return this.prisma.homeCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        services: {
          orderBy: { name: 'asc' },
          include: { _count: { select: { offerings: true } } },
        },
      },
    });
  }

  async updateCategory(
    adminId: string,
    id: string,
    data: { active?: boolean; requiresQualification?: boolean },
  ) {
    const row = await this.prisma.homeCategory.update({ where: { id }, data });
    await this.core.audit(this.prisma, {
      actorUserId: adminId,
      actorParty: 'ADMIN',
      action: 'CATEGORY',
      entityType: 'CATEGORY',
      entityId: id,
      metadata: data,
    });
    return row;
  }

  async saveService(
    adminId: string,
    data: {
      id?: string;
      categoryId: string;
      code: string;
      name: string;
      nameHi: string;
      description?: string;
      durationMinutes: number;
      prepMinutes: number;
      cleanupMinutes: number;
      safetyInstructions?: string;
      customerPreparation?: string;
      forChildren: boolean;
      customerProducts: boolean;
      minPricePaise?: number | null;
      maxPricePaise?: number | null;
      status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
    },
  ) {
    const { id, ...rest } = data;
    if (
      rest.minPricePaise != null &&
      rest.maxPricePaise != null &&
      rest.minPricePaise > rest.maxPricePaise
    )
      throw homeInvalid('The minimum is above the maximum.');
    const row = id
      ? await this.prisma.homeServiceDef.update({ where: { id }, data: rest })
      : await this.prisma.homeServiceDef.create({ data: rest });
    await this.core.audit(this.prisma, {
      actorUserId: adminId,
      actorParty: 'ADMIN',
      action: 'SERVICE_SAVED',
      entityType: 'SERVICE',
      entityId: row.id,
      metadata: rest,
    });
    return row;
  }

  // ---------- Growth ----------

  async lists() {
    const [promotions, societies, campaigns, packages, plans] =
      await Promise.all([
        this.prisma.homePromotion.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { provider: { select: { displayName: true } } },
        }),
        this.prisma.homeSociety.findMany({
          orderBy: { name: 'asc' },
          take: 300,
        }),
        this.prisma.homeCampaign.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            society: { select: { name: true } },
            provider: { select: { displayName: true } },
            _count: { select: { participants: true } },
          },
        }),
        this.prisma.homePackage.findMany({
          take: 200,
          orderBy: { createdAt: 'desc' },
          include: { provider: { select: { displayName: true } } },
        }),
        this.prisma.homeMembershipPlan.findMany({ take: 50 }),
      ]);
    return {
      promotions,
      societies,
      campaigns,
      packages,
      plans,
      membershipsEnabled: homeFlag('HOME_MEMBERSHIPS_ENABLED'),
    };
  }

  createPromotion(
    adminId: string,
    d: {
      code: string;
      title: string;
      percentOff?: number | null;
      amountOffPaise?: number | null;
      minOrderPaise: number;
      maxUses?: number | null;
      startsAt: string;
      endsAt: string;
      active: boolean;
    },
    providerId: string | null = null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.homePromotion.findUnique({ where: { code: d.code } }))
        throw homeState('That offer code is already used.');
      const r = await tx.homePromotion.create({
        data: {
          ...d,
          startsAt: new Date(d.startsAt),
          endsAt: new Date(d.endsAt),
          providerId,
        },
      });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: providerId ? 'PROVIDER' : 'ADMIN',
        action: 'PROMOTION',
        entityType: 'PROMOTION',
        entityId: r.id,
      });
      return r;
    });
  }

  async createCampaign(
    adminId: string,
    d: {
      societyId: string;
      providerId: string;
      offeringId: string;
      title: string;
      minParticipants: number;
      maxParticipants: number;
      discountPct: number;
      startsAt: string;
      endsAt: string;
      joinBy: string;
    },
  ) {
    const o = await this.prisma.homeOffering.findFirst({
      where: {
        id: d.offeringId,
        providerId: d.providerId,
        active: true,
        provider: { status: 'APPROVED' },
      },
    });
    if (!o)
      throw homeInvalid('Choose an active service of an approved provider.');
    return this.prisma.homeCampaign.create({
      data: {
        ...d,
        startsAt: new Date(d.startsAt),
        endsAt: new Date(d.endsAt),
        joinBy: new Date(d.joinBy),
        createdByUserId: adminId,
      },
    });
  }

  async saveMembershipPlan(d: {
    name: string;
    pricePaise: number;
    periodMonths: number;
    benefits: Record<string, unknown>;
    active: boolean;
  }) {
    if (d.active && !homeFlag('HOME_MEMBERSHIPS_ENABLED'))
      throw homeState(
        'Memberships are switched off (HOME_MEMBERSHIPS_ENABLED). The plan can be saved as a draft only.',
      );
    return this.prisma.homeMembershipPlan.create({
      data: { ...d, benefits: d.benefits as Prisma.InputJsonValue },
    });
  }

  // ---------- Quality, safety, support ----------

  async quality() {
    const [hygiene, reviews, missing] = await Promise.all([
      this.prisma.homeHygieneRecord.groupBy({
        by: ['stage', 'complete'],
        _count: { _all: true },
      }),
      this.prisma.homeReview.findMany({
        where: { status: { in: ['REPORTED', 'APPEALED'] } },
        include: { professional: { select: { displayName: true } } },
        take: 100,
      }),
      this.prisma.homeBookingEvent.findMany({
        where: { kind: 'HYGIENE_MISSING' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { createdAt: true, booking: { select: { code: true } } },
      }),
    ]);
    return {
      hygiene,
      reportedReviews: reviews,
      startedWithoutChecklist: missing,
    };
  }

  async moderateReview(
    adminId: string,
    id: string,
    status: 'PUBLISHED' | 'HIDDEN',
    note: string,
  ) {
    await this.prisma.homeReview.update({
      where: { id },
      data: { status, moderatedByUserId: adminId, moderationNote: note },
    });
    await this.core.audit(this.prisma, {
      actorUserId: adminId,
      actorParty: 'ADMIN',
      action: `REVIEW_${status}`,
      entityType: 'REVIEW',
      entityId: id,
      note,
    });
    return { ok: true };
  }

  incidents() {
    return this.prisma.homeIncident.findMany({
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { booking: { select: { code: true, status: true } } },
    });
  }

  async handleIncident(
    adminId: string,
    id: string,
    status: 'INVESTIGATING' | 'ESCALATED' | 'CLOSED',
    resolution: string,
  ) {
    await this.prisma.homeIncident.update({
      where: { id },
      data: { status, resolution, handledByUserId: adminId },
    });
    await this.core.audit(this.prisma, {
      actorUserId: adminId,
      actorParty: 'ADMIN',
      action: `INCIDENT_${status}`,
      entityType: 'INCIDENT',
      entityId: id,
      note: resolution,
    });
    return { ok: true };
  }

  tickets(status?: string) {
    return this.prisma.homeTicket.findMany({
      where: status ? { status } : { status: { notIn: ['CLOSED'] } },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: {
        booking: { select: { code: true, status: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            authorParty: true,
            internal: true,
            body: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async workTicket(
    adminId: string,
    id: string,
    d: {
      reply?: string;
      internal?: boolean;
      status?: 'OPEN' | 'IN_PROGRESS' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      assignToMe?: boolean;
      resolution?: string;
    },
  ) {
    const t = await this.prisma.homeTicket.findUnique({
      where: { id },
      include: { booking: true },
    });
    if (!t) throw homeNotFound();
    await this.prisma.$transaction(async (tx) => {
      if (d.reply)
        await tx.homeTicketMessage.create({
          data: {
            ticketId: id,
            authorUserId: adminId,
            authorParty: 'ADMIN',
            body: d.reply,
            internal: !!d.internal,
          },
        });
      await tx.homeTicket.update({
        where: { id },
        data: {
          status: d.status,
          priority: d.priority,
          assignedToUserId: d.assignToMe ? adminId : undefined,
          resolution: d.resolution,
          escalatedAt: d.status === 'ESCALATED' ? new Date() : undefined,
          resolvedAt: d.status === 'RESOLVED' ? new Date() : undefined,
        },
      });
      const open = await tx.homeTicket.count({
        where: {
          bookingId: t.bookingId,
          openedByParty: 'CUSTOMER',
          status: { notIn: ['RESOLVED', 'CLOSED'] },
        },
      });
      const next =
        open === 0
          ? 'RESOLVED'
          : d.status === 'OPEN'
            ? undefined
            : 'UNDER_REVIEW';
      if (next && t.openedByParty === 'CUSTOMER')
        await tx.homeBooking.update({
          where: { id: t.bookingId },
          data: { complaintStatus: next },
        });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: 'TICKET',
        entityType: 'TICKET',
        entityId: id,
        metadata: { status: d.status ?? null, internal: !!d.internal },
      });
    });
    if (d.reply && !d.internal)
      await this.core.notify(
        t.openedByUserId,
        'home.booking.update',
        `ticket:${id}:${Date.now()}`,
        'Support update',
        'FastQue support replied to your request.',
        `/home-services/tracking/${t.booking.code}`,
      );
    return { ok: true };
  }

  /** A record of an approved OFFLINE refund/credit; FastQue moves no money. */
  async refund(
    adminId: string,
    code: string,
    d: {
      kind: 'REFUND' | 'SERVICE_CREDIT';
      amountPaise: number;
      reason: string;
    },
  ) {
    const b = await this.prisma.homeBooking.findUnique({
      where: { code },
      include: { payments: { where: { voidedAt: null } }, refunds: true },
    });
    if (!b) throw homeNotFound();
    const paid = b.payments.reduce((s, p) => s + p.amountPaise, 0);
    const already = b.refunds.reduce((s, r) => s + r.amountPaise, 0);
    if (d.amountPaise + already > paid)
      throw homeInvalid(
        'A refund cannot be more than what was recorded as paid.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.homeRefundRecord.create({
        data: { bookingId: b.id, ...d, approvedByUserId: adminId },
      });
      await tx.homeBooking.update({
        where: { id: b.id },
        data: { refundStatus: 'APPROVED' },
      });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: 'REFUND_APPROVED',
        entityType: 'BOOKING',
        entityId: b.id,
        note: d.reason,
        metadata: { amountPaise: d.amountPaise, kind: d.kind },
      });
      await this.core.event(tx, b.id, {
        kind: 'REFUND_APPROVED',
        party: 'ADMIN',
        actorUserId: adminId,
        metadata: { amountPaise: d.amountPaise, kind: d.kind },
      });
    });
    return {
      ok: true,
      note: 'Recorded. The provider settles this with the customer directly.',
    };
  }

  // ---------- Money ----------

  async money() {
    const [records, fees, settlements, rules] = await Promise.all([
      this.prisma.homePaymentRecord.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          booking: {
            select: {
              code: true,
              totalPaise: true,
              provider: { select: { displayName: true } },
            },
          },
        },
      }),
      this.prisma.homePlatformFee.groupBy({
        by: ['providerId'],
        where: { settlementId: null },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      this.prisma.homeSettlement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { provider: { select: { displayName: true } } },
      }),
      this.prisma.homeFeeRule.findMany({
        orderBy: { createdAt: 'asc' },
        include: { provider: { select: { displayName: true } } },
      }),
    ]);
    const names = await this.prisma.homeProvider.findMany({
      where: { id: { in: fees.map((f) => f.providerId) } },
      select: { id: true, displayName: true },
    });
    return {
      monetizationEnabled: homeFlag('HOME_MONETIZATION_ENABLED'),
      records,
      outstanding: fees.map((f) => ({
        providerId: f.providerId,
        provider: names.find((n) => n.id === f.providerId)?.displayName,
        amountPaise: f._sum.amountPaise ?? 0,
        visits: f._count._all,
      })),
      settlements,
      rules,
    };
  }

  async saveFeeRule(
    adminId: string,
    d: {
      kind: string;
      providerKind?: 'SALON_MANAGED' | 'INDEPENDENT_PROFESSIONAL' | null;
      providerId?: string | null;
      percentBps: number;
      fixedPaise: number;
      active: boolean;
      note?: string;
    },
    id?: string,
  ) {
    if (d.active && !homeFlag('HOME_MONETIZATION_ENABLED'))
      throw homeState(
        'Monetization is switched off (HOME_MONETIZATION_ENABLED). Rules can be saved but not activated.',
      );
    return this.prisma.$transaction(async (tx) => {
      const r = id
        ? await tx.homeFeeRule.update({
            where: { id },
            data: { ...d, updatedByUserId: adminId },
          })
        : await tx.homeFeeRule.create({
            data: { ...d, updatedByUserId: adminId },
          });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: 'FEE_RULE',
        entityType: 'FEE_RULE',
        entityId: r.id,
        metadata: d,
      });
      return r;
    });
  }

  /** Manual invoice of unsettled fees; collection happens offline and is recorded by a person. */
  async createSettlement(adminId: string, providerId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "home_providers" WHERE "id" = ${providerId} FOR UPDATE`,
      );
      const fees = await tx.homePlatformFee.findMany({
        where: { providerId, settlementId: null },
      });
      if (fees.length === 0)
        throw homeState('There are no unsettled fees for this provider.');
      const s = await tx.homeSettlement.create({
        data: {
          providerId,
          amountPaise: fees.reduce((x, f) => x + f.amountPaise, 0),
          createdByUserId: adminId,
        },
      });
      await tx.homePlatformFee.updateMany({
        where: { id: { in: fees.map((f) => f.id) } },
        data: { settlementId: s.id },
      });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: 'SETTLEMENT_CREATED',
        entityType: 'SETTLEMENT',
        entityId: s.id,
        metadata: { amountPaise: s.amountPaise },
      });
      return s;
    }, TX);
  }

  async collectSettlement(adminId: string, id: string, reference: string) {
    const r = await this.prisma.homeSettlement.updateMany({
      where: { id, status: 'DUE' },
      data: { status: 'COLLECTED', reference, collectedAt: new Date() },
    });
    if (!r.count) throw homeState('This settlement is not due.');
    await this.core.audit(this.prisma, {
      actorUserId: adminId,
      actorParty: 'ADMIN',
      action: 'SETTLEMENT_COLLECTED',
      entityType: 'SETTLEMENT',
      entityId: id,
      note: reference,
    });
    return { ok: true };
  }

  // ---------- Analytics (real rows only) ----------

  async analytics(fromDate: string, toDate: string) {
    const from = zonedWallTimeToUtc(fromDate, '00:00', HOME_TIME_ZONE);
    const to = zonedWallTimeToUtc(
      addZonedCalendarDays(toDate, 1),
      '00:00',
      HOME_TIME_ZONE,
    );
    if (!from || !to || to <= from || minutesBetween(from, to) > 400 * 1440)
      throw homeInvalid('Choose a period of up to 400 days.');
    const range = { gte: from, lt: to };
    const [
      bookings,
      invites,
      assignments,
      metrics,
      earnings,
      fees,
      refunds,
      pros,
      items,
      reviews,
    ] = await Promise.all([
      this.prisma.homeBooking.findMany({
        where: { createdAt: range },
        select: {
          id: true,
          status: true,
          mode: true,
          customerId: true,
          totalPaise: true,
          createdAt: true,
          serviceStart: true,
          address: { select: { city: true, locality: true, building: true } },
          provider: { select: { kind: true } },
          assignments: {
            orderBy: { assignedAt: 'asc' },
            take: 1,
            select: { assignedAt: true },
          },
        },
        take: 50_000,
      }),
      this.prisma.homeInvitation.groupBy({
        by: ['status'],
        where: { createdAt: range },
        _count: { _all: true },
      }),
      this.prisma.homeAssignment.count({ where: { assignedAt: range } }),
      this.prisma.homeVisitMetric.findMany({
        where: { createdAt: range },
        take: 50_000,
      }),
      this.prisma.homeEarning.findMany({
        where: { createdAt: range },
        take: 50_000,
      }),
      this.prisma.homePlatformFee.aggregate({
        where: { createdAt: range },
        _sum: { amountPaise: true },
      }),
      this.prisma.homeRefundRecord.aggregate({
        where: { createdAt: range },
        _sum: { amountPaise: true },
      }),
      this.prisma.homeProfessional.findMany({
        where: { consentAt: { not: null } },
        select: {
          id: true,
          active: true,
          isOnline: true,
          verifications: {
            where: { status: 'VERIFIED', scope: { not: 'MOBILE' } },
            select: { id: true },
          },
        },
      }),
      this.prisma.homeBookingItem.groupBy({
        by: ['serviceName'],
        where: { booking: { createdAt: range } },
        _count: { _all: true },
        orderBy: { _count: { serviceName: 'desc' } },
        take: 10,
      }),
      this.prisma.homeReview.aggregate({
        where: { createdAt: range, status: 'PUBLISHED' },
        _avg: { overall: true },
        _count: { _all: true },
      }),
    ]);
    const served = bookings.filter((b) => HOME_SERVED.includes(b.status));
    const confirmed = bookings.filter((b) => b.assignments.length > 0);
    const avg = (xs: number[]) =>
      xs.length
        ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
        : null;
    const pctOf = (a: number, b: number) =>
      b ? Math.round((a / b) * 1000) / 10 : null;
    const tally = (keys: string[]) =>
      Object.entries(
        keys.reduce<Record<string, number>>(
          (m, k) => ((m[k] = (m[k] ?? 0) + 1), m),
          {},
        ),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([key, count]) => ({ key, count }));
    const inv = (s: string) =>
      invites.find((i) => i.status === s)?._count._all ?? 0;
    const perCustomer = tally(bookings.map((b) => b.customerId ?? b.id));
    const errors = metrics
      .map((m) => m.etaErrorMinutes)
      .filter((v): v is number => v != null);
    const sum = (f: (e: (typeof earnings)[number]) => number) =>
      earnings.reduce((s, e) => s + f(e), 0);
    const minutesWorked = metrics.reduce(
      (s, m) => s + m.actualMinutes + (m.actualTravel ?? 0),
      0,
    );
    const providerNet = sum(
      (e) =>
        e.servicePaise +
        e.productPaise +
        e.travelPaise -
        e.discountPaise -
        e.platformFeePaise,
    );
    return {
      period: { from: fromDate, to: toDate },
      bookings: {
        requests: bookings.length,
        confirmed: confirmed.length,
        completed: served.length,
        unassigned: bookings.filter(
          (b) =>
            ['NO_PROFESSIONAL', 'EXPIRED'].includes(b.status) &&
            !b.assignments.length,
        ).length,
        instant: bookings.filter((b) => b.mode === 'INSTANT').length,
        scheduled: bookings.filter((b) => b.mode === 'SCHEDULED').length,
        cancelled: bookings.filter((b) => CANCELLED.includes(b.status)).length,
        repeatCustomers: perCustomer.filter((x) => x.count > 1).length,
        conversionPct: pctOf(served.length, bookings.length),
        averageOrderPaise: served.length
          ? Math.round(
              served.reduce((s, b) => s + b.totalPaise, 0) / served.length,
            )
          : null,
      },
      dispatch: {
        invitations: invites.reduce((s, i) => s + i._count._all, 0),
        acceptancePct: pctOf(
          inv('ACCEPTED'),
          inv('ACCEPTED') + inv('DECLINED') + inv('EXPIRED'),
        ),
        avgMinutesToAssign: avg(
          confirmed.map((b) =>
            minutesBetween(b.createdAt, b.assignments[0].assignedAt),
          ),
        ),
        assignments,
        avgEtaErrorMinutes: avg(errors),
        onTimePct: pctOf(errors.filter((e) => e <= 0).length, errors.length),
        avgTravelMinutes: avg(
          metrics
            .map((m) => m.actualTravel)
            .filter((v): v is number => v != null),
        ),
        fulfilmentPct: pctOf(served.length, confirmed.length),
        distanceKm: null,
        distanceNote:
          'Road distance is not recorded without a routing provider.',
      },
      professionals: {
        total: pros.length,
        withCompletedChecks: pros.filter((p) => p.verifications.length > 0)
          .length,
        active: pros.filter((p) => p.active).length,
        online: pros.filter((p) => p.isOnline).length,
        earningsPerHourPaise: minutesWorked
          ? Math.round(providerNet / (minutesWorked / 60))
          : null,
        salonManaged: served.filter((b) => b.provider.kind === 'SALON_MANAGED')
          .length,
        independent: served.filter(
          (b) => b.provider.kind === 'INDEPENDENT_PROFESSIONAL',
        ).length,
        averageRating: reviews._avg.overall,
        reviews: reviews._count._all,
      },
      money: {
        grossServiceValuePaise: sum(
          (e) => e.servicePaise + e.productPaise + e.travelPaise,
        ),
        fastqueRevenuePaise: fees._sum.amountPaise ?? 0,
        providerEarningsPaise: providerNet,
        travelPaise: sum((e) => e.travelPaise),
        productPaise: sum((e) => e.productPaise),
        discountPaise: sum((e) => e.discountPaise),
        refundsPaise: refunds._sum.amountPaise ?? 0,
        note: 'Service value belongs to providers. FastQue revenue is only the recorded platform fee.',
      },
      market: {
        services: items.map((i) => ({
          key: i.serviceName,
          count: i._count._all,
        })),
        cities: tally(bookings.map((b) => b.address.city)),
        localities: tally(
          bookings.map((b) => `${b.address.locality}, ${b.address.city}`),
        ),
        hours: tally(
          bookings.map(
            (b) =>
              `${String(zonedHourOf(b.serviceStart, HOME_TIME_ZONE)).padStart(2, '0')}:00`,
          ),
        ),
        coverageGaps: tally(
          bookings
            .filter((b) => ['NO_PROFESSIONAL', 'EXPIRED'].includes(b.status))
            .map((b) => `${b.address.locality}, ${b.address.city}`),
        ),
        cancellations: tally(
          bookings
            .filter((b) => CANCELLED.includes(b.status))
            .map((b) => b.status),
        ),
      },
      daily: tally(
        bookings.map((b) => utcToZonedDateStr(b.createdAt, HOME_TIME_ZONE)),
      ).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  // ---------- Insights: rule-based, explained, never enforced automatically ----------

  async understand(text: string) {
    const defs = await this.prisma.homeServiceDef.findMany({
      where: { status: 'ACTIVE', category: { active: true } },
      select: { code: true, name: true, nameHi: true, synonyms: true },
    });
    const intent = parseHomeRequest(text, defs);
    return {
      intent,
      note: 'Understood with built-in rules, not an AI service. Availability always comes from the booking engine.',
    };
  }

  /** Quiet in-store hours from the salon's own history. */
  async workforceAdvice(salonId: string) {
    const since = addMin(new Date(), -42 * 1440);
    const [bookings, sessions, staff] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          salonId,
          slotStart: { gte: since, lt: new Date() },
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        select: { slotStart: true },
      }),
      this.prisma.queueEntry.findMany({
        where: { salonId, bookingId: null, joinedAt: { gte: since } },
        select: { joinedAt: true },
      }),
      this.prisma.salonStaff.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);
    const points = [
      ...bookings.map((b) => b.slotStart),
      ...sessions.map((s) => s.joinedAt),
    ];
    if (points.length < 60)
      return {
        enough: false,
        message: `Not enough history yet (${points.length} visits in 6 weeks; 60 needed). No advice is given.`,
        windows: [],
      };
    const weekday = points.filter(
      (p) => ![0, 6].includes(new Date(p.getTime() + 330 * 60_000).getUTCDay()),
    );
    const perHour = Array.from(
      { length: 24 },
      (_, h) =>
        weekday.filter((p) => zonedHourOf(p, HOME_TIME_ZONE) === h).length,
    );
    const open = perHour.map((n, h) => ({ h, n })).filter((x) => x.n > 0);
    const mean = open.reduce((s, x) => s + x.n, 0) / Math.max(1, open.length);
    const quiet = open.filter((x) => x.n < mean * 0.6).map((x) => x.h);
    return {
      enough: true,
      staff,
      message: quiet.length
        ? `On weekdays your shop is usually quieter around ${quiet.map((h) => `${h}:00`).join(', ')}. You could consider home visits then. Your own staffing rules still apply and nothing is changed automatically.`
        : 'No clearly quiet hours were found.',
      windows: quiet,
      basis: `${points.length} visits in the last 6 weeks`,
    };
  }

  async pricingAdvice(providerId: string) {
    const offers = await this.prisma.homeOffering.findMany({
      where: { providerId, active: true },
      include: {
        serviceDef: true,
        provider: { select: { city: true, travelFeePaise: true } },
      },
    });
    const out: {
      offeringId: string;
      service: string;
      pricePaise: number;
      perHourPaise: number;
      completed: number;
      peers: number;
      medianPaise: number | null;
      advice: string;
    }[] = [];
    for (const o of offers) {
      const peers = await this.prisma.homeOffering.findMany({
        where: {
          serviceDefId: o.serviceDefId,
          active: true,
          providerId: { not: providerId },
          provider: {
            status: 'APPROVED',
            city: { equals: o.provider.city, mode: 'insensitive' },
          },
        },
        select: { pricePaise: true },
      });
      const done = await this.prisma.homeBookingItem.count({
        where: { offeringId: o.id, booking: { completedAt: { not: null } } },
      });
      const prices = peers.map((p) => p.pricePaise).sort((a, b) => a - b);
      out.push({
        offeringId: o.id,
        service: o.title ?? o.serviceDef.name,
        pricePaise: o.pricePaise,
        perHourPaise: Math.round(
          (o.pricePaise /
            (o.durationMinutes +
              o.serviceDef.prepMinutes +
              o.serviceDef.cleanupMinutes)) *
            60,
        ),
        completed: done,
        peers: prices.length,
        medianPaise:
          prices.length >= MIN_SAMPLE
            ? prices[Math.floor(prices.length / 2)]
            : null,
        advice:
          prices.length >= MIN_SAMPLE
            ? 'Compare with the local median. You decide; prices are never changed for you.'
            : `Only ${prices.length} comparable offers nearby – not enough for a fair comparison (${MIN_SAMPLE} needed).`,
      });
    }
    return out;
  }

  async retention(userId: string) {
    const done = await this.prisma.homeBooking.findMany({
      where: { customerId: userId, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 30,
      include: {
        items: true,
        assignments: {
          where: { status: 'COMPLETED' },
          select: {
            professionalId: true,
            professional: { select: { displayName: true } },
          },
        },
      },
    });
    const byService = new Map<string, Date[]>();
    for (const b of done)
      for (const i of b.items)
        byService.set(i.serviceName, [
          ...(byService.get(i.serviceName) ?? []),
          b.completedAt!,
        ]);
    return [...byService]
      .filter(([, d]) => d.length >= 2)
      .map(([service, d]) => {
        const gaps = d
          .slice(0, -1)
          .map((x, i) => minutesBetween(d[i + 1], x) / 1440);
        const typical = Math.round(
          gaps.reduce((a, b) => a + b, 0) / gaps.length,
        );
        return {
          service,
          typicalDays: typical,
          nextAround: addMin(d[0], typical * 1440),
          basis: `${d.length} completed visits`,
        };
      });
  }

  /** Signals for a person to look at. Nobody is blocked, ranked down or penalised by this list. */
  async riskSignals() {
    const since = addMin(new Date(), -90 * 1440);
    const [
      proNoShow,
      custNoShow,
      complaints,
      extras,
      reviews,
      payments,
      dupes,
    ] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; name: string; n: bigint }[]>(
        Prisma.sql`SELECT p."id", p."displayName" AS name, count(*) AS n FROM "home_assignments" a JOIN "home_bookings" b ON b."id"=a."bookingId" JOIN "home_professionals" p ON p."id"=a."professionalId" WHERE b."status"='PROFESSIONAL_NO_SHOW' AND b."updatedAt">=${since} GROUP BY 1,2 HAVING count(*)>=2 LIMIT 50`,
      ),
      this.prisma.homeBooking.groupBy({
        by: ['customerId'],
        where: {
          status: 'CUSTOMER_NO_SHOW',
          updatedAt: { gte: since },
          customerId: { not: null },
        },
        _count: { _all: true },
        having: { customerId: { _count: { gte: 2 } } },
      }),
      this.prisma.$queryRaw<{ id: string; name: string; n: bigint }[]>(
        Prisma.sql`SELECT pr."id", pr."displayName" AS name, count(*) AS n FROM "home_tickets" t JOIN "home_bookings" b ON b."id"=t."bookingId" JOIN "home_providers" pr ON pr."id"=b."providerId" WHERE t."openedByParty"='CUSTOMER' AND t."createdAt">=${since} GROUP BY 1,2 HAVING count(*)>=3 LIMIT 50`,
      ),
      this.prisma.homePriceAdjustment.groupBy({
        by: ['requestedByUserId'],
        where: { status: 'DECLINED', createdAt: { gte: since } },
        _count: { _all: true },
        having: { requestedByUserId: { _count: { gte: 3 } } },
      }),
      this.prisma.homeReview.groupBy({
        by: ['customerId', 'professionalId'],
        where: {
          createdAt: { gte: since },
          overall: 5,
          customerId: { not: null },
        },
        _count: { _all: true },
        having: { professionalId: { _count: { gte: 5 } } },
      }),
      this.prisma.homePaymentRecord.count({
        where: { disputedAt: { not: null }, createdAt: { gte: since } },
      }),
      this.prisma.$queryRaw<{ customerId: string; n: bigint }[]>(
        Prisma.sql`SELECT "customerId", count(*) AS n FROM "home_bookings" WHERE "customerId" IS NOT NULL AND "createdAt">=${since} AND "status" IN ('REQUESTED','INVITED','AWAITING_ASSIGNMENT','CONFIRMED') GROUP BY "customerId", "serviceStart" HAVING count(*)>=2 LIMIT 50`,
      ),
    ]);
    const n = (
      rows: { id: string; name: string; n: bigint }[],
      label: string,
    ) =>
      rows.map((r) => ({
        kind: label,
        subject: r.name,
        subjectId: r.id,
        count: Number(r.n),
      }));
    return {
      notice:
        'Signals only, from recorded events in the last 90 days. A person must review before any action.',
      signals: [
        ...n(proNoShow, 'Repeated professional no-shows'),
        ...n(complaints, 'Repeated complaints'),
        ...custNoShow.map((c) => ({
          kind: 'Repeated customer no-shows',
          subject: 'Customer',
          subjectId: c.customerId,
          count: c._count._all,
        })),
        ...extras.map((e) => ({
          kind: 'Repeated declined extra charges',
          subject: 'Professional account',
          subjectId: e.requestedByUserId,
          count: e._count._all,
        })),
        ...reviews.map((r) => ({
          kind: 'Many 5-star reviews from one customer',
          subject: 'Professional',
          subjectId: r.professionalId,
          count: r._count._all,
        })),
        ...dupes.map((d) => ({
          kind: 'Same customer, same time',
          subject: 'Customer',
          subjectId: d.customerId,
          count: Number(d.n),
        })),
        ...(payments
          ? [
              {
                kind: 'Disputed payment records',
                subject: 'See Payments',
                subjectId: null,
                count: payments,
              },
            ]
          : []),
      ],
    };
  }

  // ---------- Field sales ----------

  fieldLeads(userId: string | null) {
    return this.prisma.homeFieldLead.findMany({
      where: userId ? { employeeUserId: userId } : {},
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
  }

  async saveFieldLead(
    userId: string,
    d: {
      kind: string;
      name: string;
      phone?: string;
      city: string;
      locality?: string;
      consent: boolean;
      stage: string;
      nextStep?: string;
      nextAt?: string | null;
      providerId?: string | null;
      societyId?: string | null;
    },
    id?: string,
  ) {
    const { consent, nextAt, ...rest } = d;
    if (!consent && !['IDENTIFIED', 'CONTACTED', 'DROPPED'].includes(d.stage))
      throw homeInvalid(
        "Record the person's consent before moving past first contact.",
      );
    const prev = id
      ? await this.prisma.homeFieldLead.findFirst({
          where: { id, employeeUserId: userId },
        })
      : null;
    if (id && !prev) throw homeNotFound();
    const data = {
      ...rest,
      nextAt: nextAt ? new Date(nextAt) : null,
      consentAt: consent ? (prev?.consentAt ?? new Date()) : null,
    };
    return id
      ? this.prisma.homeFieldLead.update({ where: { id }, data })
      : this.prisma.homeFieldLead.create({
          data: { ...data, employeeUserId: userId },
        });
  }

  /** Real activation first: verified, published and completed work, not raw registrations. */
  async fieldResults() {
    const leads = await this.prisma.homeFieldLead.findMany({
      where: { providerId: { not: null } },
      select: { employeeUserId: true, providerId: true },
    });
    const providers = await this.prisma.homeProvider.findMany({
      where: { id: { in: leads.map((l) => l.providerId!) } },
      select: {
        id: true,
        status: true,
        offerings: { where: { active: true }, select: { id: true } },
        bookings: {
          where: { completedAt: { not: null } },
          select: { customerId: true },
        },
      },
    });
    const people = [...new Set(leads.map((l) => l.employeeUserId))];
    const names = await this.prisma.employeeProfile.findMany({
      where: { userId: { in: people } },
      select: { userId: true, fullName: true },
    });
    return people.map((userId) => {
      const mine = providers.filter((p) =>
        leads.some((l) => l.employeeUserId === userId && l.providerId === p.id),
      );
      return {
        userId,
        name: names.find((x) => x.userId === userId)?.fullName ?? null,
        approved: mine.filter((p) => p.status === 'APPROVED').length,
        published: mine.filter((p) => p.offerings.length).length,
        firstBooking: mine.filter((p) => p.bookings.length > 0).length,
        completed: mine.reduce((s, p) => s + p.bookings.length, 0),
      };
    });
  }

  audit(q: { entityType?: string; entityId?: string }) {
    return this.prisma.homeAudit.findMany({
      where: { entityType: q.entityType, entityId: q.entityId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  settings() {
    return this.core.settings();
  }
  saveSettings(adminId: string, patch: Partial<HomeSettings>) {
    return this.core.saveSettings(adminId, patch);
  }
}
