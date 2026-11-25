import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HOME_SERVED,
  type HomeAddressInput,
  type HomeBookingInput,
  type HomeQuoteInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageMimeType } from '../storage/image-signature';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service';
import { HomeBookingService, type HomeViewer } from './home-booking.service';
import {
  HomeCoreService,
  TX,
  addMin,
  newToken,
  sha256,
} from './home-core.service';
import {
  homeForbidden,
  homeInvalid,
  homeNotFound,
  homeState,
} from './home-errors';
import { HomeQuoteService } from './home-quote.service';

/** Addresses, favourites, reviews, complaints, incidents, recurring plans and society campaigns. */
@Injectable()
export class HomeCustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: HomeCoreService,
    private readonly bookings: HomeBookingService,
    private readonly quotes: HomeQuoteService,
    private readonly files: PrivateObjectStorageService,
  ) {}

  // ---------- Addresses (a saved address is never edited in place, so old bookings keep theirs) ----------

  addresses(userId: string) {
    return this.prisma.homeAddress.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async saveAddress(
    userId: string,
    input: HomeAddressInput,
    replaceId?: string,
  ) {
    const count = await this.prisma.homeAddress.count({
      where: { userId, archivedAt: null },
    });
    if (count >= 20 && !replaceId)
      throw homeInvalid('You can keep up to 20 addresses.');
    return this.prisma.$transaction(async (tx) => {
      if (replaceId) {
        const old = await tx.homeAddress.updateMany({
          where: { id: replaceId, userId, archivedAt: null },
          data: { archivedAt: new Date() },
        });
        if (old.count === 0) throw homeNotFound('Address not found.');
      }
      return tx.homeAddress.create({
        data: {
          ...input,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          userId,
        },
      });
    });
  }

  async removeAddress(userId: string, id: string) {
    const r = await this.prisma.homeAddress.updateMany({
      where: { id, userId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (r.count === 0) throw homeNotFound('Address not found.');
    return { ok: true };
  }

  // ---------- Favourites / blocks ----------

  async favorite(userId: string, professionalId: string, on: boolean) {
    const pro = await this.prisma.homeProfessional.findFirst({
      where: { id: professionalId, consentAt: { not: null } },
      select: { id: true },
    });
    if (!pro) throw homeNotFound('Professional not found.');
    if (on)
      await this.prisma.homeFavorite.upsert({
        where: { userId_professionalId: { userId, professionalId } },
        create: { userId, professionalId },
        update: {},
      });
    else
      await this.prisma.homeFavorite.deleteMany({
        where: { userId, professionalId },
      });
    return { favorite: on };
  }

  favorites(userId: string) {
    return this.prisma.homeFavorite.findMany({
      where: { userId },
      include: {
        professional: {
          select: {
            id: true,
            displayName: true,
            photoUrl: true,
            active: true,
            provider: { select: { displayName: true, kind: true } },
          },
        },
      },
      take: 50,
    });
  }

  /** Both sides may block the other from one shared booking. */
  async block(code: string, viewer: HomeViewer) {
    const a = await this.bookings.require(code, viewer, [
      'CUSTOMER',
      'PROFESSIONAL',
    ]);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
      select: {
        customerId: true,
        assignments: {
          orderBy: { assignedAt: 'desc' },
          take: 1,
          select: { professional: { select: { userId: true } } },
        },
      },
    });
    const pro = b.assignments[0]?.professional.userId;
    if (!b.customerId || !pro || !viewer.userId)
      throw homeState('There is nobody to block on this booking.');
    const blockedUserId = a.party === 'CUSTOMER' ? pro : b.customerId;
    await this.prisma.homeBlock.upsert({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: viewer.userId,
          blockedUserId,
        },
      },
      create: { blockerUserId: viewer.userId, blockedUserId },
      update: {},
    });
    return { blocked: true };
  }

  // ---------- Reviews ----------

  async review(
    code: string,
    viewer: HomeViewer,
    input: {
      overall: number;
      quality: number;
      behaviour: number;
      punctuality: number;
      hygiene: number;
      transparency: number;
      comment?: string;
    },
  ) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
      include: {
        assignments: {
          where: { status: 'COMPLETED' },
          take: 1,
          include: { professional: { select: { userId: true } } },
        },
      },
    });
    const asg = b.assignments[0];
    if (!HOME_SERVED.includes(b.status) || !asg)
      throw homeState('You can review a service after it is completed.');
    if (viewer.userId && asg.professional.userId === viewer.userId)
      throw homeForbidden('You cannot review yourself.');
    if (!b.customerId && !b.guestPhoneVerifiedAt)
      throw homeForbidden('Verify your phone number first.');
    try {
      const r = await this.prisma.homeReview.create({
        data: {
          ...input,
          comment: input.comment || null,
          bookingId: b.id,
          professionalId: asg.professionalId,
          providerId: b.providerId,
          customerId: b.customerId,
        },
      });
      await this.bookings.notifyProfessional(
        b.id,
        'review',
        'New review',
        'A customer reviewed your service.',
      );
      return { id: r.id, status: r.status };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw homeState('You have already reviewed this booking.');
      throw err;
    }
  }

  async respondReview(reviewId: string, userId: string, response: string) {
    const r = await this.ownedReview(reviewId, userId);
    if (r.response) throw homeState('You have already responded.');
    await this.prisma.homeReview.update({
      where: { id: r.id },
      data: { response },
    });
    return { ok: true };
  }

  /** Dispute/report: goes to human moderation; it stays visible until a person decides. */
  async reportReview(reviewId: string, userId: string, reason: string) {
    const r = await this.ownedReview(reviewId, userId);
    if (r.status !== 'PUBLISHED' && r.status !== 'HIDDEN')
      throw homeState('This review is already being checked.');
    await this.prisma.homeReview.update({
      where: { id: r.id },
      data: {
        status: r.status === 'HIDDEN' ? 'APPEALED' : 'REPORTED',
        reportReason: reason.slice(0, 300),
      },
    });
    return { ok: true };
  }

  private async ownedReview(id: string, userId: string) {
    const r = await this.prisma.homeReview.findUnique({
      where: { id },
      include: {
        professional: {
          select: {
            userId: true,
            provider: { select: { userId: true, salonId: true } },
          },
        },
      },
    });
    if (!r) throw homeNotFound();
    const p = r.professional;
    const mine =
      p.userId === userId ||
      p.provider.userId === userId ||
      r.customerId === userId ||
      (p.provider.salonId &&
        (await this.bookings.ownsSalon(userId, p.provider.salonId)));
    if (!mine) throw homeNotFound();
    return r;
  }

  async feedback(
    code: string,
    viewer: HomeViewer,
    input: {
      communication: number;
      addressAccuracy: number;
      conditions: number;
      payment: number;
      safetyConcern: boolean;
      note?: string;
    },
  ) {
    const a = await this.bookings.require(code, viewer, ['PROFESSIONAL']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
    });
    if (
      !HOME_SERVED.includes(b.status) &&
      !['CUSTOMER_NO_SHOW', 'INTERRUPTED'].includes(b.status)
    )
      throw homeState('You can give feedback after the visit.');
    await this.prisma.homeProfessionalFeedback.upsert({
      where: { bookingId: a.id },
      create: {
        ...input,
        note: input.note ?? null,
        bookingId: a.id,
        byUserId: viewer.userId!,
      },
      update: { ...input, note: input.note ?? null },
    });
    if (input.safetyConcern)
      await this.incident(
        viewer,
        'OTHER',
        input.note || 'Safety concern reported in visit feedback',
        code,
      );
    return {
      ok: true,
      visibility: 'Private: only FastQue safety staff can read this.',
    };
  }

  // ---------- Support ----------

  async openTicket(
    code: string,
    viewer: HomeViewer,
    input: { category: string; message: string },
    file?: { buffer: Buffer },
  ) {
    const a = await this.bookings.require(code, viewer, [
      'CUSTOMER',
      'PROFESSIONAL',
      'PROVIDER',
    ]);
    const attach = await this.attachment(file);
    const t = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.homeTicket.create({
        data: {
          bookingId: a.id,
          category: input.category,
          priority: [
            'SAFETY',
            'PROFESSIONAL_DID_NOT_ARRIVE',
            'INCORRECT_PROFESSIONAL',
          ].includes(input.category)
            ? 'URGENT'
            : 'NORMAL',
          openedByUserId: viewer.userId,
          openedByParty: a.party,
          messages: {
            create: {
              authorUserId: viewer.userId,
              authorParty: a.party,
              body: input.message,
              ...attach,
            },
          },
        },
      });
      if (a.party === 'CUSTOMER')
        await tx.homeBooking.update({
          where: { id: a.id },
          data: { complaintStatus: 'RAISED' },
        });
      await this.core.event(tx, a.id, {
        kind: 'TICKET_OPENED',
        party: a.party,
        actorUserId: viewer.userId,
        note: input.category,
      });
      return ticket;
    });
    if (input.category === 'SAFETY')
      await this.incident(viewer, 'OTHER', input.message, code);
    return { id: t.id, number: t.number, status: t.status };
  }

  private async attachment(file?: { buffer: Buffer }) {
    if (!file) return {};
    if (file.buffer.length > 5 * 1024 * 1024)
      throw homeInvalid('Photos must be smaller than 5 MB.');
    const type = detectImageMimeType(file.buffer);
    if (!type) throw homeInvalid('Attach a JPG, PNG or WebP photo.');
    const key = `home-tickets/${randomUUID()}`;
    await this.files.put(key, file.buffer, type);
    return { attachmentKey: key, attachmentType: type };
  }

  /** Public conversation for the people on the booking; internal notes are stripped. */
  async ticket(code: string, viewer: HomeViewer, ticketId: string) {
    const a = await this.bookings.access(code, viewer);
    const t = await this.prisma.homeTicket.findFirst({
      where: {
        id: ticketId,
        bookingId: a.id,
        ...(a.party === 'ADMIN' ? {} : { openedByParty: a.party }),
      },
      include: {
        messages: {
          where: a.party === 'ADMIN' ? {} : { internal: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!t) throw homeNotFound();
    return {
      id: t.id,
      number: t.number,
      category: t.category,
      status: t.status,
      priority: t.priority,
      resolution: t.resolution,
      messages: t.messages.map((m) => ({
        id: m.id,
        by: m.authorParty,
        body: m.body,
        internal: m.internal,
        attachment: !!m.attachmentKey,
        at: m.createdAt,
      })),
    };
  }

  async replyTicket(
    code: string,
    viewer: HomeViewer,
    ticketId: string,
    body: string,
  ) {
    const a = await this.bookings.require(code, viewer, [
      'CUSTOMER',
      'PROFESSIONAL',
      'PROVIDER',
    ]);
    const t = await this.prisma.homeTicket.findFirst({
      where: { id: ticketId, bookingId: a.id, openedByParty: a.party },
    });
    if (!t) throw homeNotFound();
    if (t.status === 'CLOSED') throw homeState('This ticket is closed.');
    await this.prisma.homeTicketMessage.create({
      data: {
        ticketId: t.id,
        authorUserId: viewer.userId,
        authorParty: a.party,
        body,
      },
    });
    return this.ticket(code, viewer, ticketId);
  }

  /** Always possible, at any status, with no code required. */
  async incident(
    viewer: HomeViewer,
    kind: string,
    description: string,
    code?: string,
  ) {
    const a = code ? await this.bookings.access(code, viewer) : null;
    const row = await this.prisma.homeIncident.create({
      data: {
        bookingId: a?.id ?? null,
        reporterUserId: viewer.userId,
        reporterParty: a?.party ?? 'PROFESSIONAL',
        kind,
        description,
        severity: [
          'HARASSMENT',
          'INJURY',
          'UNSAFE_LOCATION',
          'WRONG_PERSON_ARRIVED',
        ].includes(kind)
          ? 'CRITICAL'
          : 'HIGH',
      },
    });
    const admins = await this.prisma.userRole.findMany({
      where: { role: 'PLATFORM_ADMIN' },
      select: { userId: true },
      take: 20,
    });
    for (const x of admins)
      await this.core.notify(
        x.userId,
        'home.provider.update',
        `incident:${row.id}`,
        'Home safety report',
        'A safety report needs review.',
        '/dashboard/admin/home?tab=incidents',
      );
    const s = await this.core.settings();
    return {
      id: row.id,
      status: row.status,
      guidance:
        'This report goes to FastQue staff for review. It is not an emergency service and nobody is dispatched. In danger, call 112 (India emergency number) now.',
      supportPhone: s.supportPhone || null,
      supportEmail: s.supportEmail,
    };
  }

  // ---------- Sharing ----------

  /** Status-only link for a trusted contact: no address, no phone, no location. */
  async share(code: string, viewer: HomeViewer) {
    const a = await this.bookings.require(code, viewer, [
      'CUSTOMER',
      'PROFESSIONAL',
    ]);
    const token = newToken();
    await this.prisma.homeBooking.update({
      where: { id: a.id },
      data: { shareHash: sha256(token) },
    });
    return { token };
  }

  async shared(token: string) {
    const b = await this.prisma.homeBooking.findUnique({
      where: { shareHash: sha256(token) },
      include: {
        provider: { select: { displayName: true, kind: true } },
        address: { select: { locality: true, city: true } },
        assignments: {
          where: { status: { in: ['ACTIVE', 'COMPLETED'] } },
          take: 1,
          select: { professional: { select: { displayName: true } } },
        },
      },
    });
    if (!b || b.serviceEnd < addMin(new Date(), -24 * 60))
      throw homeNotFound('This link has expired.');
    return {
      status: b.status,
      provider: b.provider.displayName,
      kind: b.provider.kind,
      professional: b.assignments[0]?.professional.displayName ?? null,
      area: `${b.address.locality}, ${b.address.city}`,
      serviceStart: b.serviceStart,
      serviceEnd: b.serviceEnd,
      etaFrom: b.etaFrom,
      etaTo: b.etaTo,
    };
  }

  // ---------- Rebook ----------

  async rebook(code: string, viewer: HomeViewer) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
      include: {
        items: true,
        assignments: { orderBy: { assignedAt: 'desc' }, take: 1 },
      },
    });
    const items = b.items
      .filter((i) => i.offeringId && !i.addedLater)
      .map((i) => ({
        offeringId: i.offeringId!,
        variantCode: i.variantCode ?? undefined,
        quantity: i.quantity,
      }));
    // Prices are always today's: the caller quotes again before anything is booked.
    return {
      addressId: b.customerId ? b.addressId : null,
      professionalId: b.assignments[0]?.professionalId ?? null,
      providerId: b.providerId,
      items,
    };
  }

  // ---------- Recurring ----------

  recurring(userId: string) {
    return this.prisma.homeRecurringPlan.findMany({
      where: { customerId: userId },
      include: {
        professional: { select: { displayName: true } },
        bookings: {
          select: { code: true, status: true, serviceStart: true },
          orderBy: { serviceStart: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRecurring(
    userId: string,
    input: {
      professionalId: string;
      addressId: string;
      items: HomeQuoteInput['items'];
      intervalDays: number;
      firstStart: string;
      paymentMethod: 'CASH' | 'DIRECT_UPI' | 'OTHER_OFFLINE';
    },
  ) {
    await this.quotes.ownedAddress(input.addressId, userId);
    // The first date must be really available with this same person.
    const q = await this.quotes.quote(
      {
        addressId: input.addressId,
        items: input.items,
        mode: 'SCHEDULED',
        startAt: input.firstStart,
        preference: 'SPECIFIC_PROFESSIONAL',
        professionalId: input.professionalId,
      },
      userId,
    );
    if (!q.options[0])
      throw homeState('That professional is not available for the first date.');
    return this.prisma.homeRecurringPlan.create({
      data: {
        customerId: userId,
        professionalId: input.professionalId,
        addressId: input.addressId,
        items: input.items,
        intervalDays: input.intervalDays,
        nextStart: new Date(input.firstStart),
        paymentMethod: input.paymentMethod,
      },
    });
  }

  async updateRecurring(
    userId: string,
    id: string,
    input: {
      status?: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
      intervalDays?: number;
      nextStart?: string;
    },
  ) {
    const p = await this.prisma.homeRecurringPlan.findFirst({
      where: { id, customerId: userId },
    });
    if (!p) throw homeNotFound();
    if (p.status === 'CANCELLED') throw homeState('This plan was cancelled.');
    return this.prisma.homeRecurringPlan.update({
      where: { id },
      data: {
        status: input.status,
        intervalDays: input.intervalDays,
        nextStart: input.nextStart ? new Date(input.nextStart) : undefined,
      },
    });
  }

  /** Books the next visit a few days ahead, only with the same person and only if really available. */
  async runRecurring(now = new Date()) {
    const due = await this.prisma.homeRecurringPlan.findMany({
      where: { status: 'ACTIVE', nextStart: { lte: addMin(now, 7 * 1440) } },
      take: 100,
    });
    let booked = 0;
    for (const p of due) {
      const start = p.nextStart;
      let outcome: string;
      try {
        if (start < now) throw homeState('The date has passed.');
        const quote = {
          addressId: p.addressId,
          items: p.items as unknown as HomeQuoteInput['items'],
          mode: 'SCHEDULED' as const,
          startAt: start.toISOString(),
          preference: 'SPECIFIC_PROFESSIONAL' as const,
          professionalId: p.professionalId,
        };
        const q = await this.quotes.quote(quote, p.customerId);
        const o = q.options[0];
        if (!o)
          throw homeState(
            'Your professional is not available on that date, so nothing was booked.',
          );
        const input: HomeBookingInput = {
          quote,
          expectedTotalPaise: o.price.totalPaise,
          paymentMethod: p.paymentMethod,
          allowAlternatives: false,
          productPreference: 'PROFESSIONAL',
          forChild: false,
          guardianConfirmed: false,
          acceptPolicies: true,
        };
        const b = await this.bookings.create(
          input,
          p.customerId,
          `recurring:${p.id}:${start.toISOString()}`,
          { recurringPlanId: p.id },
        );
        outcome = `Requested ${b.code}`;
        booked += 1;
      } catch (err) {
        outcome = err instanceof Error ? err.message : 'Could not book';
        await this.core.notify(
          p.customerId,
          'home.booking.update',
          `recurring:${p.id}:${start.toISOString()}`,
          'Repeat booking not made',
          outcome,
          '/account/home-services?tab=recurring',
        );
      }
      await this.prisma.homeRecurringPlan.update({
        where: { id: p.id },
        data: {
          nextStart: addMin(start, p.intervalDays * 1440),
          lastOutcome: outcome.slice(0, 300),
        },
      });
    }
    return { due: due.length, booked };
  }

  // ---------- Society campaigns ----------

  async campaigns(filter: { city?: string; pincode?: string }) {
    const rows = await this.prisma.homeCampaign.findMany({
      where: {
        status: { in: ['OPEN', 'CONFIRMED', 'BELOW_MINIMUM'] },
        startsAt: { gt: new Date() },
        society: {
          active: true,
          ...(filter.city
            ? { city: { equals: filter.city, mode: 'insensitive' } }
            : {}),
          ...(filter.pincode ? { postalCode: filter.pincode } : {}),
        },
      },
      include: {
        society: {
          select: { name: true, locality: true, city: true, postalCode: true },
        },
        provider: {
          select: {
            displayName: true,
            kind: true,
            salon: { select: { name: true } },
          },
        },
        participants: {
          where: { status: { in: ['JOINED', 'PRICE_APPROVED', 'BOOKED'] } },
          select: { id: true },
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 50,
    });
    const offers = await this.prisma.homeOffering.findMany({
      where: { id: { in: rows.map((r) => r.offeringId) } },
      include: { serviceDef: { select: { name: true } } },
    });
    return rows.map((r) => {
      const o = offers.find((x) => x.id === r.offeringId);
      // Only a count is public - never who joined or where they live.
      return {
        id: r.id,
        title: r.title,
        society: r.society,
        provider: r.provider,
        service: o?.title ?? o?.serviceDef.name ?? null,
        pricePaise: o?.pricePaise ?? null,
        discountPct: r.discountPct,
        minParticipants: r.minParticipants,
        maxParticipants: r.maxParticipants,
        joined: r.participants.length,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        joinBy: r.joinBy,
        status: r.status,
        condition: `The ${r.discountPct}% group discount applies only if at least ${r.minParticipants} residents join by the deadline. Otherwise you will be asked before any other price applies.`,
      };
    });
  }

  async joinCampaign(userId: string, id: string, addressId: string) {
    const address = await this.quotes.ownedAddress(addressId, userId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "home_campaigns" WHERE "id" = ${id} FOR UPDATE`,
      );
      const c = await tx.homeCampaign.findUnique({
        where: { id },
        include: { society: true, participants: true },
      });
      if (!c || c.status !== 'OPEN' || c.joinBy <= new Date())
        throw homeState('This campaign is no longer open to join.');
      if (address.postalCode !== c.society.postalCode)
        throw homeInvalid(
          'This campaign is only for residents of that society.',
        );
      const live = c.participants.filter((p) => p.status !== 'LEFT');
      if (live.some((p) => p.userId === userId))
        throw homeState('You have already joined.');
      if (live.length >= c.maxParticipants)
        throw homeState('This campaign is full.');
      await tx.homeCampaignParticipant.upsert({
        where: { campaignId_userId: { campaignId: id, userId } },
        create: { campaignId: id, userId, addressId },
        update: { status: 'JOINED', addressId },
      });
      return {
        joined: live.length + 1,
        needed: Math.max(0, c.minParticipants - live.length - 1),
      };
    }, TX);
  }

  async leaveCampaign(userId: string, id: string) {
    const r = await this.prisma.homeCampaignParticipant.updateMany({
      where: {
        campaignId: id,
        userId,
        status: { in: ['JOINED', 'PRICE_APPROVED'] },
      },
      data: { status: 'LEFT' },
    });
    if (r.count === 0) throw homeNotFound();
    return { ok: true };
  }

  /** Below minimum: each person decides about the undiscounted price for themselves. */
  async answerCampaignPrice(userId: string, id: string, approve: boolean) {
    const r = await this.prisma.homeCampaignParticipant.updateMany({
      where: {
        campaignId: id,
        userId,
        status: 'JOINED',
        campaign: { status: 'BELOW_MINIMUM' },
      },
      data: { status: approve ? 'PRICE_APPROVED' : 'PRICE_DECLINED' },
    });
    if (r.count === 0)
      throw homeState('There is no price change waiting for you.');
    if (approve) await this.bookCampaign(id);
    return { approved: approve };
  }

  async closeCampaigns(now = new Date()) {
    const due = await this.prisma.homeCampaign.findMany({
      where: { status: 'OPEN', joinBy: { lte: now } },
      include: { participants: { where: { status: 'JOINED' } } },
    });
    for (const c of due) {
      const met = c.participants.length >= c.minParticipants;
      const moved = await this.prisma.homeCampaign.updateMany({
        where: { id: c.id, status: 'OPEN' },
        data: { status: met ? 'CONFIRMED' : 'BELOW_MINIMUM' },
      });
      if (!moved.count) continue;
      for (const p of c.participants)
        await this.core.notify(
          p.userId,
          'home.booking.update',
          `campaign:${c.id}:${met}`,
          met ? 'Society visit confirmed' : 'Group size not reached',
          met
            ? 'The group discount applies. Your own booking follows.'
            : 'The group discount does not apply. Please approve or decline the normal price; nothing is booked without your answer.',
          '/home-services/community',
        );
      if (met) await this.bookCampaign(c.id);
    }
    return due.length;
  }

  /** One individual booking per resident, back to back, each with its own confirmation and payment. */
  private async bookCampaign(id: string) {
    const c = await this.prisma.homeCampaign.findUniqueOrThrow({
      where: { id },
      include: { participants: { orderBy: { createdAt: 'asc' } } },
    });
    const eligible = c.participants.filter((p) =>
      c.status === 'CONFIRMED'
        ? p.status === 'JOINED'
        : p.status === 'PRICE_APPROVED',
    );
    const o = await this.prisma.homeOffering.findUniqueOrThrow({
      where: { id: c.offeringId },
      include: { serviceDef: true },
    });
    const gap =
      o.durationMinutes +
      o.serviceDef.prepMinutes +
      o.serviceDef.cleanupMinutes +
      20;
    let slot = c.startsAt;
    for (const p of eligible) {
      for (
        let tries = 0;
        tries < 40 && addMin(slot, o.durationMinutes) <= c.endsAt;
        tries += 1
      ) {
        const at = slot;
        slot = addMin(slot, 10);
        try {
          const quote = {
            addressId: p.addressId,
            items: [{ offeringId: c.offeringId, quantity: 1 }],
            mode: 'SCHEDULED' as const,
            startAt: at.toISOString(),
            preference: 'SPECIFIC_PROVIDER' as const,
            providerId: c.providerId,
          };
          const q = await this.quotes.quote(quote, p.userId);
          const opt = q.options[0];
          if (!opt) continue;
          const discountPct = c.status === 'CONFIRMED' ? c.discountPct : 0;
          const price = (
            await this.quotes.price(
              opt.provider,
              opt.pro,
              opt.area,
              opt.items,
              opt.serviceStart,
              {},
              discountPct,
            )
          ).price;
          const b = await this.bookings.create(
            {
              quote,
              expectedTotalPaise: price.totalPaise,
              paymentMethod: 'CASH',
              allowAlternatives: false,
              productPreference: 'PROFESSIONAL',
              forChild: false,
              guardianConfirmed: false,
              acceptPolicies: true,
            },
            p.userId,
            `campaign:${c.id}`,
            { campaign: { id: c.id, discountPct } },
          );
          const row = await this.prisma.homeBooking.findUniqueOrThrow({
            where: { code: b.code },
            select: { id: true },
          });
          await this.prisma.homeCampaignParticipant.update({
            where: { id: p.id },
            data: { status: 'BOOKED', bookingId: row.id },
          });
          slot = addMin(at, gap);
          break;
        } catch {
          /* try the next start */
        }
      }
    }
  }

  // ---------- Privacy ----------

  async exportMine(userId: string) {
    const [addresses, bookings, reviews, favorites, incidents] =
      await Promise.all([
        this.prisma.homeAddress.findMany({ where: { userId } }),
        this.prisma.homeBooking.findMany({
          where: { customerId: userId },
          include: { items: true, payments: true, events: true },
        }),
        this.prisma.homeReview.findMany({ where: { customerId: userId } }),
        this.prisma.homeFavorite.findMany({ where: { userId } }),
        this.prisma.homeIncident.findMany({
          where: { reporterUserId: userId },
          select: {
            kind: true,
            description: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);
    return {
      exportedAt: new Date(),
      addresses,
      bookings: bookings.map(
        ({ guestAccessHash: _g, shareHash: _s, idempotencyKey: _i, ...b }) => b,
      ),
      reviews,
      favorites,
      incidents,
    };
  }

  /** Removes what need not be kept; booking and money history stays, as the law and disputes require. */
  async eraseMine(userId: string) {
    const open = await this.prisma.homeBooking.count({
      where: {
        customerId: userId,
        status: {
          in: [
            'REQUESTED',
            'AWAITING_ASSIGNMENT',
            'INVITED',
            'ACCEPTED',
            'CONFIRMED',
            'PREPARING',
            'ON_THE_WAY',
            'ARRIVED',
            'CHECKED_IN',
            'IN_PROGRESS',
            'PAYMENT_PENDING',
          ],
        },
      },
    });
    if (open)
      throw homeState('Please finish or cancel your open home bookings first.');
    await this.prisma.$transaction(async (tx) => {
      await tx.homeFavorite.deleteMany({ where: { userId } });
      await tx.homeRecurringPlan.updateMany({
        where: { customerId: userId },
        data: { status: 'CANCELLED' },
      });
      await tx.homeAddress.deleteMany({
        where: { userId, bookings: { none: {} } },
      });
      await tx.homeAddress.updateMany({
        where: { userId },
        data: {
          archivedAt: new Date(),
          house: 'Removed',
          building: null,
          street: null,
          landmark: null,
          accessNotes: null,
          contactName: null,
          contactPhone: null,
          lat: null,
          lng: null,
        },
      });
      await this.core.audit(tx, {
        actorUserId: userId,
        actorParty: 'CUSTOMER',
        action: 'PERSONAL_DATA_ERASED',
        entityType: 'USER',
        entityId: userId,
      });
    });
    return { ok: true };
  }
}
