import { randomInt, timingSafeEqual } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  type HomeBookingStatus,
  type HomeCodePurpose,
} from '@prisma/client';
import {
  HOME_HYGIENE_CHECKLIST,
  HOME_TIME_ZONE,
  HOME_TRACKABLE,
  HomeErrorCode,
  computeHomeEta,
  type HomePrice,
  type HomeTravelMode,
} from '@barbercue/shared';
import { zonedHourOf } from '../common/timezone/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { homeFlag } from './home-config';
import { HomeAvailabilityService } from './home-availability.service';
import {
  HomeBookingService,
  type FullBooking,
  type HomeViewer,
} from './home-booking.service';
import {
  HomeCoreService,
  TX,
  addMin,
  minutesBetween,
  sha256,
  type Tx,
} from './home-core.service';
import {
  homeError,
  homeForbidden,
  homeInvalid,
  homeState,
  isOverlapViolation,
} from './home-errors';
import { HomeRoutingService } from './home-routing.service';

const STALE_MINUTES = 5;
const MAX_CODES_PER_HOUR = 6;

/** Everything from "get ready" to "paid": the professional's actions and their customer checks. */
@Injectable()
export class HomeVisitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: HomeCoreService,
    private readonly bookings: HomeBookingService,
    private readonly availability: HomeAvailabilityService,
    private readonly routing: HomeRoutingService,
  ) {}

  /** The ACTIVE assignee only - not someone who used to be assigned. */
  private async asAssigned(code: string, viewer: HomeViewer) {
    const a = await this.bookings.require(code, viewer, ['PROFESSIONAL']);
    const asg = await this.prisma.homeAssignment.findFirst({
      where: {
        bookingId: a.id,
        status: 'ACTIVE',
        professional: { userId: viewer.userId! },
      },
      select: { professionalId: true },
    });
    if (!asg)
      throw homeForbidden(
        'You are not the assigned professional for this booking.',
      );
    return { id: a.id, professionalId: asg.professionalId };
  }

  private async step(
    code: string,
    viewer: HomeViewer,
    to: HomeBookingStatus,
    opts: {
      data?: (
        b: FullBooking,
        now: Date,
      ) => Prisma.HomeBookingUncheckedUpdateInput;
      effect?: (tx: Tx, b: FullBooking, now: Date) => Promise<void>;
      note?: string;
      notice?: [string, string];
    } = {},
  ) {
    const { id } = await this.asAssigned(code, viewer);
    const now = new Date();
    const b = await this.prisma.$transaction(async (tx) => {
      const locked = await this.bookings.lockBooking(tx, id);
      await this.bookings.transition(
        tx,
        locked,
        to,
        { party: 'PROFESSIONAL', userId: viewer.userId },
        opts.note,
        opts.data?.(locked, now),
      );
      await opts.effect?.(tx, locked, now);
      return locked;
    }, TX);
    if (opts.notice)
      await this.bookings.notifyCustomer(b, to, opts.notice[0], opts.notice[1]);
    return this.bookings.view(code, viewer);
  }

  prepare(code: string, viewer: HomeViewer) {
    return this.step(code, viewer, 'PREPARING', {
      notice: [
        'Getting ready',
        'Your professional is preparing for your visit.',
      ],
    });
  }

  async onTheWay(code: string, viewer: HomeViewer) {
    const out = await this.step(code, viewer, 'ON_THE_WAY', {
      data: (_b, now) => ({ travelStartedAt: now }),
      notice: ['On the way', 'Your professional has started travelling.'],
    });
    await this.recalculateEta(code);
    return out;
  }

  arrived(code: string, viewer: HomeViewer) {
    return this.step(code, viewer, 'ARRIVED', {
      data: (_b, now) => ({ arrivedAt: now }),
      effect: (tx, b) => this.bookings.endTracking(tx, b.id, 'ARRIVED'),
      notice: [
        'Your professional has arrived',
        'Share your start code only when they are with you.',
      ],
    });
  }

  addressIssue(code: string, viewer: HomeViewer, reason: string) {
    return this.step(code, viewer, 'ADDRESS_ISSUE', {
      note: reason,
      notice: [
        'Help needed finding your address',
        'Please call your professional.',
      ],
    });
  }

  async customerNoShow(code: string, viewer: HomeViewer, reason: string) {
    return this.step(code, viewer, 'CUSTOMER_NO_SHOW', {
      note: reason,
      effect: (tx, b) => this.bookings.release(tx, b.id, 'CUSTOMER_NO_SHOW'),
      notice: [
        'Visit closed',
        'Your professional reported that nobody was available. If this is wrong, open a complaint.',
      ],
    });
  }

  async professionalNoShow(code: string, viewer: HomeViewer, reason: string) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER', 'ADMIN']);
    await this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, a.id);
      if (
        a.party === 'CUSTOMER' &&
        new Date() < addMin(b.serviceStart, 15 + b.delayMinutes)
      )
        throw homeState(
          'Please wait until 15 minutes after the expected time, or contact the provider.',
        );
      await this.bookings.transition(
        tx,
        b,
        'PROFESSIONAL_NO_SHOW',
        { party: a.party, userId: viewer.userId },
        reason,
      );
      await this.bookings.release(tx, b.id, 'PROFESSIONAL_NO_SHOW');
    }, TX);
    return this.bookings.view(code, viewer);
  }

  // ---------- Delay / ETA ----------

  /** A reported delay moves this visit; the next visit of the same person is flagged, never silently moved. */
  async delay(
    code: string,
    viewer: HomeViewer,
    minutes: number,
    reason?: string,
  ) {
    const { id, professionalId } = await this.asAssigned(code, viewer);
    let overlapped = false;
    const b = await this.prisma.$transaction(async (tx) => {
      await this.availability.lock(tx, professionalId);
      const locked = await this.bookings.lockBooking(tx, id);
      if (
        ![
          'CONFIRMED',
          'PREPARING',
          'ON_THE_WAY',
          'ADDRESS_ISSUE',
          'IN_PROGRESS',
          'ARRIVED',
          'CHECKED_IN',
        ].includes(locked.status)
      )
        throw homeState('A delay cannot be reported now.');
      await this.core.event(tx, id, {
        kind: 'DELAY',
        party: 'PROFESSIONAL',
        actorUserId: viewer.userId,
        note: reason,
        metadata: { minutes },
      });
      await tx.homeBooking.update({
        where: { id },
        data: {
          delayMinutes: { increment: minutes },
          etaFrom: locked.etaFrom ? addMin(locked.etaFrom, minutes) : null,
          etaTo: locked.etaTo ? addMin(locked.etaTo, minutes) : null,
        },
      });
      return locked;
    }, TX);
    // Extending the reserved window is separate: when the following commitment is too close, the
    // constraint refuses and that following customer is told instead.
    try {
      await this.prisma.professionalCommitment.updateMany({
        where: { bookingId: id, kind: 'HOME_BOOKING', releasedAt: null },
        data: { endAt: addMin((await this.window(id)).endAt, minutes) },
      });
    } catch (err) {
      if (!isOverlapViolation(err)) throw err;
      overlapped = true;
    }
    await this.bookings.notifyCustomer(
      b,
      `delay:${b.delayMinutes + minutes}`,
      'Running late',
      `Your professional expects to be about ${minutes} minutes later than shown.`,
    );
    if (overlapped) await this.flagNext(id, minutes);
    await this.core.notify(
      b.provider.salon?.ownerUserId,
      'home.provider.update',
      `${id}:delay:${b.delayMinutes + minutes}`,
      'Home visit delayed',
      `${b.code} is running about ${minutes} minutes late.`,
      `/dashboard/salons/${b.provider.salonId}/home-services?tab=active`,
    );
    return {
      ...(await this.bookings.view(code, viewer)),
      nextAtRisk: overlapped,
    };
  }

  private window(bookingId: string) {
    return this.prisma.professionalCommitment.findFirstOrThrow({
      where: { bookingId, kind: 'HOME_BOOKING', releasedAt: null },
      select: {
        userId: true,
        startAt: true,
        endAt: true,
        serviceStart: true,
        serviceEnd: true,
      },
    });
  }

  /** Recalculates the next customer's ETA after an overrun and tells them when it moved a lot. */
  private async flagNext(bookingId: string, minutes: number) {
    const mine = await this.window(bookingId);
    const next = await this.prisma.professionalCommitment.findFirst({
      where: {
        userId: mine.userId,
        kind: 'HOME_BOOKING',
        releasedAt: null,
        startAt: { gte: mine.startAt },
        bookingId: { not: bookingId },
      },
      orderBy: { startAt: 'asc' },
      include: { booking: true },
    });
    if (!next?.booking) return;
    const gap = minutesBetween(mine.endAt, next.startAt);
    const late = minutes - Math.max(0, gap);
    if (late <= 0) return;
    await this.prisma.homeBooking.update({
      where: { id: next.booking.id },
      data: {
        etaTo: addMin(next.booking.etaTo ?? next.booking.serviceStart, late),
        etaConfidence: 'LOW',
      },
    });
    await this.core.event(this.prisma, next.booking.id, {
      kind: 'AT_RISK',
      party: 'SYSTEM',
      note: 'The previous visit is running late.',
      metadata: { lateMinutes: late },
    });
    await this.bookings.notifyCustomer(
      next.booking,
      `atrisk:${bookingId}:${late}`,
      'Your visit may start late',
      `An earlier visit is running over. You may wait about ${late} more minutes; you can reschedule or cancel free of charge.`,
    );
  }

  /** Uses the last consented location while travelling; otherwise base travel. Never claims live accuracy it lacks. */
  async recalculateEta(code: string) {
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { code },
      include: {
        address: true,
        provider: { include: { salon: true } },
        tracking: {
          where: { endedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!['ON_THE_WAY', 'ADDRESS_ISSUE'].includes(b.status)) return;
    const t = b.tracking[0];
    const age = t?.lastAt ? minutesBetween(t.lastAt, new Date()) : null;
    const fresh =
      t?.lastLat != null &&
      t.lastLng != null &&
      age != null &&
      age <= STALE_MINUTES;
    const from = fresh
      ? { lat: t.lastLat, lng: t.lastLng }
      : b.provider.salon
        ? {
            lat: b.provider.salon.lat,
            lng: b.provider.salon.lng,
            postalCode: b.provider.salon.postalCode,
          }
        : { lat: b.provider.baseLat, lng: b.provider.baseLng };
    const travel = await this.routing.travel(
      from,
      {
        lat: b.address.lat,
        lng: b.address.lng,
        postalCode: b.address.postalCode,
      },
      b.provider.travelMode,
    );
    const now = new Date();
    const elapsed =
      !fresh && b.travelStartedAt ? minutesBetween(b.travelStartedAt, now) : 0;
    const settings = await this.core.settings();
    const eta = computeHomeEta({
      now,
      availableFrom: now,
      prepMinutes: 0,
      travelMinutes: Math.max(3, travel.minutes - elapsed),
      travelSource: travel.source,
      accessBufferMinutes: settings.accessBufferMinutes,
      serviceMinutes: 0,
      cleanupMinutes: 0,
      alreadyPreparing: true,
      locationAgeMinutes: fresh ? age : null,
    });
    const moved = b.etaTo
      ? Math.abs(minutesBetween(b.etaTo, eta.windowTo))
      : 99;
    await this.prisma.homeBooking.update({
      where: { id: b.id },
      data: {
        etaFrom: eta.windowFrom,
        etaTo: eta.windowTo,
        etaConfidence: eta.confidence,
        etaBasis: {
          source: travel.source,
          travelMinutes: travel.minutes,
          location: fresh ? 'LAST_SHARED' : 'BASE',
          roadKm: travel.roadKm,
        },
      },
    });
    if (moved >= 10)
      await this.bookings.notifyCustomer(
        b,
        `eta:${Math.floor(eta.windowTo.getTime() / 600_000)}`,
        'Arrival time updated',
        'Please check the new estimated arrival window.',
      );
  }

  // ---------- Tracking ----------

  async startTracking(code: string, viewer: HomeViewer, consent: boolean) {
    const { id } = await this.asAssigned(code, viewer);
    if (!homeFlag('HOME_LIVE_TRACKING_ENABLED'))
      return { sharing: false, reason: 'DISABLED' };
    if (!consent) {
      await this.core.event(this.prisma, id, {
        kind: 'TRACKING_DECLINED',
        party: 'PROFESSIONAL',
        actorUserId: viewer.userId,
      });
      return { sharing: false, reason: 'DECLINED' };
    }
    return this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, id);
      if (!HOME_TRACKABLE.includes(b.status))
        throw homeState(
          'Location can only be shared while you are on the way.',
        );
      await this.bookings.endTracking(tx, id, 'RESTARTED');
      const s = await tx.homeTrackingSession.create({
        data: {
          bookingId: id,
          professionalUserId: viewer.userId!,
          consentAt: new Date(),
        },
      });
      return { sharing: true, sessionId: s.id };
    }, TX);
  }

  async stopTracking(code: string, viewer: HomeViewer) {
    const { id } = await this.asAssigned(code, viewer);
    await this.prisma.$transaction(
      (tx) => this.bookings.endTracking(tx, id, 'STOPPED_BY_PROFESSIONAL'),
      TX,
    );
    return { sharing: false };
  }

  async pushLocation(
    code: string,
    viewer: HomeViewer,
    p: { lat: number; lng: number; accuracy?: number },
  ) {
    const { id } = await this.asAssigned(code, viewer);
    const s = await this.prisma.homeTrackingSession.findFirst({
      where: {
        bookingId: id,
        professionalUserId: viewer.userId!,
        endedAt: null,
        booking: { status: { in: [...HOME_TRACKABLE] } },
      },
      select: { id: true, lastAt: true },
    });
    if (!s || !homeFlag('HOME_LIVE_TRACKING_ENABLED'))
      return { sharing: false };
    // One stored point per 10 seconds at most.
    if (s.lastAt && Date.now() - s.lastAt.getTime() < 10_000)
      return { sharing: true, throttled: true };
    await this.prisma.homeTrackingSession.updateMany({
      where: { id: s.id, endedAt: null },
      data: {
        lastLat: p.lat,
        lastLng: p.lng,
        lastAccuracyM: p.accuracy ?? null,
        lastAt: new Date(),
      },
    });
    if (!s.lastAt || Date.now() - s.lastAt.getTime() > 60_000)
      await this.recalculateEta(code);
    return { sharing: true };
  }

  /** Customer and FastQue dispatch only; nothing once the visit leaves the travelling stage. */
  async tracking(code: string, viewer: HomeViewer) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER', 'ADMIN']);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id: a.id },
      include: {
        tracking: {
          where: { endedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    const unavailable = (reason: string) => ({
      mode: 'STATUS_ONLY' as const,
      reason,
      status: b.status,
      location: null,
      lastUpdatedAt: null,
    });
    if (!homeFlag('HOME_LIVE_TRACKING_ENABLED'))
      return unavailable(
        'Live location is not available. Status updates are shown instead.',
      );
    if (!HOME_TRACKABLE.includes(b.status))
      return unavailable(
        'Location is only shared while your professional is travelling to you.',
      );
    if (a.party === 'CUSTOMER' && !b.customerId && !b.guestPhoneVerifiedAt)
      return unavailable('Verify your phone number to see this.');
    const t = b.tracking[0];
    if (!t || t.lastLat == null || !t.lastAt)
      return unavailable(
        'Your professional is not sharing a location. Status updates are shown instead.',
      );
    const age = minutesBetween(t.lastAt, new Date());
    return {
      mode: age > STALE_MINUTES ? ('LAST_KNOWN' as const) : ('RECENT' as const),
      reason:
        age > STALE_MINUTES
          ? `Last known location, ${age} minutes old. It is not live.`
          : null,
      status: b.status,
      location: { lat: t.lastLat, lng: t.lastLng, accuracyM: t.lastAccuracyM },
      lastUpdatedAt: t.lastAt.toISOString(),
    };
  }

  // ---------- Codes (OTP / QR) ----------

  async issueCode(code: string, viewer: HomeViewer, purpose: HomeCodePurpose) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER']);
    const settings = await this.core.settings();
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, a.id);
      const okStates: HomeBookingStatus[] =
        purpose === 'START'
          ? ['CONFIRMED', 'PREPARING', 'ON_THE_WAY', 'ARRIVED', 'ADDRESS_ISSUE']
          : ['IN_PROGRESS'];
      if (!okStates.includes(b.status))
        throw homeState('A code is not needed at this stage.');
      if (!b.customerId && !b.guestPhoneVerifiedAt)
        throw homeError(
          HomeErrorCode.GUEST_VERIFICATION_REQUIRED,
          'Verify your phone number first.',
          HttpStatus.FORBIDDEN,
        );
      const recent = await tx.homeServiceCode.count({
        where: {
          bookingId: b.id,
          purpose,
          createdAt: { gt: addMin(now, -60) },
        },
      });
      if (recent >= MAX_CODES_PER_HOUR)
        throw homeError(
          HomeErrorCode.RATE_LIMITED,
          'Too many codes requested. Please wait and try again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      await tx.homeServiceCode.updateMany({
        where: { bookingId: b.id, purpose, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const value = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = addMin(now, settings.codeMinutes);
      await tx.homeServiceCode.create({
        data: {
          bookingId: b.id,
          purpose,
          codeHash: this.codeHash(b.id, purpose, value),
          expiresAt,
        },
      });
      return {
        purpose,
        code: value,
        qr: `fastque-home:${b.code}:${purpose}:${value}`,
        expiresAt: expiresAt.toISOString(),
      };
    }, TX);
  }

  private codeHash(bookingId: string, purpose: string, value: string) {
    // Keyed by a server secret and scoped to one booking and purpose.
    return sha256(
      `${process.env.OTP_HASH_SECRET ?? process.env.JWT_ACCESS_SECRET ?? ''}:${bookingId}:${purpose}:${value}`,
    );
  }

  /** Attempt counting commits even when the code is wrong, so guessing is really limited. */
  private async consumeCode(
    bookingId: string,
    purpose: HomeCodePurpose,
    value: string,
  ) {
    const settings = await this.core.settings();
    const now = new Date();
    const row = await this.prisma.homeServiceCode.findFirst({
      where: { bookingId, purpose, usedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row)
      throw homeError(
        HomeErrorCode.CODE_INVALID,
        'Ask the customer to show a new code.',
        HttpStatus.BAD_REQUEST,
      );
    if (row.expiresAt <= now)
      throw homeError(
        HomeErrorCode.CODE_EXPIRED,
        'That code has expired. Ask the customer for a new one.',
        HttpStatus.BAD_REQUEST,
      );
    const counted = await this.prisma.homeServiceCode.updateMany({
      where: {
        id: row.id,
        attempts: { lt: settings.codeAttempts },
        usedAt: null,
      },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0)
      throw homeError(
        HomeErrorCode.RATE_LIMITED,
        'Too many wrong attempts. Ask the customer for a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const given = Buffer.from(this.codeHash(bookingId, purpose, value.trim()));
    const want = Buffer.from(row.codeHash);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      throw homeError(
        HomeErrorCode.CODE_INVALID,
        'That code is not correct.',
        HttpStatus.BAD_REQUEST,
      );
    const used = await this.prisma.homeServiceCode.updateMany({
      where: {
        id: row.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (used.count === 0)
      throw homeError(
        HomeErrorCode.CODE_INVALID,
        'That code was already used.',
        HttpStatus.BAD_REQUEST,
      );
  }

  private parseCode(code: string, purpose: string, raw: string): string {
    if (!raw.startsWith('fastque-home:')) return raw;
    const [, bookingCode, p, value] = raw.split(':');
    if (bookingCode !== code || p !== purpose)
      throw homeError(
        HomeErrorCode.CODE_INVALID,
        'That QR code is for a different booking.',
        HttpStatus.BAD_REQUEST,
      );
    return value ?? '';
  }

  async checkIn(code: string, viewer: HomeViewer, raw: string) {
    const { id } = await this.asAssigned(code, viewer);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id },
    });
    if (b.status !== 'ARRIVED')
      throw homeState('Mark yourself as arrived first.');
    await this.consumeCode(id, 'START', this.parseCode(code, 'START', raw));
    return this.step(code, viewer, 'CHECKED_IN', {
      note: 'Start code verified',
    });
  }

  start(code: string, viewer: HomeViewer) {
    return this.step(code, viewer, 'IN_PROGRESS', {
      data: (_b, now) => ({ startedAt: now }),
      effect: async (tx, b) => {
        const done = b.hygiene.find((h) => h.stage === 'BEFORE');
        if (b.status === 'IN_PROGRESS' && !done)
          await this.core.event(tx, b.id, {
            kind: 'HYGIENE_MISSING',
            party: 'SYSTEM',
            note: 'Started without the hygiene checklist',
          });
      },
      notice: ['Service started', 'Enjoy your service.'],
    });
  }

  async interrupt(code: string, viewer: HomeViewer, reason: string) {
    const a = await this.bookings.require(code, viewer, [
      'PROFESSIONAL',
      'CUSTOMER',
      'ADMIN',
    ]);
    await this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, a.id);
      await this.bookings.transition(
        tx,
        b,
        'INTERRUPTED',
        { party: a.party, userId: viewer.userId },
        reason,
      );
    }, TX);
    return this.bookings.view(code, viewer);
  }

  /** Audited exception when a code cannot be verified. */
  async adminForceCheckIn(code: string, adminId: string, note: string) {
    const a = await this.bookings.require(
      code,
      { userId: adminId, admin: true },
      ['ADMIN'],
    );
    await this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, a.id);
      await this.bookings.transition(
        tx,
        b,
        'CHECKED_IN',
        { party: 'ADMIN', userId: adminId },
        note,
      );
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: 'FORCED_CHECK_IN',
        entityType: 'BOOKING',
        entityId: b.id,
        note,
      });
    }, TX);
    return this.bookings.view(code, { userId: adminId, admin: true });
  }

  async hygiene(
    code: string,
    viewer: HomeViewer,
    stage: 'BEFORE' | 'AFTER',
    answers: Record<string, boolean>,
  ) {
    const { id } = await this.asAssigned(code, viewer);
    const list = HOME_HYGIENE_CHECKLIST[stage];
    const clean = Object.fromEntries(
      list.map((i) => [i.id, answers[i.id] === true]),
    );
    const complete = Object.values(clean).every(Boolean);
    await this.prisma.homeHygieneRecord.upsert({
      where: { bookingId_stage: { bookingId: id, stage } },
      create: {
        bookingId: id,
        stage,
        answers: clean,
        complete,
        recordedByUserId: viewer.userId!,
      },
      update: { answers: clean, complete, recordedByUserId: viewer.userId! },
    });
    await this.core.event(this.prisma, id, {
      kind: 'HYGIENE',
      party: 'PROFESSIONAL',
      actorUserId: viewer.userId,
      metadata: { stage, complete },
    });
    return { stage, complete };
  }

  // ---------- Extras ----------

  async requestAdjustment(
    code: string,
    viewer: HomeViewer,
    input: {
      description: string;
      offeringId?: string;
      amountPaise?: number;
      minutes: number;
    },
  ) {
    const { id } = await this.asAssigned(code, viewer);
    const b = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id },
    });
    if (!['ARRIVED', 'CHECKED_IN', 'IN_PROGRESS'].includes(b.status))
      throw homeState('Extras can only be added during the visit.');
    let amount = input.amountPaise ?? 0;
    let minutes = input.minutes;
    if (input.offeringId) {
      const o = await this.prisma.homeOffering.findFirst({
        where: { id: input.offeringId, providerId: b.providerId, active: true },
      });
      if (!o)
        throw homeInvalid('That service is not offered by this provider.');
      // A listed service is always charged at its listed price.
      amount =
        o.pricePaise + o.productPaise + o.disposablePaise + o.equipmentPaise;
      minutes = o.durationMinutes;
    }
    const row = await this.prisma.homePriceAdjustment.create({
      data: {
        bookingId: id,
        description: input.description,
        offeringId: input.offeringId ?? null,
        amountPaise: amount,
        minutes,
        requestedByUserId: viewer.userId!,
      },
    });
    await this.bookings.notifyCustomer(
      b,
      `adj:${row.id}`,
      'Approve an extra?',
      `${input.description} – nothing is added unless you approve it.`,
    );
    return { id: row.id, status: row.status, amountPaise: amount };
  }

  /** Only the customer can raise the price, and only if the extra time really fits. */
  async decideAdjustment(
    code: string,
    viewer: HomeViewer,
    adjustmentId: string,
    approve: boolean,
  ) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER']);
    try {
      await this.prisma.$transaction(async (tx) => {
        const b = await this.bookings.lockBooking(tx, a.id);
        const adj = b.adjustments.find((x) => x.id === adjustmentId);
        if (!adj || adj.status !== 'PENDING')
          throw homeState('This request was already answered.');
        if (!['ARRIVED', 'CHECKED_IN', 'IN_PROGRESS'].includes(b.status))
          throw homeState('The visit is no longer in progress.');
        await tx.homePriceAdjustment.update({
          where: { id: adj.id },
          data: {
            status: approve ? 'APPROVED' : 'DECLINED',
            decidedAt: new Date(),
          },
        });
        await this.core.event(tx, b.id, {
          kind: approve ? 'EXTRA_APPROVED' : 'EXTRA_DECLINED',
          party: 'CUSTOMER',
          actorUserId: viewer.userId,
          note: adj.description,
          metadata: { amountPaise: adj.amountPaise, minutes: adj.minutes },
        });
        if (!approve) return;
        if (adj.minutes > 0) {
          const c = await tx.professionalCommitment.findFirstOrThrow({
            where: { bookingId: b.id, kind: 'HOME_BOOKING', releasedAt: null },
          });
          await tx.professionalCommitment.update({
            where: { id: c.id },
            data: {
              endAt: addMin(c.endAt, adj.minutes),
              serviceEnd: c.serviceEnd
                ? addMin(c.serviceEnd, adj.minutes)
                : null,
            },
          });
        }
        const price = b.priceSnapshot as unknown as HomePrice;
        const next: HomePrice = {
          ...price,
          lines: [
            ...price.lines,
            {
              code: 'EXTRA',
              label: `${adj.description} (approved by you)`,
              paise: adj.amountPaise,
            },
          ],
          servicePaise: price.servicePaise + adj.amountPaise,
          totalPaise: price.totalPaise + adj.amountPaise,
        };
        await tx.homeBooking.update({
          where: { id: b.id },
          data: {
            totalPaise: next.totalPaise,
            priceSnapshot: next as unknown as Prisma.InputJsonValue,
            serviceEnd: addMin(b.serviceEnd, adj.minutes),
          },
        });
        if (adj.offeringId) {
          const o = await tx.homeOffering.findUniqueOrThrow({
            where: { id: adj.offeringId },
            include: { serviceDef: true },
          });
          await tx.homeBookingItem.create({
            data: {
              bookingId: b.id,
              offeringId: o.id,
              serviceDefId: o.serviceDefId,
              serviceName: (o.title ?? o.serviceDef.name).slice(0, 120),
              unitPaise: adj.amountPaise,
              lineTotalPaise: adj.amountPaise,
              durationMinutes: o.durationMinutes,
              addedLater: true,
            },
          });
        }
      }, TX);
    } catch (err) {
      if (isOverlapViolation(err))
        throw homeState(
          'There is not enough time before the next appointment for this extra.',
        );
      throw err;
    }
    return this.bookings.view(code, viewer);
  }

  // ---------- Completion, products, money ----------

  async complete(
    code: string,
    viewer: HomeViewer,
    opts: {
      code?: string;
      productUse?: { productId: string; quantity: number }[];
    },
  ) {
    const { id, professionalId } = await this.asAssigned(code, viewer);
    const settings = await this.core.settings();
    const before = await this.prisma.homeBooking.findUniqueOrThrow({
      where: { id },
    });
    if (before.status !== 'IN_PROGRESS')
      throw homeState('The service is not in progress.');
    if (settings.requireCompletionCode) {
      if (!opts.code)
        throw homeError(
          HomeErrorCode.CODE_INVALID,
          "Enter the customer's completion code.",
          HttpStatus.BAD_REQUEST,
        );
      await this.consumeCode(
        id,
        'COMPLETE',
        this.parseCode(code, 'COMPLETE', opts.code),
      );
    }
    const now = new Date();
    const b = await this.prisma.$transaction(async (tx) => {
      const locked = await this.bookings.lockBooking(tx, id);
      await this.bookings.transition(
        tx,
        locked,
        'COMPLETED',
        { party: 'PROFESSIONAL', userId: viewer.userId },
        null,
        { completedAt: now },
      );
      // Completion is not payment: the money side starts as pending.
      await this.bookings.transition(
        tx,
        locked,
        'PAYMENT_PENDING',
        { party: 'SYSTEM' },
        null,
        { paymentStatus: 'PENDING' },
      );
      await tx.homeAssignment.updateMany({
        where: { bookingId: id, status: 'ACTIVE' },
        data: { status: 'COMPLETED', releasedAt: now },
      });
      // Free the remaining time; keep at least the moment worked so history stays truthful.
      const c = await tx.professionalCommitment.findFirst({
        where: { bookingId: id, kind: 'HOME_BOOKING', releasedAt: null },
      });
      if (c) {
        const travelBack = locked.provider.salonId ? this.tailMinutes(c) : 0;
        const end = addMin(now, travelBack);
        await tx.professionalCommitment.update({
          where: { id: c.id },
          data: end > c.startAt && end < c.endAt ? { endAt: end } : {},
        });
      }
      await this.bookings.endTracking(tx, id, 'COMPLETED');
      await this.consumeProducts(
        tx,
        locked,
        professionalId,
        viewer.userId!,
        opts.productUse,
      );
      await this.recordEarning(tx, locked, professionalId);
      await this.recordMetric(tx, locked, professionalId, now);
      return locked;
    }, TX);
    await this.bookings.notifyCustomer(
      b,
      'completed',
      'Service completed',
      `Please pay ${b.provider.displayName} directly. You can review the service now.`,
    );
    await this.core.notify(
      b.provider.salon?.ownerUserId,
      'home.provider.update',
      `${id}:completed`,
      'Home service completed',
      `${b.code} is complete; payment is pending.`,
      `/dashboard/salons/${b.provider.salonId}/home-services?tab=completed`,
    );
    return this.bookings.view(code, viewer);
  }

  private tailMinutes(c: { endAt: Date; serviceEnd: Date | null }) {
    return c.serviceEnd
      ? Math.max(0, minutesBetween(c.serviceEnd, c.endAt))
      : 0;
  }

  /** One CONSUMPTION movement per booking+product (unique idempotency key), through the existing stock ledger. */
  private async consumeProducts(
    tx: Tx,
    b: FullBooking,
    professionalId: string,
    userId: string,
    actual?: { productId: string; quantity: number }[],
  ) {
    const salonId = b.provider.salonId;
    const wanted = new Map<string, number>();
    if (actual)
      for (const a of actual)
        wanted.set(a.productId, (wanted.get(a.productId) ?? 0) + a.quantity);
    else if (salonId) {
      const rules = await tx.homeOfferingProduct.findMany({
        where: {
          offeringId: {
            in: b.items
              .map((i) => i.offeringId)
              .filter((v): v is string => !!v),
          },
        },
      });
      for (const r of rules) {
        const q = b.items
          .filter((i) => i.offeringId === r.offeringId)
          .reduce((s, i) => s + i.quantity, 0);
        wanted.set(
          r.productId,
          (wanted.get(r.productId) ?? 0) + Number(r.quantity) * q,
        );
      }
    }
    if (wanted.size === 0 || !salonId) return;
    for (const [productId, quantity] of wanted) {
      const key = `home:${b.id}:${productId}`;
      const rows = await tx.$queryRaw<
        {
          id: string;
          stockOnHand: Prisma.Decimal;
          name: string;
          unit: string;
        }[]
      >(
        Prisma.sql`SELECT "id","stockOnHand","name","unit"::text AS "unit" FROM "inventory_products" WHERE "id"=${productId} AND "salonId"=${salonId} FOR UPDATE`,
      );
      const p = rows[0];
      if (!p) throw homeInvalid('That product does not belong to this salon.');
      if (
        await tx.inventoryMovement.findUnique({
          where: { salonId_idempotencyKey: { salonId, idempotencyKey: key } },
        })
      )
        continue;
      const qty = new Prisma.Decimal(quantity.toFixed(3));
      const short = p.stockOnHand.lessThan(qty);
      // A short stock count must not block finishing a visit: it is recorded for the owner to correct.
      let movementId: string | null = null;
      if (short)
        await this.core.event(tx, b.id, {
          kind: 'STOCK_SHORT',
          party: 'SYSTEM',
          note: p.name,
          metadata: {
            productId,
            needed: qty.toString(),
            onHand: p.stockOnHand.toString(),
          },
        });
      else
        movementId = (
          await tx.inventoryMovement.create({
            data: {
              salonId,
              productId,
              actorUserId: userId,
              kind: 'CONSUMPTION',
              quantityDelta: qty.negated(),
              reason: `Home service ${b.code}`,
              reference: b.code,
              idempotencyKey: key,
              requestHash: sha256(key),
            },
          })
        ).id;
      await tx.homeProductUse.create({
        data: {
          bookingId: b.id,
          professionalId,
          productId,
          productName: p.name,
          quantity: qty,
          unit: p.unit,
          movementId,
        },
      });
    }
  }

  private async recordEarning(tx: Tx, b: FullBooking, professionalId: string) {
    const price = b.priceSnapshot as unknown as HomePrice;
    const comp = b.provider.compensation as {
      model?: string;
      fixedPaise?: number;
      percent?: number;
      travelAllowancePaise?: number;
    } | null;
    const net = price.servicePaise - price.discountPaise;
    const staffPayout =
      b.provider.kind === 'SALON_MANAGED' && comp
        ? (comp.model === 'FIXED_PER_VISIT'
            ? (comp.fixedPaise ?? 0)
            : comp.model === 'PERCENT'
              ? Math.round((net * (comp.percent ?? 0)) / 100)
              : 0) + (comp.travelAllowancePaise ?? 0)
        : 0;
    const uses = await tx.homeProductUse.findMany({
      where: { bookingId: b.id },
      include: { product: { select: { averageUnitCost: true } } },
    });
    const cost = uses.reduce(
      (s, u) =>
        s +
        Math.round(
          Number(u.quantity) * Number(u.product?.averageUnitCost ?? 0) * 100,
        ),
      0,
    );
    const fee = await this.platformFee(tx, b, net);
    await tx.homeEarning.create({
      data: {
        bookingId: b.id,
        providerId: b.providerId,
        professionalId,
        servicePaise: price.servicePaise,
        travelPaise: price.travelPaise,
        productPaise: price.productPaise,
        discountPaise: price.discountPaise,
        platformFeePaise: fee,
        staffPayoutPaise: staffPayout,
        productCostPaise: cost,
      },
    });
  }

  /** Zero unless monetization is switched on AND an admin activated a rule. Completed services only. */
  private async platformFee(
    tx: Tx,
    b: FullBooking,
    netPaise: number,
  ): Promise<number> {
    if (!homeFlag('HOME_MONETIZATION_ENABLED')) return 0;
    const rules = await tx.homeFeeRule.findMany({
      where: {
        active: true,
        OR: [
          { providerId: b.providerId },
          { providerId: null, providerKind: b.provider.kind },
          { providerId: null, providerKind: null },
        ],
      },
    });
    const pick = (kind: string) => {
      const list = rules.filter((r) => r.kind === kind);
      return (
        list.find((r) => r.providerId) ??
        list.find((r) => r.providerKind) ??
        list[0]
      );
    };
    const commission = pick('COMMISSION');
    const fixed = pick('FIXED_BOOKING');
    const amount =
      (commission
        ? Math.round((netPaise * commission.percentBps) / 10_000) +
          commission.fixedPaise
        : 0) + (fixed?.fixedPaise ?? 0);
    if (amount > 0)
      await tx.homePlatformFee.create({
        data: {
          bookingId: b.id,
          providerId: b.providerId,
          amountPaise: amount,
          ruleSnapshot: {
            commission: commission ?? null,
            fixed: fixed ?? null,
          },
        },
      });
    return amount;
  }

  private async recordMetric(
    tx: Tx,
    b: FullBooking,
    professionalId: string,
    now: Date,
  ) {
    const first = b.items[0];
    if (!first || !b.startedAt) return;
    await tx.homeVisitMetric.create({
      data: {
        bookingId: b.id,
        professionalId,
        serviceDefId: first.serviceDefId,
        city: b.address.city,
        hourOfDay: zonedHourOf(b.startedAt, HOME_TIME_ZONE),
        plannedMinutes: b.items.reduce(
          (s, i) => s + i.durationMinutes * i.quantity,
          0,
        ),
        actualMinutes: minutesBetween(b.startedAt, now),
        plannedTravel:
          (b.etaBasis as { travelMinutes?: number } | null)?.travelMinutes ??
          null,
        actualTravel:
          b.travelStartedAt && b.arrivedAt
            ? minutesBetween(b.travelStartedAt, b.arrivedAt)
            : null,
        etaErrorMinutes:
          b.arrivedAt && b.etaTo ? minutesBetween(b.etaTo, b.arrivedAt) : null,
      },
    });
  }

  /** Only whoever collects the money can record it, for a completed service, up to the amount due. */
  async recordPayment(
    code: string,
    viewer: HomeViewer,
    input: {
      method: 'CASH' | 'DIRECT_UPI' | 'OTHER_OFFLINE';
      amountPaise: number;
      tipPaise: number;
      reference?: string;
    },
    idempotencyKey: string,
  ) {
    const a = await this.bookings.require(code, viewer, [
      'PROFESSIONAL',
      'PROVIDER',
      'ADMIN',
    ]);
    const key = sha256(`pay:${a.id}:${idempotencyKey}`);
    const b = await this.prisma.$transaction(async (tx) => {
      const locked = await this.bookings.lockBooking(tx, a.id);
      if (
        await tx.homePaymentRecord.findUnique({
          where: { idempotencyKey: key },
        })
      )
        return locked;
      if (locked.status !== 'PAYMENT_PENDING')
        throw homeState(
          'Payment can only be recorded after the service is completed.',
        );
      const paid = locked.payments
        .filter((p) => !p.voidedAt)
        .reduce((s, p) => s + p.amountPaise, 0);
      if (paid + input.amountPaise > locked.totalPaise)
        throw homeInvalid(
          'That is more than the amount due. Record a tip separately.',
        );
      await tx.homePaymentRecord.create({
        data: {
          bookingId: locked.id,
          method: input.method,
          amountPaise: input.amountPaise,
          tipPaise: input.tipPaise,
          collectedBy: locked.provider.displayName,
          reference: input.reference ?? null,
          recordedByUserId: viewer.userId!,
          idempotencyKey: key,
        },
      });
      if (input.tipPaise > 0)
        await tx.homeEarning.updateMany({
          where: { bookingId: locked.id },
          data: { tipPaise: { increment: input.tipPaise } },
        });
      const full = paid + input.amountPaise === locked.totalPaise;
      await this.core.event(tx, locked.id, {
        kind: 'PAYMENT_RECORDED',
        party: a.party,
        actorUserId: viewer.userId,
        metadata: {
          amountPaise: input.amountPaise,
          method: input.method,
          full,
        },
      });
      if (full)
        await this.bookings.transition(
          tx,
          locked,
          'PAYMENT_CONFIRMED',
          { party: a.party, userId: viewer.userId },
          null,
          { paymentStatus: 'CONFIRMED' },
        );
      else
        await tx.homeBooking.update({
          where: { id: locked.id },
          data: { paymentStatus: 'PARTIAL' },
        });
      return locked;
    }, TX);
    await this.bookings.notifyCustomer(
      b,
      `paid:${key.slice(0, 12)}`,
      'Payment recorded',
      `${b.provider.displayName} recorded your payment. If that is wrong, dispute it from the booking. FastQue did not process this money.`,
    );
    this.bookings.signal();
    return this.bookings.view(code, viewer);
  }

  async customerPaymentAnswer(
    code: string,
    viewer: HomeViewer,
    paymentId: string,
    agree: boolean,
    note?: string,
  ) {
    const a = await this.bookings.require(code, viewer, ['CUSTOMER']);
    await this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, a.id);
      const p = b.payments.find((x) => x.id === paymentId && !x.voidedAt);
      if (!p) throw homeState('Payment record not found.');
      if (agree) {
        await tx.homePaymentRecord.update({
          where: { id: p.id },
          data: { customerConfirmedAt: new Date() },
        });
        if (
          b.status === 'PAYMENT_CONFIRMED' &&
          b.complaintStatus !== 'RAISED' &&
          b.complaintStatus !== 'UNDER_REVIEW'
        )
          await this.bookings.transition(tx, b, 'CLOSED', {
            party: 'CUSTOMER',
            userId: viewer.userId,
          });
        return;
      }
      await tx.homePaymentRecord.update({
        where: { id: p.id },
        data: {
          disputedAt: new Date(),
          disputeNote: note?.slice(0, 500) ?? null,
        },
      });
      await tx.homeBooking.update({
        where: { id: b.id },
        data: { paymentStatus: 'DISPUTED', complaintStatus: 'RAISED' },
      });
      await this.core.event(tx, b.id, {
        kind: 'PAYMENT_DISPUTED',
        party: 'CUSTOMER',
        actorUserId: viewer.userId,
        note,
      });
      await tx.homeTicket.create({
        data: {
          bookingId: b.id,
          category: 'PAYMENT',
          priority: 'HIGH',
          openedByUserId: viewer.userId,
          openedByParty: 'CUSTOMER',
          messages: {
            create: {
              authorUserId: viewer.userId,
              authorParty: 'CUSTOMER',
              body: note ?? 'I dispute this payment record.',
            },
          },
        },
      });
    }, TX);
    return this.bookings.view(code, viewer);
  }

  async voidPayment(
    code: string,
    adminId: string,
    paymentId: string,
    note: string,
  ) {
    const a = await this.bookings.require(
      code,
      { userId: adminId, admin: true },
      ['ADMIN'],
    );
    await this.prisma.$transaction(async (tx) => {
      const b = await this.bookings.lockBooking(tx, a.id);
      const p = b.payments.find((x) => x.id === paymentId && !x.voidedAt);
      if (!p) throw homeState('Payment record not found.');
      await tx.homePaymentRecord.update({
        where: { id: p.id },
        data: { voidedAt: new Date() },
      });
      if (b.status === 'PAYMENT_CONFIRMED')
        await this.bookings.transition(
          tx,
          b,
          'PAYMENT_PENDING',
          { party: 'ADMIN', userId: adminId },
          note,
          { paymentStatus: 'PENDING' },
        );
      else
        await tx.homeBooking.update({
          where: { id: b.id },
          data: { paymentStatus: 'PENDING' },
        });
      await this.core.audit(tx, {
        actorUserId: adminId,
        actorParty: 'ADMIN',
        action: 'PAYMENT_VOIDED',
        entityType: 'BOOKING',
        entityId: b.id,
        note,
        metadata: { paymentId },
      });
    }, TX);
    return this.bookings.view(code, { userId: adminId, admin: true });
  }
}
