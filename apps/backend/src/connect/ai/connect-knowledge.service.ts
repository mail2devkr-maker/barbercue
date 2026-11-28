import { Injectable } from '@nestjs/common';
import type { ConnectConversation } from '@prisma/client';
import {
  formatPaise,
  type ConnectBookingCardDto,
  type ConnectIntent,
} from '@barbercue/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectLinksService } from '../connect-links.service';

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * The ONLY facts Connect AI may state (spec section 5). Every value comes from the salon's own
 * records at the moment of the question. When a fact is missing the answer is "a person will
 * reply", never a guess.
 */
export interface VerifiedFacts {
  salonName: string;
  bookingSlug: string | null;
  address: string | null;
  landmark: string | null;
  mapUrl: string | null;
  parking: string | null;
  directions: string | null;
  timeZone: string;
  closedToday: boolean;
  hours: {
    day: string;
    open: string | null;
    close: string | null;
    closed: boolean;
  }[];
  services: { name: string; pricePaise: number; durationMinutes: number }[];
  offers: { title: string; description: string | null; validTo: string }[];
  cancellation: { freeWindowMinutes: number; lateGraceMinutes: number } | null;
  prepayment: string | null;
  faq: { q: string; a: string }[];
  aftercare: string | null;
  card: ConnectBookingCardDto | null;
}

@Injectable()
export class ConnectKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: ConnectLinksService,
  ) {}

  async facts(conv: ConnectConversation): Promise<VerifiedFacts> {
    const settings = await this.prisma.connectSalonSettings.findFirst({
      where: conv.salonId
        ? { salonId: conv.salonId }
        : { homeProviderId: conv.homeProviderId },
    });
    const card = await this.links.card(conv);
    const faq = Array.isArray(settings?.faq)
      ? (settings.faq as { q: string; a: string }[]).filter((x) => x?.q && x?.a)
      : [];
    const base = {
      parking: settings?.parkingInfo ?? null,
      directions: settings?.directions ?? null,
      aftercare: settings?.aftercare ?? null,
      faq,
      card,
    };
    if (!conv.salonId) {
      const p = conv.homeProviderId
        ? await this.prisma.homeProvider.findUnique({
            where: { id: conv.homeProviderId },
            select: { displayName: true },
          })
        : null;
      return {
        ...base,
        salonName: p?.displayName ?? 'Your professional',
        bookingSlug: null,
        address: null,
        landmark: null,
        mapUrl: null,
        timeZone: 'Asia/Kolkata',
        closedToday: false,
        hours: [],
        services: [],
        offers: [],
        cancellation: null,
        prepayment: null,
      };
    }
    const now = new Date();
    const [salon, hours, services, offers, policy, globalPolicy, pay] =
      await Promise.all([
        this.prisma.salon.findUnique({
          where: { id: conv.salonId },
          select: {
            name: true,
            slug: true,
            addressLine: true,
            landmark: true,
            localityText: true,
            postalCode: true,
            lat: true,
            lng: true,
            timezone: true,
            isClosedForToday: true,
          },
        }),
        this.prisma.operatingHours.findMany({
          where: { salonId: conv.salonId },
          orderBy: { dayOfWeek: 'asc' },
        }),
        this.prisma.service.findMany({
          where: { salonId: conv.salonId, isActive: true },
          select: { name: true, price: true, durationMinutes: true },
          orderBy: { name: 'asc' },
          take: 80,
        }),
        this.prisma.offer.findMany({
          where: {
            salonId: conv.salonId,
            status: 'ACTIVE',
            validFrom: { lte: now },
            validTo: { gte: now },
          },
          select: { title: true, description: true, validTo: true },
          take: 10,
        }),
        this.prisma.cancellationPolicy.findUnique({
          where: { salonId: conv.salonId },
        }),
        this.prisma.cancellationPolicy.findFirst({ where: { salonId: null } }),
        this.prisma.salonPaymentPolicy.findUnique({
          where: { salonId: conv.salonId },
          select: { prepaymentRequirement: true, prepaymentPercentage: true },
        }),
      ]);
    const cp = policy ?? globalPolicy;
    return {
      ...base,
      salonName: salon?.name ?? 'The salon',
      bookingSlug: salon?.slug ?? null,
      address: salon
        ? [salon.addressLine, salon.localityText, salon.postalCode]
            .filter(Boolean)
            .join(', ')
        : null,
      landmark: salon?.landmark ?? null,
      mapUrl:
        salon?.lat != null && salon?.lng != null
          ? `https://www.google.com/maps/search/?api=1&query=${salon.lat},${salon.lng}`
          : null,
      timeZone: salon?.timezone ?? 'Asia/Kolkata',
      closedToday: !!salon?.isClosedForToday,
      hours: hours.map((h) => ({
        day: DAYS[h.dayOfWeek] ?? String(h.dayOfWeek),
        open: h.isClosed ? null : h.openTime,
        close: h.isClosed ? null : h.closeTime,
        closed: h.isClosed,
      })),
      services: services.map((s) => ({
        name: s.name,
        pricePaise: Math.round(Number(s.price) * 100),
        durationMinutes: s.durationMinutes,
      })),
      offers: offers.map((o) => ({
        title: o.title,
        description: o.description,
        validTo: o.validTo.toISOString(),
      })),
      cancellation: cp
        ? {
            freeWindowMinutes: cp.freeCancellationWindowMinutes,
            lateGraceMinutes: cp.appointmentArrivalGraceMinutes,
          }
        : null,
      prepayment: pay
        ? pay.prepaymentRequirement === 'NONE'
          ? 'No advance payment is needed.'
          : pay.prepaymentRequirement === 'OPTIONAL'
            ? 'Paying in advance is optional.'
            : pay.prepaymentRequirement === 'FULL'
              ? 'Full payment is needed in advance.'
              : `An advance of ${pay.prepaymentPercentage ?? 0}% is needed.`
        : null,
    };
  }

  /** Every number the AI is allowed to say for this conversation (used by the hallucination guard). */
  allowedNumbers(f: VerifiedFacts, customerText: string): Set<string> {
    const nums = new Set<string>();
    const add = (s: string | number | null | undefined) => {
      if (s == null) return;
      for (const n of String(s).match(/\d+(?:[.,:]\d+)*/g) ?? [])
        nums.add(normNum(n));
    };
    for (const s of f.services) {
      add(s.durationMinutes);
      add(formatPaise(s.pricePaise));
    }
    for (const h of f.hours) {
      add(h.open);
      add(h.close);
    }
    for (const o of f.offers) add(o.title);
    add(f.address);
    add(f.landmark);
    if (f.cancellation) {
      add(f.cancellation.freeWindowMinutes);
      add(f.cancellation.lateGraceMinutes);
    }
    add(f.prepayment);
    for (const q of f.faq) add(q.a);
    add(f.parking);
    add(f.directions);
    if (f.card) {
      add(f.card.reference);
      add(f.card.queuePosition);
      add(f.card.estimatedWaitMinutes);
      add(f.card.durationMinutes);
      if (f.card.totalPaise != null) add(formatPaise(f.card.totalPaise));
      for (const s of f.card.services) {
        add(s.durationMinutes);
        if (s.pricePaise != null) add(formatPaise(s.pricePaise));
      }
      if (f.card.startsAt) add(fmtTime(f.card.startsAt, f.timeZone));
    }
    add(customerText);
    return nums;
  }
}

export const normNum = (n: string) =>
  n
    .replace(/,/g, '')
    .replace(/\.0+$/, '')
    .replace(/^0+(?=\d)/, '');

export const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

const money = (p: number) => formatPaise(p);

/** Does the customer want a price that is not on the list (discount, package, custom quote)? */
export const wantsCustomPrice = (t: string) =>
  /\b(discount|cheaper|less(er)? price|best price|special price|package|negotiat\w*|reduce|kam (karo|kar do|karke)|thoda kam|custom (price|quote)|quotation|quote)\b|छूट|कम कर/i.test(
    t,
  );

/**
 * Deterministic answer from verified facts, or null when the facts do not answer it (then a
 * person replies). Never states anything that is not in `f`.
 */
export function answerFromFacts(
  intent: ConnectIntent,
  text: string,
  f: VerifiedFacts,
): { body: string; confidence: number } | null {
  const t = text.toLowerCase();
  switch (intent) {
    case 'WAITING_TIME': {
      const c = f.card;
      if (!c) return null;
      if (
        c.kind !== 'HOME_SERVICE' &&
        c.queuePosition != null &&
        c.estimatedWaitMinutes != null
      )
        return {
          body: `You are number ${c.queuePosition} in the queue. The current estimated wait is about ${c.estimatedWaitMinutes} minutes. This updates live in the booking card above.`,
          confidence: 0.95,
        };
      if (c.kind === 'HOME_SERVICE' && c.estimatedWaitMinutes != null)
        return {
          body: `Your professional's estimated arrival is in about ${c.estimatedWaitMinutes} minutes. The booking card above updates as they travel.`,
          confidence: 0.9,
        };
      if (c.kind === 'SALON_BOOKING' && c.startsAt && c.status === 'CONFIRMED')
        return {
          body: `Your appointment is booked for ${fmtTime(c.startsAt, f.timeZone)}. Please check in when you arrive; you will see your live position here once you are checked in.`,
          confidence: 0.9,
        };
      if (c.status === 'IN_SERVICE' || c.status === 'IN_PROGRESS')
        return { body: 'Your service has already started.', confidence: 0.9 };
      return null;
    }
    case 'PRICING': {
      if (wantsCustomPrice(t)) return null;
      const named = f.services.filter(
        (s) => s.name.length > 2 && t.includes(s.name.toLowerCase()),
      );
      if (named.length)
        return {
          body:
            named
              .slice(0, 5)
              .map(
                (s) =>
                  `${s.name}: ${money(s.pricePaise)} (about ${s.durationMinutes} min)`,
              )
              .join('\n') + "\nThese are the salon's listed prices.",
          confidence: 0.93,
        };
      if (
        f.card?.totalPaise != null &&
        f.card.services.length &&
        /total|my booking|booked|kitna hoga|total price/i.test(t)
      )
        return {
          body: `Your booked services: ${f.card.services.map((s) => `${s.name}${s.pricePaise != null ? ` ${money(s.pricePaise)}` : ''}`).join(', ')}. Listed total: ${money(f.card.totalPaise)}. Any changes at the salon are confirmed with you first.`,
          confidence: 0.9,
        };
      if (f.services.length && f.services.length <= 8)
        return {
          body:
            'Listed prices:\n' +
            f.services
              .map((s) => `${s.name}: ${money(s.pricePaise)}`)
              .join('\n'),
          confidence: 0.85,
        };
      return null;
    }
    case 'LOCATION': {
      if (/park/i.test(t))
        return f.parking
          ? { body: `Parking: ${f.parking}`, confidence: 0.92 }
          : null;
      if (!f.address) return null;
      const parts = [`${f.salonName} is at ${f.address}.`];
      if (f.landmark) parts.push(`Landmark: ${f.landmark}.`);
      if (f.directions) parts.push(f.directions);
      if (f.parking) parts.push(`Parking: ${f.parking}`);
      if (f.mapUrl) parts.push(`Map: ${f.mapUrl}`);
      return { body: parts.join(' '), confidence: 0.92 };
    }
    case 'OPENING_HOURS': {
      if (!f.hours.length) return null;
      const weekday = new Date().toLocaleString('en-US', {
        timeZone: f.timeZone,
        weekday: 'short',
      });
      const todayIdx = [
        'Sun',
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
      ].indexOf(weekday);
      const lines = f.hours.map(
        (h) => `${h.day}: ${h.closed ? 'closed' : `${h.open}–${h.close}`}`,
      );
      const today = f.hours.find((h) => h.day === DAYS[todayIdx]);
      const head = f.closedToday
        ? 'The salon is closed today.'
        : today
          ? today.closed
            ? 'The salon is closed today.'
            : `Today: ${today.open}–${today.close}.`
          : '';
      return {
        body: `${head}\nOpening hours:\n${lines.join('\n')}`.trim(),
        confidence: 0.9,
      };
    }
    case 'BOOKING_INQUIRY': {
      if (/stylist|barber|particular|specific/.test(t)) return null;
      if (!f.bookingSlug) return null;
      return {
        body: `You can see open times and book here: /book/${f.bookingSlug}. Slots shown there are live; anything not shown is not available.`,
        confidence: 0.8,
      };
    }
    case 'GENERAL': {
      const hit = f.faq.find((x) => overlap(x.q, t) >= 0.6);
      return hit ? { body: hit.a, confidence: 0.8 } : null;
    }
    default:
      return null;
  }
}

function overlap(question: string, text: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2),
    );
  const q = words(question);
  if (!q.size) return 0;
  const tw = words(text);
  let hit = 0;
  for (const w of q) if (tw.has(w)) hit += 1;
  return hit / q.size;
}
