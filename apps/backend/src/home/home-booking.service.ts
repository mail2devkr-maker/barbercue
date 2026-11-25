import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type HomeBookingStatus } from '@prisma/client';
import {
  HOME_ASSIGNED_ACTIVE,
  HOME_SEARCHING,
  HOME_SERVED,
  HOME_TERMINAL,
  HOME_TERMS_VERSION,
  HOME_TRACKABLE,
  HomeErrorCode,
  OtpPurpose,
  homeProviderLabel,
  homeTransitionAllowed,
  type HomeBookingInput,
  type HomeParty,
  type HomeQuoteInput,
  type HomeSettings,
} from '@barbercue/shared';
import { OtpService } from '../auth/services/otp.service';
import { DbDeadlineSchedulerService } from '../common/db-deadline-scheduler/db-deadline-scheduler.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  HomeAvailabilityService,
  type VisitNeed,
} from './home-availability.service';
import { verifiedBadges } from './home-catalog.service';
import {
  HomeCoreService,
  TX,
  addMin,
  newBookingCode,
  newToken,
  sha256,
  type Tx,
} from './home-core.service';
import {
  homeError,
  homeForbidden,
  homeInvalid,
  homeNotFound,
  homeState,
  homeUnavailable,
  isOverlapViolation,
} from './home-errors';
import {
  HomeQuoteService,
  REASON_TEXT,
  type QuoteOption,
} from './home-quote.service';

export interface HomeViewer {
  userId: string | null;
  guestToken?: string | null;
  admin?: boolean;
}
export interface BookingAccess {
  id: string;
  party: HomeParty;
  customer: boolean;
}

const bookingInclude = {
  items: {
    orderBy: { id: 'asc' as const },
    include: {
      offering: { include: { serviceDef: { include: { category: true } } } },
    },
  },
  provider: {
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          ownerUserId: true,
          phone: true,
          showPhoneToCustomers: true,
        },
      },
    },
  },
  address: true,
  assignments: {
    orderBy: { assignedAt: 'desc' as const },
    include: {
      professional: {
        include: {
          user: { select: { id: true, phone: true } },
          verifications: true,
        },
      },
    },
  },
  invitations: {
    orderBy: { createdAt: 'desc' as const },
    include: { professional: { select: { displayName: true, userId: true } } },
  },
  payments: { orderBy: { createdAt: 'asc' as const } },
  adjustments: { orderBy: { createdAt: 'asc' as const } },
  refunds: true,
  review: true,
  hygiene: true,
  tickets: {
    select: {
      id: true,
      number: true,
      category: true,
      status: true,
      createdAt: true,
    },
  },
  customer: { select: { id: true, phone: true, email: true } },
} satisfies Prisma.HomeBookingInclude;
export type FullBooking = Prisma.HomeBookingGetPayload<{
  include: typeof bookingInclude;
}>;

@Injectable()
export class HomeBookingService implements OnModuleInit {
  private readonly logger = new Logger(HomeBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: HomeCoreService,
    private readonly quotes: HomeQuoteService,
    private readonly availability: HomeAvailabilityService,
    private readonly salonAccess: SalonAccessService,
    private readonly otp: OtpService,
    private readonly deadlines: DbDeadlineSchedulerService,
  ) {}

  onModuleInit(): void {
    this.deadlines.register({
      name: 'home-dispatch',
      domain: 'home',
      nextDueAt: () => this.nextDueAt(),
      runDue: async () => {
        await this.sweep();
      },
    });
  }

  signal(): void {
    this.deadlines.signal('home');
  }

  // ---------- Access ----------

  async access(code: string, viewer: HomeViewer): Promise<BookingAccess> {
    const b = await this.prisma.homeBooking.findUnique({
      where: { code },
      select: {
        id: true,
        customerId: true,
        guestAccessHash: true,
        provider: { select: { userId: true, salonId: true } },
        assignments: {
          where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
          select: { professional: { select: { userId: true } } },
        },
      },
    });
    if (b) {
      if (viewer.admin) return { id: b.id, party: 'ADMIN', customer: false };
      if (viewer.userId && b.customerId === viewer.userId)
        return { id: b.id, party: 'CUSTOMER', customer: true };
      if (
        viewer.guestToken &&
        b.guestAccessHash &&
        sha256(viewer.guestToken) === b.guestAccessHash
      )
        return { id: b.id, party: 'CUSTOMER', customer: true };
      if (
        viewer.userId &&
        b.assignments.some((a) => a.professional.userId === viewer.userId)
      )
        return { id: b.id, party: 'PROFESSIONAL', customer: false };
      if (viewer.userId && b.provider.userId === viewer.userId)
        return { id: b.id, party: 'PROVIDER', customer: false };
      if (
        viewer.userId &&
        b.provider.salonId &&
        (await this.ownsSalon(viewer.userId, b.provider.salonId))
      )
        return { id: b.id, party: 'PROVIDER', customer: false };
    }
    // The same answer for "does not exist" and "not yours": a code alone reveals nothing.
    throw homeNotFound('Booking not found.');
  }

  async ownsSalon(userId: string, salonId: string): Promise<boolean> {
    try {
      await this.salonAccess.assertOwnerAccess(userId, salonId);
      return true;
    } catch {
      return false;
    }
  }

  async require(
    code: string,
    viewer: HomeViewer,
    parties: HomeParty[],
  ): Promise<BookingAccess> {
    const a = await this.access(code, viewer);
    if (!parties.includes(a.party)) throw homeForbidden();
    return a;
  }

  // ---------- State ----------

  async lockBooking(tx: Tx, id: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "home_bookings" WHERE "id" = ${id} FOR UPDATE`,
    );
    return tx.homeBooking.findUniqueOrThrow({
      where: { id },
      include: bookingInclude,
    });
  }

  async transition(
    tx: Tx,
    b: { id: string; status: HomeBookingStatus },
    to: HomeBookingStatus,
    actor: { party: HomeParty; userId?: string | null },
    note?: string | null,
    data: Prisma.HomeBookingUncheckedUpdateInput = {},
  ) {
    if (!homeTransitionAllowed(b.status, to, actor.party))
      throw homeState(
        `This cannot be done while the booking is "${b.status.toLowerCase().replace(/_/g, ' ')}".`,
        { from: b.status, to },
      );
    await tx.homeBooking.update({
      where: { id: b.id },
      data: { ...data, status: to },
    });
    await this.core.event(tx, b.id, {
      kind: 'STATUS',
      from: b.status,
      to,
      actorUserId: actor.userId,
      party: actor.party,
      note,
    });
    b.status = to;
  }

  activeAssignment(b: FullBooking) {
    return b.assignments.find((a) => a.status === 'ACTIVE') ?? null;
  }

  /** Frees the person's time, closes invitations, ends and erases tracking, kills codes. */
  async release(tx: Tx, bookingId: string, reason: string) {
    const now = new Date();
    await tx.professionalCommitment.updateMany({
      where: { bookingId, releasedAt: null },
      data: { releasedAt: now },
    });
    await tx.homeAssignment.updateMany({
      where: { bookingId, status: 'ACTIVE' },
      data: {
        status: 'RELEASED',
        releasedAt: now,
        releaseReason: reason.slice(0, 300),
      },
    });
    await tx.homeInvitation.updateMany({
      where: { bookingId, status: 'PENDING' },
      data: { status: 'WITHDRAWN', respondedAt: now },
    });
    await this.endTracking(tx, bookingId, reason);
    await tx.homeServiceCode.updateMany({
      where: { bookingId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async endTracking(tx: Tx, bookingId: string, reason: string) {
    await tx.homeTrackingSession.updateMany({
      where: { bookingId, endedAt: null },
      data: {
        endedAt: new Date(),
        endReason: reason.slice(0, 60),
        lastLat: null,
        lastLng: null,
        lastAccuracyM: null,
      },
    });
  }

  // ---------- Hold ----------

  async hold(q: HomeQuoteInput, customerId: string | null) {
    const result = await this.quotes.quote(q, customerId);
    const option = result.options[0];
    if (!option) throw this.noOption(result.rejected);
    const expiresAt = addMin(new Date(), result.settings.holdMinutes);
    const row = await this.reserve(
      option.pro.id,
      option.need,
      option.serviceStart,
      {
        kind: 'HOME_HOLD',
        expiresAt,
      },
    );
    return {
      holdId: row.id,
      professionalId: option.pro.id,
      expiresAt: expiresAt.toISOString(),
      option: this.quotes.optionDto(option),
    };
  }

  private noOption(rejected: { reason: string; count: number }[]) {
    return homeUnavailable(
      rejected.length
        ? `No one is available for this: ${rejected.map((r) => REASON_TEXT[r.reason] ?? r.reason).join('; ')}.`
        : 'No one is available for this right now. Try another time.',
      { reasons: rejected },
    );
  }

  private async reserve(
    professionalId: string,
    need: VisitNeed,
    serviceStart: Date,
    data: {
      kind: 'HOME_HOLD' | 'HOME_BOOKING';
      expiresAt: Date | null;
      bookingId?: string;
    },
    exclude: { bookingId?: string; holdIds?: string[] } = {},
    tx?: Tx,
  ) {
    const run = async (t: Tx) => {
      const pro = await this.availability.lock(t, professionalId);
      const ev = await this.availability.evaluateLocked(
        t,
        professionalId,
        need,
        serviceStart,
        exclude,
      );
      if (!ev.ok)
        throw homeUnavailable(REASON_TEXT[ev.reason!], { reason: ev.reason });
      return t.professionalCommitment.create({
        data: {
          userId: pro.userId,
          kind: data.kind,
          startAt: ev.blockStart,
          endAt: ev.blockEnd,
          serviceStart,
          serviceEnd: addMin(serviceStart, need.serviceMinutes),
          lat: need.location.lat,
          lng: need.location.lng,
          postalCode: need.location.postalCode ?? null,
          bookingId: data.bookingId ?? null,
          expiresAt: data.expiresAt,
        },
      });
    };
    try {
      return tx ? await run(tx) : await this.prisma.$transaction(run, TX);
    } catch (err) {
      if (isOverlapViolation(err)) throw homeUnavailable();
      throw err;
    }
  }

  async releaseHold(holdId: string) {
    await this.prisma.professionalCommitment.updateMany({
      where: {
        id: holdId,
        kind: 'HOME_HOLD',
        bookingId: null,
        releasedAt: null,
      },
      data: { releasedAt: new Date() },
    });
  }

  // ---------- Create ----------

  async create(
    input: HomeBookingInput,
    customerId: string | null,
    idempotencyKey: string,
    extra: {
      recurringPlanId?: string;
      campaign?: { id: string; discountPct: number };
    } = {},
  ) {
    const scope = customerId ?? `guest:${input.guest?.phone ?? ''}`;
    const key = sha256(`${scope}:${idempotencyKey}`);
    const existing = await this.prisma.homeBooking.findUnique({
      where: { idempotencyKey: key },
    });
    if (existing)
      return {
        code: existing.code,
        status: existing.status,
        guestToken: null,
        replayed: true,
      };
    if (!customerId && !input.guest)
      throw homeInvalid(
        'Sign in, or enter your name and mobile number to book as a guest.',
      );
    if (!customerId && input.quote.addressId)
      throw homeInvalid('Enter the service address.');
    const q = input.quote;
    const result = await this.quotes.quote(q, customerId, {
      excludeHoldIds: input.holdId ? [input.holdId] : undefined,
    });
    const hold = input.holdId
      ? await this.prisma.professionalCommitment.findFirst({
          where: {
            id: input.holdId,
            kind: 'HOME_HOLD',
            bookingId: null,
            releasedAt: null,
            expiresAt: { gt: new Date() },
          },
        })
      : null;
    if (input.holdId && !hold)
      throw homeError(
        HomeErrorCode.HOLD_EXPIRED,
        'Your reserved time has expired. Please choose a time again.',
        HttpStatus.CONFLICT,
      );
    const option = hold
      ? result.options.find((o) => o.pro.userId === hold.userId)
      : result.options[0];
    if (!option) throw this.noOption(result.rejected);
    let price = option.price;
    if (extra.campaign)
      price = (
        await this.quotes.price(
          option.provider,
          option.pro,
          option.area,
          option.items,
          option.serviceStart,
          q,
          extra.campaign.discountPct,
        )
      ).price;
    if (price.totalPaise !== input.expectedTotalPaise)
      throw homeError(
        HomeErrorCode.PRICE_CHANGED,
        'The price has changed since you saw it. Please review the new total.',
        HttpStatus.CONFLICT,
        { totalPaise: price.totalPaise, price },
      );
    for (const i of option.items) {
      const def = i.offering.serviceDef;
      if (def.forChildren && !(input.forChild && input.guardianConfirmed))
        throw homeInvalid(
          "For children's services a parent or guardian must confirm they will be present.",
        );
      if (input.productPreference === 'CUSTOMER' && !def.customerProducts)
        throw homeInvalid(
          `${i.name} needs the professional's own approved products.`,
        );
    }
    if (input.paymentMethod === 'DIRECT_UPI' && !option.provider.upiVpa)
      throw homeInvalid(
        'This provider does not take direct UPI. Choose cash or another method.',
      );
    const guestToken = customerId ? null : newToken();
    const draft = !customerId;
    const now = new Date();
    const bookingId = await this.prisma.$transaction(async (tx) => {
      const addressId =
        q.addressId ??
        (
          await tx.homeAddress.create({
            data: {
              ...q.address!,
              userId: customerId,
              lat: q.address!.lat ?? null,
              lng: q.address!.lng ?? null,
            },
          })
        ).id;
      const b = await tx.homeBooking.create({
        data: {
          code: newBookingCode(),
          customerId,
          guestName: input.guest?.name ?? null,
          guestPhone: customerId ? null : input.guest!.phone,
          guestAccessHash: guestToken ? sha256(guestToken) : null,
          groupKey: input.groupKey ?? null,
          providerId: option.provider.id,
          addressId,
          mode: q.mode,
          preference: q.preference,
          preferredProfessionalId:
            q.preference === 'SPECIFIC_PROFESSIONAL' ? q.professionalId! : null,
          allowAlternatives:
            q.preference === 'FASTEST' ? true : input.allowAlternatives,
          status: draft ? 'DRAFT' : 'REQUESTED',
          paymentMethod: input.paymentMethod,
          serviceStart: option.serviceStart,
          serviceEnd: option.serviceEnd,
          etaFrom: option.eta.windowFrom,
          etaTo: option.eta.windowTo,
          etaConfidence: option.eta.confidence,
          etaBasis: option.etaBasis as Prisma.InputJsonValue,
          totalPaise: price.totalPaise,
          priceSnapshot: price as unknown as Prisma.InputJsonValue,
          termsSnapshot: {
            termsVersion: HOME_TERMS_VERSION,
            cancellation: result.settings.cancellationPolicy,
            reService: result.settings.reServicePolicy,
            providerKind: option.provider.kind,
            providerName: option.provider.displayName,
            collectedBy: option.provider.displayName,
            invoiceIssuedBy:
              option.provider.invoiceIssuer ?? option.provider.displayName,
            acceptedAt: now.toISOString(),
          },
          notes: input.notes || null,
          productPreference: input.productPreference,
          forChild: input.forChild,
          guardianConfirmed: input.guardianConfirmed,
          idempotencyKey: key,
          promotionId: option.promotionId,
          recurringPlanId: extra.recurringPlanId ?? null,
          campaignId: extra.campaign?.id ?? null,
          dispatchDeadline: draft ? addMin(now, 30) : null,
          items: {
            create: option.items.map((i) => ({
              offeringId: i.offering.id,
              serviceDefId: i.offering.serviceDefId,
              serviceName: i.name.slice(0, 120),
              variantCode: i.variantCode,
              personName: i.personName,
              quantity: i.quantity,
              unitPaise: i.servicePaise,
              lineTotalPaise: i.servicePaise * i.quantity,
              durationMinutes: i.durationMinutes,
            })),
          },
        },
      });
      await this.core.event(tx, b.id, {
        kind: 'CREATED',
        to: b.status,
        actorUserId: customerId,
        party: 'CUSTOMER',
        metadata: {
          mode: q.mode,
          preference: q.preference,
          totalPaise: price.totalPaise,
        },
      });
      if (hold)
        await tx.professionalCommitment.update({
          where: { id: hold.id },
          data: { bookingId: b.id },
        });
      return b.id;
    }, TX);
    if (!draft) await this.dispatch(bookingId);
    this.signal();
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { code: true, status: true },
    });
    return { ...b, guestToken, replayed: false };
  }

  // ---------- Guest phone verification (existing OTP service, budgets and provider) ----------

  async guestSendCode(code: string, viewer: HomeViewer) {
    const a = await this.require(code, viewer, ['CUSTOMER']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
    });
    if (!b.guestPhone || b.guestPhoneVerifiedAt)
      throw homeState('This phone is already verified.');
    return this.otp.requestOtp(b.guestPhone, OtpPurpose.PHONE_LINK);
  }

  async guestVerify(code: string, viewer: HomeViewer, otp: string) {
    const a = await this.require(code, viewer, ['CUSTOMER']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
    });
    if (!b.guestPhone) throw homeState('This is not a guest booking.');
    if (!b.guestPhoneVerifiedAt) {
      await this.otp.verifyOtp(b.guestPhone, otp, OtpPurpose.PHONE_LINK);
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockBooking(tx, b.id);
        await tx.homeBooking.update({
          where: { id: b.id },
          data: { guestPhoneVerifiedAt: new Date(), dispatchDeadline: null },
        });
        if (locked.status === 'DRAFT')
          await this.transition(
            tx,
            locked,
            'REQUESTED',
            { party: 'CUSTOMER' },
            'Guest phone verified',
          );
      }, TX);
      await this.dispatch(b.id);
    }
    return this.view(code, viewer);
  }

  // ---------- Dispatch ----------

  async dispatch(bookingId: string): Promise<void> {
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: bookingInclude,
    });
    if (b.status !== 'REQUESTED') return;
    const p = b.provider;
    if (
      p.kind === 'SALON_MANAGED' &&
      (p.manualApproval || !p.autoDispatch) &&
      b.preference !== 'FASTEST'
    ) {
      const settings = await this.core.settings();
      const deadline = this.acceptDeadline(b, settings);
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockBooking(tx, b.id);
        if (locked.status !== 'REQUESTED') return;
        await this.transition(
          tx,
          locked,
          'AWAITING_ASSIGNMENT',
          { party: 'SYSTEM' },
          null,
          { dispatchDeadline: deadline },
        );
        await tx.professionalCommitment.updateMany({
          where: { bookingId: b.id, kind: 'HOME_HOLD', releasedAt: null },
          data: { expiresAt: deadline },
        });
      }, TX);
      await this.core.notify(
        p.salon?.ownerUserId,
        'home.provider.update',
        `${b.id}:assign`,
        'Home booking needs a professional',
        `${b.items.map((i) => i.serviceName).join(', ')} – please assign a professional.`,
        `/dashboard/salons/${p.salonId}/home-services?tab=incoming`,
        { code: b.code },
      );
      return;
    }
    await this.inviteNext(bookingId);
  }

  private acceptDeadline(
    b: { mode: string; serviceStart: Date },
    s: HomeSettings,
  ): Date {
    const now = new Date();
    if (b.mode === 'INSTANT')
      return new Date(now.getTime() + s.instantAcceptSeconds * 1000);
    const cut = addMin(now, s.scheduledAcceptMinutes);
    return cut < b.serviceStart ? cut : addMin(b.serviceStart, -5);
  }

  needFromBooking(b: FullBooking): VisitNeed {
    const defs = b.items.map((i) => i.offering?.serviceDef).filter((d) => !!d);
    return {
      serviceMinutes: b.items.reduce(
        (s, i) => s + i.durationMinutes * i.quantity,
        0,
      ),
      prepMinutes: Math.max(5, ...defs.map((d) => d.prepMinutes)),
      cleanupMinutes: Math.max(5, ...defs.map((d) => d.cleanupMinutes)),
      location: {
        lat: b.address.lat,
        lng: b.address.lng,
        postalCode: b.address.postalCode,
      },
      instant: b.mode === 'INSTANT',
    };
  }

  /** Sequential (or limited parallel) invitations to people who are eligible right now. */
  async inviteNext(bookingId: string): Promise<void> {
    const settings = await this.core.settings();
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: bookingInclude,
    });
    if (
      !HOME_SEARCHING.includes(b.status) &&
      b.status !== 'REPLACEMENT_REQUESTED'
    )
      return;
    const pending = b.invitations.filter(
      (i) => i.status === 'PENDING' && i.expiresAt > new Date(),
    ).length;
    if (pending >= settings.parallelInvites) return;
    const tried = [...new Set(b.invitations.map((i) => i.professionalId))];
    const released = b.assignments
      .filter((a) => a.status === 'RELEASED')
      .map((a) => a.professionalId);
    let options: QuoteOption[] = [];
    if (tried.length < settings.maxDispatchRounds) {
      const pinned =
        b.preference === 'SPECIFIC_PROFESSIONAL' && !b.allowAlternatives;
      const base = {
        addressId: b.addressId,
        mode: b.mode,
        startAt:
          b.mode === 'SCHEDULED' ? b.serviceStart.toISOString() : undefined,
      };
      const place = {
        postalCode: b.address.postalCode,
        locality: b.address.locality,
        city: b.address.city,
        society: b.address.building,
        lat: b.address.lat,
        lng: b.address.lng,
      };
      const opts = {
        internal: true,
        place,
        excludeBookingId: b.id,
        excludeProfessionalIds: [...tried, ...released],
      };
      const sameItems = b.items
        .filter((i) => !i.addedLater && i.offeringId)
        .map((i) => ({
          offeringId: i.offeringId!,
          variantCode: i.variantCode ?? undefined,
          quantity: i.quantity,
        }));
      const attempt = async (q: HomeQuoteInput, cap?: number) => {
        try {
          return (
            await this.quotes.quote(q, b.customerId, {
              ...opts,
              maxTotalPaise: cap,
            })
          ).options;
        } catch {
          return [];
        }
      };
      if (
        b.preferredProfessionalId &&
        !tried.includes(b.preferredProfessionalId) &&
        !released.includes(b.preferredProfessionalId)
      )
        options = await attempt({
          ...base,
          items: sameItems,
          preference: 'SPECIFIC_PROFESSIONAL',
          professionalId: b.preferredProfessionalId,
        });
      if (options.length === 0 && !pinned)
        options = await attempt({
          ...base,
          items: sameItems,
          preference: 'SPECIFIC_PROVIDER',
          providerId: b.providerId,
        });
      // Another provider may only be asked when the customer agreed, and never at a higher price.
      if (
        options.length === 0 &&
        b.preference === 'FASTEST' &&
        b.allowAlternatives
      ) {
        const codes = b.items
          .filter((i) => !i.addedLater)
          .map((i) => ({
            serviceCode: i.offering!.serviceDef.code,
            quantity: i.quantity,
          }));
        options = (
          await attempt(
            { ...base, items: codes, preference: 'FASTEST' },
            b.totalPaise,
          )
        ).filter((o) => o.provider.id !== b.providerId);
      }
    }
    let invited = pending;
    for (const o of options) {
      if (invited >= settings.parallelInvites) break;
      const expiresAt = this.acceptDeadline(
        { mode: b.mode, serviceStart: o.serviceStart },
        settings,
      );
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.availability.lock(tx, o.pro.id);
          const locked = await this.lockBooking(tx, b.id);
          if (
            !HOME_SEARCHING.includes(locked.status) &&
            locked.status !== 'REPLACEMENT_REQUESTED'
          )
            throw homeState('Booking is no longer searching.');
          // A checkout hold for this same person becomes the invitation hold.
          await tx.professionalCommitment.updateMany({
            where: {
              bookingId: b.id,
              kind: 'HOME_HOLD',
              userId: o.pro.userId,
              releasedAt: null,
            },
            data: { releasedAt: new Date() },
          });
          await this.reserve(
            o.pro.id,
            o.need,
            o.serviceStart,
            { kind: 'HOME_HOLD', expiresAt, bookingId: b.id },
            { bookingId: b.id },
            tx,
          );
          await tx.homeInvitation.create({
            data: {
              bookingId: b.id,
              professionalId: o.pro.id,
              round: tried.length + 1 + invited,
              reason: o.reasons.join(', ').slice(0, 200),
              expiresAt,
            },
          });
          if (locked.status !== 'INVITED')
            await this.transition(
              tx,
              locked,
              'INVITED',
              { party: 'SYSTEM' },
              null,
              { dispatchDeadline: expiresAt },
            );
          else
            await tx.homeBooking.update({
              where: { id: b.id },
              data: { dispatchDeadline: expiresAt },
            });
          await this.core.event(tx, b.id, {
            kind: 'INVITED',
            party: 'SYSTEM',
            note: o.reasons.join(', '),
            metadata: {
              professionalId: o.pro.id,
              providerId: o.provider.id,
              travelMinutes: o.travelMinutes,
            },
          });
        }, TX);
        invited += 1;
        await this.core.notify(
          o.pro.userId,
          'home.professional.update',
          `${b.id}:invite:${o.pro.id}:${tried.length + 1}`,
          'New home booking request',
          `${b.items.map((i) => i.serviceName).join(', ')} in ${b.address.locality}. Please respond before it expires.`,
          '/home-pro?tab=requests',
          { code: b.code },
        );
      } catch (err) {
        this.logger.debug(
          `Invite skipped: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
    if (invited === 0) {
      const done = await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockBooking(tx, b.id);
        if (!homeTransitionAllowed(locked.status, 'NO_PROFESSIONAL', 'SYSTEM'))
          return false;
        if (
          locked.invitations.some(
            (i) => i.status === 'PENDING' && i.expiresAt > new Date(),
          )
        )
          return false;
        await this.transition(
          tx,
          locked,
          'NO_PROFESSIONAL',
          { party: 'SYSTEM' },
          null,
          { dispatchDeadline: null },
        );
        await this.release(tx, b.id, 'NO_PROFESSIONAL');
        return true;
      }, TX);
      if (done)
        await this.notifyCustomer(
          b,
          'no-professional',
          'No professional available',
          'Nobody could take this booking. You can choose another time, another professional, or cancel free of charge.',
        );
    } else if (tried.length > 0) {
      await this.notifyCustomer(
        b,
        `delay:${tried.length}`,
        'Still finding a professional',
        'The previous professional could not take it, so we are asking another one.',
      );
    }
    this.signal();
  }

  notifyCustomer(
    b: { id: string; code: string; customerId: string | null },
    key: string,
    title: string,
    body: string,
  ) {
    return this.core.notify(
      b.customerId,
      'home.booking.update',
      `${b.id}:${key}`,
      title,
      body,
      `/home-services/tracking/${b.code}`,
      { code: b.code },
    );
  }

  async notifyProfessional(
    bookingId: string,
    key: string,
    title: string,
    body: string,
  ) {
    const a = await this.prisma.homeAssignment.findFirst({
      where: { bookingId },
      orderBy: { assignedAt: 'desc' },
      select: {
        professional: { select: { userId: true } },
        booking: { select: { code: true } },
      },
    });
    if (a)
      await this.core.notify(
        a.professional.userId,
        'home.professional.update',
        `${bookingId}:${key}`,
        title,
        body,
        '/home-pro?tab=active',
        { code: a.booking.code },
      );
  }

  // ---------- Invitation responses ----------

  async accept(invitationId: string, userId: string) {
    const inv = await this.prisma.homeInvitation.findUnique({
      where: { id: invitationId },
      include: { professional: { select: { id: true, userId: true } } },
    });
    if (!inv || inv.professional.userId !== userId)
      throw homeNotFound('Request not found.');
    const closed = () =>
      homeError(
        HomeErrorCode.INVITATION_CLOSED,
        'This request is no longer open.',
        HttpStatus.CONFLICT,
      );
    const b = await this.confirmWith(
      inv.bookingId,
      inv.professionalId,
      { party: 'PROFESSIONAL', userId },
      async (tx, booking) => {
        const fresh = await tx.homeInvitation.findUniqueOrThrow({
          where: { id: invitationId },
        });
        if (
          fresh.status !== 'PENDING' ||
          fresh.expiresAt <= new Date() ||
          booking.status !== 'INVITED'
        )
          throw closed();
        await tx.homeInvitation.update({
          where: { id: invitationId },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
      },
    );
    return { code: b.code, status: b.status };
  }

  /**
   * The only path that creates an assignment. Locks: salon(s) -> professional -> booking row. The
   * person's whole calendar is re-checked, the exclusion constraint is the last line of defence, and a
   * partial unique index allows one active assignment per booking.
   */
  async confirmWith(
    bookingId: string,
    professionalId: string,
    actor: { party: HomeParty; userId: string | null },
    precheck?: (tx: Tx, b: FullBooking) => Promise<void>,
    serviceStart?: Date,
  ): Promise<{ code: string; status: HomeBookingStatus }> {
    let out: FullBooking;
    try {
      out = await this.prisma.$transaction(async (tx) => {
        const pro = await this.availability.lock(tx, professionalId);
        const b = await this.lockBooking(tx, bookingId);
        await precheck?.(tx, b);
        if (this.activeAssignment(b))
          throw homeState('This booking already has an assigned professional.');
        const now = new Date();
        const mine = await tx.professionalCommitment.findFirst({
          where: {
            bookingId,
            userId: pro.userId,
            kind: 'HOME_HOLD',
            releasedAt: null,
            expiresAt: { gt: now },
          },
        });
        const need = this.needFromBooking(b);
        const start = serviceStart ?? mine?.serviceStart ?? b.serviceStart;
        let blockStart: Date;
        let blockEnd: Date;
        const ev = await this.availability.evaluateLocked(
          tx,
          professionalId,
          need,
          start,
          { bookingId },
        );
        if (ev.ok) {
          blockStart = ev.blockStart;
          blockEnd = ev.blockEnd;
        } else if (mine && ev.reason === 'TRAVEL') {
          // Accepting a moment after the request: the held window still stands (instant lead just shrank).
          blockStart = mine.startAt;
          blockEnd = mine.endAt;
        } else
          throw homeUnavailable(REASON_TEXT[ev.reason!], { reason: ev.reason });
        await tx.professionalCommitment.updateMany({
          where: { bookingId, releasedAt: null, kind: 'HOME_HOLD' },
          data: { releasedAt: now },
        });
        await tx.professionalCommitment.create({
          data: {
            userId: pro.userId,
            kind: 'HOME_BOOKING',
            startAt: blockStart,
            endAt: blockEnd,
            serviceStart: start,
            serviceEnd: addMin(start, need.serviceMinutes),
            lat: b.address.lat,
            lng: b.address.lng,
            postalCode: b.address.postalCode,
            bookingId,
          },
        });
        await tx.homeAssignment.create({
          data: { bookingId, professionalId, assignedByUserId: actor.userId },
        });
        await tx.homeInvitation.updateMany({
          where: { bookingId, status: 'PENDING' },
          data: { status: 'WITHDRAWN', respondedAt: now },
        });
        const data: Prisma.HomeBookingUncheckedUpdateInput = {
          serviceStart: start,
          serviceEnd: addMin(start, need.serviceMinutes),
          dispatchDeadline: null,
          replacementProposedId: null,
        };
        if (pro.providerId !== b.providerId) {
          const moved = await this.repriceForProvider(
            tx,
            b,
            pro.providerId,
            professionalId,
          );
          Object.assign(data, moved);
        }
        await this.transition(tx, b, 'ACCEPTED', actor, null, data);
        await this.transition(tx, b, 'CONFIRMED', { party: 'SYSTEM' });
        return this.lockBooking(tx, bookingId);
      }, TX);
    } catch (err) {
      if (isOverlapViolation(err)) throw homeUnavailable();
      throw err;
    }
    await this.notifyCustomer(
      out,
      `confirmed:${professionalId}`,
      'Home booking confirmed',
      `${this.activeAssignment(out)?.professional.displayName ?? 'Your professional'} will serve you.`,
    );
    await this.core.notify(
      out.provider.salon?.ownerUserId,
      'home.provider.update',
      `${out.id}:confirmed`,
      'Home booking confirmed',
      `${out.code} is confirmed.`,
      `/dashboard/salons/${out.provider.salonId}/home-services?tab=upcoming`,
      { code: out.code },
    );
    this.signal();
    return out;
  }

  /** The customer agreed to alternatives: same services, other provider, price never higher. */
  private async repriceForProvider(
    tx: Tx,
    b: FullBooking,
    providerId: string,
    professionalId: string,
  ) {
    const result = await this.quotes.quote(
      {
        addressId: b.addressId,
        items: b.items.map((i) => ({
          serviceCode: i.offering!.serviceDef.code,
          quantity: i.quantity,
        })),
        mode: b.mode,
        startAt: b.serviceStart.toISOString(),
        preference: 'SPECIFIC_PROFESSIONAL',
        professionalId,
      },
      b.customerId,
      {
        internal: true,
        excludeBookingId: b.id,
        place: {
          postalCode: b.address.postalCode,
          locality: b.address.locality,
          city: b.address.city,
          society: b.address.building,
          lat: b.address.lat,
          lng: b.address.lng,
        },
      },
    );
    const o = result.options[0];
    if (!o || o.price.totalPaise > b.totalPaise)
      throw homeUnavailable(
        'The price for this professional is higher than you agreed.',
      );
    await tx.homeBookingItem.deleteMany({ where: { bookingId: b.id } });
    await tx.homeBookingItem.createMany({
      data: o.items.map((i) => ({
        bookingId: b.id,
        offeringId: i.offering.id,
        serviceDefId: i.offering.serviceDefId,
        serviceName: i.name.slice(0, 120),
        quantity: i.quantity,
        unitPaise: i.servicePaise,
        lineTotalPaise: i.servicePaise * i.quantity,
        durationMinutes: i.durationMinutes,
      })),
    });
    await this.core.event(tx, b.id, {
      kind: 'PROVIDER_CHANGED',
      party: 'SYSTEM',
      note: 'Customer allowed alternatives; the price did not increase.',
      metadata: {
        fromProviderId: b.providerId,
        toProviderId: providerId,
        fromPaise: b.totalPaise,
        toPaise: o.price.totalPaise,
      },
    });
    return {
      providerId,
      totalPaise: o.price.totalPaise,
      priceSnapshot: o.price as unknown as Prisma.InputJsonValue,
      termsSnapshot: {
        ...(b.termsSnapshot as object),
        providerKind: o.provider.kind,
        providerName: o.provider.displayName,
        collectedBy: o.provider.displayName,
        invoiceIssuedBy: o.provider.invoiceIssuer ?? o.provider.displayName,
      },
    };
  }

  async decline(invitationId: string, userId: string, note?: string) {
    const inv = await this.prisma.homeInvitation.findUnique({
      where: { id: invitationId },
      include: { professional: { select: { userId: true } } },
    });
    if (!inv || inv.professional.userId !== userId)
      throw homeNotFound('Request not found.');
    const changed = await this.prisma.homeInvitation.updateMany({
      where: { id: invitationId, status: 'PENDING' },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
        declineNote: note?.slice(0, 300) ?? null,
      },
    });
    if (changed.count === 0)
      throw homeError(
        HomeErrorCode.INVITATION_CLOSED,
        'This request is no longer open.',
        HttpStatus.CONFLICT,
      );
    await this.prisma.professionalCommitment.updateMany({
      where: {
        bookingId: inv.bookingId,
        userId,
        kind: 'HOME_HOLD',
        releasedAt: null,
      },
      data: { releasedAt: new Date() },
    });
    // Declining is always fine: it is recorded for dispatch only and never lowers a score.
    await this.core.event(this.prisma, inv.bookingId, {
      kind: 'DECLINED',
      party: 'PROFESSIONAL',
      actorUserId: userId,
    });
    await this.inviteNext(inv.bookingId);
    return { ok: true };
  }

  /** Owner: direct assignment of own authorised staff. The customer's named choice is never replaced silently. */
  async ownerAssign(bookingId: string, professionalId: string, userId: string) {
    return this.confirmWith(
      bookingId,
      professionalId,
      { party: 'PROVIDER', userId },
      async (tx, b) => {
        const pro = await tx.homeProfessional.findUniqueOrThrow({
          where: { id: professionalId },
          include: { services: true },
        });
        if (pro.providerId !== b.providerId)
          throw homeForbidden(
            'That professional is not part of this provider.',
          );
        if (
          b.items.some(
            (i) =>
              i.offeringId &&
              !pro.services.some((s) => s.offeringId === i.offeringId),
          )
        )
          throw homeInvalid(
            'That professional is not assigned to every booked service.',
          );
        if (
          b.preference === 'SPECIFIC_PROFESSIONAL' &&
          b.preferredProfessionalId !== professionalId
        )
          throw homeState(
            'The customer chose a specific professional. Propose a replacement and wait for their approval.',
          );
      },
    );
  }

  /** Dispatcher: sends an invitation. Acceptance stays with the professional. */
  async adminInvite(
    bookingId: string,
    professionalId: string,
    userId: string,
    note: string,
  ) {
    const settings = await this.core.settings();
    await this.prisma.$transaction(async (tx) => {
      const pro = await this.availability.lock(tx, professionalId);
      const b = await this.lockBooking(tx, bookingId);
      if (
        b.preference === 'SPECIFIC_PROFESSIONAL' &&
        b.preferredProfessionalId !== professionalId &&
        !b.allowAlternatives
      )
        throw homeState(
          'The customer chose a specific professional. Propose a replacement instead.',
        );
      if (pro.providerId !== b.providerId && !b.allowAlternatives)
        throw homeState(
          'The customer chose this provider. Propose a replacement instead.',
        );
      const need = this.needFromBooking(b);
      const expiresAt = this.acceptDeadline(b, settings);
      const round = b.invitations.length + 1;
      await this.reserve(
        professionalId,
        need,
        b.serviceStart,
        { kind: 'HOME_HOLD', expiresAt, bookingId },
        { bookingId },
        tx,
      );
      await tx.homeInvitation.create({
        data: {
          bookingId,
          professionalId,
          round,
          reason: 'Invited by FastQue dispatch',
          expiresAt,
        },
      });
      if (b.status !== 'INVITED')
        await this.transition(
          tx,
          b,
          'INVITED',
          { party: 'ADMIN', userId },
          note,
          { dispatchDeadline: expiresAt },
        );
      await this.core.audit(tx, {
        actorUserId: userId,
        actorParty: 'ADMIN',
        action: 'DISPATCH_INVITE',
        entityType: 'BOOKING',
        entityId: bookingId,
        note,
        metadata: { professionalId },
      });
    }, TX);
    const pro = await this.prisma.homeProfessional.findUniqueOrThrow({
      where: { id: professionalId },
    });
    await this.core.notify(
      pro.userId,
      'home.professional.update',
      `${bookingId}:admin-invite:${professionalId}:${Date.now()}`,
      'New home booking request',
      'FastQue dispatch has a home booking for you. You may accept or decline.',
      '/home-pro?tab=requests',
    );
    this.signal();
    return { ok: true };
  }

  // ---------- Cancel / reschedule / replacement ----------

  async cancel(code: string, viewer: HomeViewer, reason: string) {
    const a = await this.access(code, viewer);
    const to: HomeBookingStatus =
      a.party === 'CUSTOMER'
        ? 'CANCELLED_BY_CUSTOMER'
        : a.party === 'PROFESSIONAL'
          ? 'CANCELLED_BY_PROFESSIONAL'
          : a.party === 'ADMIN'
            ? 'CANCELLED_BY_PLATFORM'
            : 'CANCELLED_BY_SALON';
    const before = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBooking(tx, a.id);
      const party =
        a.party === 'PROVIDER' && b.provider.kind === 'INDEPENDENT_PROFESSIONAL'
          ? 'PROFESSIONAL'
          : a.party;
      const target =
        party === 'PROFESSIONAL' ? 'CANCELLED_BY_PROFESSIONAL' : to;
      await this.transition(
        tx,
        b,
        target,
        { party, userId: viewer.userId },
        reason,
        { cancelledAt: new Date(), cancelReason: reason },
      );
      await this.release(tx, b.id, target);
      if (a.party === 'ADMIN')
        await this.core.audit(tx, {
          actorUserId: viewer.userId,
          actorParty: 'ADMIN',
          action: 'CANCEL',
          entityType: 'BOOKING',
          entityId: b.id,
          note: reason,
        });
      return b;
    }, TX);
    if (a.party !== 'CUSTOMER')
      await this.notifyCustomer(
        before,
        'cancelled',
        'Home booking cancelled',
        'Your booking was cancelled by the provider. You owe nothing for it.',
      );
    if (a.party !== 'PROFESSIONAL')
      await this.notifyProfessional(
        before.id,
        'cancelled',
        'Booking cancelled',
        `${before.code} was cancelled.`,
      );
    if (a.party !== 'PROVIDER')
      await this.core.notify(
        before.provider.salon?.ownerUserId,
        'home.provider.update',
        `${before.id}:cancelled`,
        'Home booking cancelled',
        `${before.code} was cancelled.`,
        `/dashboard/salons/${before.provider.salonId}/home-services?tab=cancellations`,
      );
    return this.view(code, viewer);
  }

  async reschedule(
    code: string,
    viewer: HomeViewer,
    startAt: Date,
    reason?: string,
  ) {
    const a = await this.require(code, viewer, [
      'CUSTOMER',
      'PROVIDER',
      'PROFESSIONAL',
    ]);
    const settings = await this.core.settings();
    if (startAt < addMin(new Date(), settings.minScheduledLeadMinutes))
      throw homeInvalid(
        `Choose a time at least ${settings.minScheduledLeadMinutes} minutes from now.`,
      );
    if (startAt > addMin(new Date(), settings.maxDaysAhead * 1440))
      throw homeInvalid('That date is too far ahead.');
    const again = await this.prisma.$transaction(async (tx) => {
      const b = await this.lockBooking(tx, a.id);
      const minutes = this.needFromBooking(b).serviceMinutes;
      if (HOME_SEARCHING.includes(b.status) || b.status === 'NO_PROFESSIONAL') {
        if (a.party !== 'CUSTOMER') throw homeForbidden();
        await this.release(tx, b.id, 'RESCHEDULED');
        await tx.homeInvitation.deleteMany({ where: { bookingId: b.id } });
        await tx.homeBooking.update({
          where: { id: b.id },
          data: {
            mode: 'SCHEDULED',
            serviceStart: startAt,
            serviceEnd: addMin(startAt, minutes),
            etaFrom: addMin(startAt, -5),
            etaTo: addMin(startAt, 15),
            status: 'REQUESTED',
          },
        });
        await this.core.event(tx, b.id, {
          kind: 'RESCHEDULED',
          from: b.status,
          to: 'REQUESTED',
          party: 'CUSTOMER',
          actorUserId: viewer.userId,
          note: reason,
          metadata: { startAt: startAt.toISOString() },
        });
        return true;
      }
      if (b.status === 'RESCHEDULE_REQUESTED')
        throw homeState('A reschedule is already waiting for an answer.');
      const party: HomeParty =
        a.party === 'PROFESSIONAL' ? 'PROVIDER' : a.party;
      await this.transition(
        tx,
        b,
        'RESCHEDULE_REQUESTED',
        { party, userId: viewer.userId },
        reason,
        { rescheduleTo: startAt },
      );
      return false;
    }, TX);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
    });
    if (again) await this.dispatch(a.id);
    else if (a.party === 'CUSTOMER')
      await this.notifyProfessional(
        a.id,
        `resched:${startAt.getTime()}`,
        'Customer asked to reschedule',
        'Please accept or decline the new time.',
      );
    else
      await this.notifyCustomer(
        b,
        `resched:${startAt.getTime()}`,
        'New time proposed',
        'Your provider proposed another time. Please accept or decline it.',
      );
    this.signal();
    return this.view(code, viewer);
  }

  async answerReschedule(code: string, viewer: HomeViewer, acceptIt: boolean) {
    const a = await this.require(code, viewer, [
      'CUSTOMER',
      'PROVIDER',
      'PROFESSIONAL',
    ]);
    try {
      await this.prisma.$transaction(async (tx) => {
        const peek = await tx.homeBooking.findUniqueOrThrow({
          where: { id: a.id },
          include: bookingInclude,
        });
        const asg = this.activeAssignment(peek);
        if (asg) await this.availability.lock(tx, asg.professionalId);
        const b = await this.lockBooking(tx, a.id);
        if (b.status !== 'RESCHEDULE_REQUESTED' || !b.rescheduleTo)
          throw homeState('There is no reschedule waiting.');
        const asked = await tx.homeBookingEvent.findFirst({
          where: { bookingId: b.id, toStatus: 'RESCHEDULE_REQUESTED' },
          orderBy: { createdAt: 'desc' },
        });
        const byCustomer = asked?.actorParty === 'CUSTOMER';
        if (byCustomer === (a.party === 'CUSTOMER'))
          throw homeState('The other side must answer this request.');
        const party: HomeParty =
          a.party === 'PROFESSIONAL' ? 'PROFESSIONAL' : a.party;
        if (!acceptIt) {
          await this.transition(
            tx,
            b,
            'CONFIRMED',
            { party, userId: viewer.userId },
            'New time declined; the original time stands.',
            { rescheduleTo: null },
          );
          return;
        }
        const need = this.needFromBooking(b);
        const pro = this.activeAssignment(b);
        if (!pro) throw homeState('No professional is assigned.');
        const ev = await this.availability.evaluateLocked(
          tx,
          pro.professionalId,
          need,
          b.rescheduleTo,
          { bookingId: b.id },
        );
        if (!ev.ok)
          throw homeUnavailable(REASON_TEXT[ev.reason!], { reason: ev.reason });
        await tx.professionalCommitment.updateMany({
          where: { bookingId: b.id, kind: 'HOME_BOOKING', releasedAt: null },
          data: {
            startAt: ev.blockStart,
            endAt: ev.blockEnd,
            serviceStart: b.rescheduleTo,
            serviceEnd: addMin(b.rescheduleTo, need.serviceMinutes),
          },
        });
        await this.transition(
          tx,
          b,
          'CONFIRMED',
          { party, userId: viewer.userId },
          'New time accepted',
          {
            mode: 'SCHEDULED',
            serviceStart: b.rescheduleTo,
            serviceEnd: addMin(b.rescheduleTo, need.serviceMinutes),
            etaFrom: addMin(b.rescheduleTo, -5),
            etaTo: addMin(b.rescheduleTo, 15),
            rescheduleTo: null,
          },
        );
      }, TX);
    } catch (err) {
      if (isOverlapViolation(err)) throw homeUnavailable();
      throw err;
    }
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
    });
    await this.notifyCustomer(
      b,
      `resched-ans:${b.updatedAt.getTime()}`,
      acceptIt ? 'Booking rescheduled' : 'Original time kept',
      acceptIt
        ? 'The new time is confirmed.'
        : 'The new time was declined; your original booking stands.',
    );
    await this.notifyProfessional(
      b.id,
      `resched-ans:${b.updatedAt.getTime()}`,
      acceptIt ? 'Booking rescheduled' : 'Original time kept',
      b.code,
    );
    return this.view(code, viewer);
  }

  /** The assigned person cannot come. Their time is freed; nobody else is sent without the customer's approval. */
  async requestReplacement(
    code: string,
    viewer: HomeViewer,
    reason: string,
    proposedId?: string,
  ) {
    const a = await this.require(code, viewer, [
      'PROFESSIONAL',
      'PROVIDER',
      'ADMIN',
    ]);
    const b = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockBooking(tx, a.id);
      if (proposedId) {
        const pro = await tx.homeProfessional.findUnique({
          where: { id: proposedId },
        });
        if (
          !pro ||
          (a.party !== 'ADMIN' && pro.providerId !== locked.providerId)
        )
          throw homeInvalid('Choose a professional from the same provider.');
      }
      if (locked.status === 'REPLACEMENT_REQUESTED')
        await tx.homeBooking.update({
          where: { id: locked.id },
          data: { replacementProposedId: proposedId ?? null },
        });
      else {
        await this.transition(
          tx,
          locked,
          'REPLACEMENT_REQUESTED',
          { party: a.party, userId: viewer.userId },
          reason,
          { replacementProposedId: proposedId ?? null },
        );
        await this.release(tx, locked.id, 'REPLACEMENT');
      }
      if (a.party === 'ADMIN')
        await this.core.audit(tx, {
          actorUserId: viewer.userId,
          actorParty: 'ADMIN',
          action: 'REPLACEMENT_PROPOSED',
          entityType: 'BOOKING',
          entityId: locked.id,
          note: reason,
          metadata: { proposedId: proposedId ?? null },
        });
      return locked;
    }, TX);
    await this.notifyCustomer(
      b,
      `replacement:${proposedId ?? 'none'}`,
      'Your professional cannot come',
      'Please approve a replacement, choose another time, or cancel free of charge.',
    );
    await this.core.notify(
      b.provider.salon?.ownerUserId,
      'home.provider.update',
      `${b.id}:replacement`,
      'Replacement needed',
      `${b.code} needs another professional.`,
      `/dashboard/salons/${b.provider.salonId}/home-services?tab=incoming`,
    );
    return this.view(code, viewer);
  }

  async answerReplacement(
    code: string,
    viewer: HomeViewer,
    choice: 'APPROVE' | 'ANY',
  ) {
    const a = await this.require(code, viewer, ['CUSTOMER']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
      include: bookingInclude,
    });
    if (b.status !== 'REPLACEMENT_REQUESTED')
      throw homeState('No replacement is waiting for your approval.');
    if (choice === 'APPROVE') {
      if (!b.replacementProposedId)
        throw homeState('No replacement has been proposed yet.');
      const pro = await this.prisma.homeProfessional.findUniqueOrThrow({
        where: { id: b.replacementProposedId },
        include: { provider: true },
      });
      if (
        pro.provider.kind === 'SALON_MANAGED' &&
        pro.providerId === b.providerId
      ) {
        await this.confirmWith(
          b.id,
          pro.id,
          { party: 'PROVIDER', userId: b.provider.salon?.ownerUserId ?? null },
          async (tx) => {
            await this.core.event(tx, b.id, {
              kind: 'REPLACEMENT_APPROVED',
              party: 'CUSTOMER',
              actorUserId: viewer.userId,
              metadata: { professionalId: pro.id },
            });
          },
        );
        return this.view(code, viewer);
      }
      await this.prisma.homeBooking.update({
        where: { id: b.id },
        data: {
          preferredProfessionalId: pro.id,
          preference: 'SPECIFIC_PROFESSIONAL',
          allowAlternatives: false,
        },
      });
    } else {
      await this.prisma.homeBooking.update({
        where: { id: b.id },
        data: {
          preferredProfessionalId: null,
          preference: 'FASTEST',
          allowAlternatives: true,
        },
      });
    }
    await this.core.event(this.prisma, b.id, {
      kind: 'REPLACEMENT_APPROVED',
      party: 'CUSTOMER',
      actorUserId: viewer.userId,
      note: choice,
    });
    await this.inviteNext(b.id);
    return this.view(code, viewer);
  }

  // ---------- Views ----------

  async view(code: string, viewer: HomeViewer) {
    const a = await this.access(code, viewer);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
      include: bookingInclude,
    });
    const events = await this.prisma.homeBookingEvent.findMany({
      where: { bookingId: b.id },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return this.dto(b, a.party, events);
  }

  dto(
    b: FullBooking,
    party: HomeParty,
    events: {
      kind: string;
      fromStatus: string | null;
      toStatus: string | null;
      actorParty: string;
      note: string | null;
      createdAt: Date;
    }[] = [],
  ) {
    const asg =
      this.activeAssignment(b) ??
      b.assignments.find((x) => x.status === 'COMPLETED') ??
      null;
    const active = HOME_ASSIGNED_ACTIVE.includes(b.status);
    const served = HOME_SERVED.includes(b.status);
    const unverifiedGuest = !b.customerId && !b.guestPhoneVerifiedAt;
    const seeFullAddress =
      party === 'CUSTOMER'
        ? !unverifiedGuest || b.status === 'DRAFT'
        : party === 'ADMIN' ||
          ((party === 'PROFESSIONAL' || party === 'PROVIDER') &&
            active &&
            !!asg);
    const ad = b.address;
    const showPro =
      asg && (active || served) && !(party === 'CUSTOMER' && unverifiedGuest);
    const paid = b.payments
      .filter((p) => !p.voidedAt)
      .reduce((s, p) => s + p.amountPaise, 0);
    const snapshot = b.termsSnapshot as Record<string, unknown>;
    return {
      code: b.code,
      viewer: party,
      status: b.status,
      paymentStatus: b.paymentStatus,
      complaintStatus: b.complaintStatus,
      refundStatus: b.refundStatus,
      mode: b.mode,
      preference: b.preference,
      allowAlternatives: b.allowAlternatives,
      groupKey: b.groupKey,
      createdAt: b.createdAt.toISOString(),
      serviceStart: b.serviceStart.toISOString(),
      serviceEnd: b.serviceEnd.toISOString(),
      rescheduleTo: b.rescheduleTo?.toISOString() ?? null,
      eta:
        b.etaFrom && b.etaTo
          ? {
              from: b.etaFrom.toISOString(),
              to: b.etaTo.toISOString(),
              confidence: b.etaConfidence,
              approximate: !String(
                (b.etaBasis as { source?: string } | null)?.source ?? '',
              ).startsWith('ROAD'),
              updatedAt: b.updatedAt.toISOString(),
            }
          : null,
      delayMinutes: b.delayMinutes,
      provider: {
        id: b.providerId,
        kind: b.provider.kind,
        name: b.provider.displayName,
        salonName: b.provider.salon?.name ?? null,
        label: homeProviderLabel(b.provider.kind, b.provider.salon?.name),
        salonPhone:
          party === 'CUSTOMER' &&
          active &&
          b.provider.salon?.showPhoneToCustomers
            ? b.provider.salon.phone
            : null,
      },
      professional: showPro
        ? {
            id: asg.professionalId,
            name: asg.professional.displayName,
            photoUrl: asg.professional.photoUrl,
            badges: verifiedBadges(asg.professional.verifications),
            phone:
              party === 'CUSTOMER' && active
                ? asg.professional.user.phone
                : null,
          }
        : null,
      address: {
        locality: ad.locality,
        city: ad.city,
        postalCode: ad.postalCode,
        full: seeFullAddress
          ? {
              house: ad.house,
              building: ad.building,
              street: ad.street,
              landmark: ad.landmark,
              state: ad.state,
              accessNotes: ad.accessNotes,
              lat: ad.lat,
              lng: ad.lng,
              contactName: ad.contactName,
              contactPhone: ad.contactPhone,
            }
          : null,
      },
      customer:
        party === 'CUSTOMER' || !seeFullAddress
          ? null
          : {
              name: b.guestName ?? ad.contactName,
              phone:
                ad.contactPhone ?? b.guestPhone ?? b.customer?.phone ?? null,
            },
      guestVerificationNeeded: b.status === 'DRAFT' && unverifiedGuest,
      notes:
        party === 'PROVIDER' ||
        active ||
        party === 'CUSTOMER' ||
        party === 'ADMIN'
          ? b.notes
          : null,
      forChild: b.forChild,
      productPreference: b.productPreference,
      items: b.items.map((i) => ({
        id: i.id,
        name: i.serviceName,
        quantity: i.quantity,
        personName: i.personName,
        lineTotalPaise: i.lineTotalPaise,
        durationMinutes: i.durationMinutes,
        addedLater: i.addedLater,
        safety: i.offering?.serviceDef.safetyInstructions ?? null,
      })),
      price: b.priceSnapshot,
      totalPaise: b.totalPaise,
      paidPaise: paid,
      duePaise: Math.max(0, b.totalPaise - paid),
      paymentMethod: b.paymentMethod,
      collectedBy: snapshot.collectedBy ?? b.provider.displayName,
      invoiceIssuedBy: snapshot.invoiceIssuedBy ?? b.provider.displayName,
      upiVpa:
        party === 'CUSTOMER' &&
        (active || served) &&
        b.paymentMethod === 'DIRECT_UPI'
          ? b.provider.upiVpa
          : null,
      payments: b.payments.map((p) => ({
        id: p.id,
        method: p.method,
        amountPaise: p.amountPaise,
        tipPaise: p.tipPaise,
        collectedBy: p.collectedBy,
        reference: p.reference,
        createdAt: p.createdAt.toISOString(),
        customerConfirmedAt: p.customerConfirmedAt?.toISOString() ?? null,
        disputedAt: p.disputedAt?.toISOString() ?? null,
        voided: !!p.voidedAt,
      })),
      refunds: b.refunds.map((r) => ({
        kind: r.kind,
        amountPaise: r.amountPaise,
        settled: !!r.settledAt,
      })),
      adjustments: b.adjustments.map((x) => ({
        id: x.id,
        description: x.description,
        amountPaise: x.amountPaise,
        minutes: x.minutes,
        status: x.status,
      })),
      replacementProposedId: b.replacementProposedId,
      invitations:
        party === 'PROVIDER' || party === 'ADMIN'
          ? b.invitations.map((i) => ({
              name: i.professional.displayName,
              status: i.status,
              expiresAt: i.expiresAt.toISOString(),
              reason: i.reason,
            }))
          : undefined,
      policies: {
        cancellation: snapshot.cancellation,
        reService: snapshot.reService,
      },
      timestamps: {
        travelStartedAt: b.travelStartedAt?.toISOString() ?? null,
        arrivedAt: b.arrivedAt?.toISOString() ?? null,
        startedAt: b.startedAt?.toISOString() ?? null,
        completedAt: b.completedAt?.toISOString() ?? null,
      },
      review: b.review
        ? {
            overall: b.review.overall,
            comment: b.review.comment,
            response: b.review.response,
          }
        : null,
      tickets: party === 'CUSTOMER' || party === 'ADMIN' ? b.tickets : [],
      hygiene: b.hygiene.map((h) => ({
        stage: h.stage,
        complete: h.complete,
        answers: h.answers,
      })),
      can: {
        cancel:
          homeTransitionAllowed(b.status, 'CANCELLED_BY_CUSTOMER', party) ||
          homeTransitionAllowed(b.status, 'CANCELLED_BY_PROFESSIONAL', party) ||
          homeTransitionAllowed(b.status, 'CANCELLED_BY_SALON', party) ||
          homeTransitionAllowed(b.status, 'CANCELLED_BY_PLATFORM', party),
        reschedule:
          homeTransitionAllowed(
            b.status,
            'RESCHEDULE_REQUESTED',
            party === 'PROFESSIONAL' ? 'PROVIDER' : party,
          ) ||
          (party === 'CUSTOMER' &&
            (HOME_SEARCHING.includes(b.status) ||
              b.status === 'NO_PROFESSIONAL')),
        track: HOME_TRACKABLE.includes(b.status),
        review: party === 'CUSTOMER' && served && !b.review,
        rebook:
          party === 'CUSTOMER' && (served || HOME_TERMINAL.includes(b.status)),
      },
      history: events.map((e) => ({
        kind: e.kind,
        from: e.fromStatus,
        to: e.toStatus,
        by: e.actorParty,
        note: party === 'CUSTOMER' && e.actorParty === 'ADMIN' ? null : e.note,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  async listForCustomer(
    userId: string,
    scope: 'active' | 'history',
    page: number,
  ) {
    const closed: HomeBookingStatus[] = [
      ...HOME_TERMINAL,
      'PAYMENT_CONFIRMED',
      'NO_PROFESSIONAL',
    ];
    const where: Prisma.HomeBookingWhereInput = {
      customerId: userId,
      status: scope === 'active' ? { notIn: closed } : { in: closed },
    };
    const [total, rows] = await Promise.all([
      this.prisma.homeBooking.count({ where }),
      this.prisma.homeBooking.findMany({
        where,
        include: bookingInclude,
        orderBy: { serviceStart: scope === 'active' ? 'asc' : 'desc' },
        skip: (page - 1) * 20,
        take: 20,
      }),
    ]);
    return { total, page, items: rows.map((b) => this.dto(b, 'CUSTOMER')) };
  }

  async list(
    where: Prisma.HomeBookingWhereInput,
    party: HomeParty,
    page: number,
    size = 25,
    order: 'asc' | 'desc' = 'desc',
  ) {
    const [total, rows] = await Promise.all([
      this.prisma.homeBooking.count({ where }),
      this.prisma.homeBooking.findMany({
        where,
        include: bookingInclude,
        orderBy: { serviceStart: order },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);
    return {
      total,
      page,
      pageSize: size,
      items: rows.map((b) => ({ id: b.id, ...this.dto(b, party) })),
    };
  }

  /** What a professional may see BEFORE accepting: the area, never the house. */
  async requestsFor(userId: string) {
    const rows = await this.prisma.homeInvitation.findMany({
      where: {
        professional: { userId },
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        booking: {
          include: {
            items: true,
            address: {
              select: { locality: true, city: true, postalCode: true },
            },
            provider: { select: { displayName: true, kind: true } },
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
    });
    const holds = await this.prisma.professionalCommitment.findMany({
      where: {
        userId,
        kind: 'HOME_HOLD',
        releasedAt: null,
        bookingId: { in: rows.map((r) => r.bookingId) },
      },
    });
    return rows.map((r) => {
      const h = holds.find((x) => x.bookingId === r.bookingId);
      return {
        id: r.id,
        code: r.booking.code,
        mode: r.booking.mode,
        provider: r.booking.provider,
        services: r.booking.items.map((i) => ({
          name: i.serviceName,
          quantity: i.quantity,
          minutes: i.durationMinutes,
        })),
        locality: r.booking.address.locality,
        city: r.booking.address.city,
        postalCode: r.booking.address.postalCode,
        serviceStart: (h?.serviceStart ?? r.booking.serviceStart).toISOString(),
        serviceEnd: (h?.serviceEnd ?? r.booking.serviceEnd).toISOString(),
        leaveBy: h?.startAt.toISOString() ?? null,
        totalPaise: r.booking.totalPaise,
        forChild: r.booking.forChild,
        reason: r.reason,
        expiresAt: r.expiresAt.toISOString(),
      };
    });
  }

  // ---------- Sweep ----------

  async nextDueAt(): Promise<Date | null> {
    const [inv, hold, draft, closing] = await Promise.all([
      this.prisma.homeInvitation.findFirst({
        where: { status: 'PENDING' },
        orderBy: { expiresAt: 'asc' },
        select: { expiresAt: true },
      }),
      this.prisma.professionalCommitment.findFirst({
        where: { kind: 'HOME_HOLD', releasedAt: null },
        orderBy: { expiresAt: 'asc' },
        select: { expiresAt: true },
      }),
      this.prisma.homeBooking.findFirst({
        where: {
          dispatchDeadline: { not: null },
          status: {
            in: ['DRAFT', 'REQUESTED', 'AWAITING_ASSIGNMENT', 'INVITED'],
          },
        },
        orderBy: { dispatchDeadline: 'asc' },
        select: { dispatchDeadline: true },
      }),
      this.prisma.homeBooking.findFirst({
        where: { status: 'PAYMENT_CONFIRMED' },
        orderBy: { updatedAt: 'asc' },
        select: { updatedAt: true },
      }),
    ]);
    const settings = closing ? await this.core.settings() : null;
    const dates = [
      inv?.expiresAt,
      hold?.expiresAt,
      draft?.dispatchDeadline,
      closing && settings
        ? addMin(closing.updatedAt, settings.autoCloseHours * 60)
        : null,
    ].filter((d): d is Date => !!d);
    return dates.length
      ? new Date(Math.min(...dates.map((d) => d.getTime())))
      : null;
  }

  async sweep(now = new Date()) {
    await this.prisma.professionalCommitment.updateMany({
      where: { kind: 'HOME_HOLD', releasedAt: null, expiresAt: { lte: now } },
      data: { releasedAt: now },
    });
    const expired = await this.prisma.homeInvitation.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      select: { id: true, bookingId: true },
      take: 200,
    });
    for (const i of expired)
      await this.prisma.homeInvitation.updateMany({
        where: { id: i.id, status: 'PENDING' },
        data: { status: 'EXPIRED', respondedAt: now },
      });
    for (const bookingId of new Set(expired.map((e) => e.bookingId)))
      await this.inviteNext(bookingId);
    const stale = await this.prisma.homeBooking.findMany({
      where: {
        OR: [
          {
            status: { in: ['DRAFT', 'AWAITING_ASSIGNMENT'] },
            dispatchDeadline: { lte: now },
          },
          {
            status: {
              in: [
                'REQUESTED',
                'AWAITING_ASSIGNMENT',
                'INVITED',
                'NO_PROFESSIONAL',
              ],
            },
            mode: 'SCHEDULED',
            serviceStart: { lte: now },
          },
        ],
      },
      take: 200,
      include: bookingInclude,
    });
    for (const b of stale) {
      if (
        b.status === 'AWAITING_ASSIGNMENT' &&
        b.serviceStart > now &&
        b.allowAlternatives
      ) {
        await this.inviteNext(b.id);
        continue;
      }
      const to: HomeBookingStatus =
        b.status === 'AWAITING_ASSIGNMENT' && b.serviceStart > now
          ? 'NO_PROFESSIONAL'
          : 'EXPIRED';
      const done = await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockBooking(tx, b.id);
        if (!homeTransitionAllowed(locked.status, to, 'SYSTEM')) return false;
        await this.transition(tx, locked, to, { party: 'SYSTEM' }, null, {
          dispatchDeadline: null,
        });
        await this.release(tx, b.id, to);
        return true;
      }, TX);
      if (done && b.status !== 'DRAFT')
        await this.notifyCustomer(
          b,
          to,
          to === 'EXPIRED'
            ? 'Booking request expired'
            : 'No professional available',
          'You can choose another time or professional. Nothing is owed.',
        );
    }
    const settings = await this.core.settings();
    const closing = await this.prisma.homeBooking.findMany({
      where: {
        status: 'PAYMENT_CONFIRMED',
        complaintStatus: { in: ['NONE', 'RESOLVED'] },
        paymentStatus: 'CONFIRMED',
        updatedAt: { lte: addMin(now, -settings.autoCloseHours * 60) },
      },
      take: 200,
      select: { id: true },
    });
    for (const c of closing)
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockBooking(tx, c.id);
        if (locked.status === 'PAYMENT_CONFIRMED')
          await this.transition(tx, locked, 'CLOSED', { party: 'SYSTEM' });
      }, TX);
    return {
      expired: expired.length,
      stale: stale.length,
      closed: closing.length,
    };
  }
}
