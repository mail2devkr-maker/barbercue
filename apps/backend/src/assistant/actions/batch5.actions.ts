import {
  AssistantActionId,
  BookingStatus,
  createOfferSchema,
  updateOfferSchema,
  updateSalonProfileSchema,
} from '@barbercue/shared';
import {
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
  addZonedCalendarDays,
} from '../../common/timezone/timezone';
import { matchByName, normalizeText } from '../assistant-parser';
import { resolveDay, type DaySpec } from '../assistant-when';
import { prettyDate } from './shop-ops.actions';
import {
  Reply,
  pick,
  rupees,
  staleReply,
  text,
  type HandlerMap,
  type PlanCtx,
} from './kit';

/**
 * Batch 5 (issue #362): offers created as DRAFTS (publishing stays a separate confirmed action) and
 * edited by the owner, the shop's public profile, a customer reviewing a completed visit, and anyone
 * choosing their app language. Every value is checked with FastQue's own schema before the preview.
 */

const discountText = (type: string, value: number) =>
  type === 'PERCENT' ? `${value}% off` : `${rupees(value)} off`;
const FIELD_LABEL = {
  description: 'Description',
  phone: 'Phone',
  email: 'Email',
  addressLine: 'Address',
} as const;

/** End of the chosen day in the shop's zone, or now + N days. */
async function validUntil(
  c: PlanCtx,
  until: DaySpec | null,
  days: number | null,
): Promise<{ iso: string; label: string } | null> {
  const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
  const today = utcToZonedDateStr(new Date(), tz);
  const date = until
    ? resolveDay(until, today, zonedDateToDayOfWeek(today))
    : days
      ? addZonedCalendarDays(today, days)
      : null;
  if (!date) return null;
  const end = zonedWallTimeToUtc(date, '23:59', tz);
  return end
    ? { iso: end.toISOString(), label: `till ${prettyDate(date)}` }
    : null;
}

export const BATCH5_HANDLERS: HandlerMap = {
  [AssistantActionId.OFFERS_CREATE]: {
    async plan(c, p) {
      const title = text(p.title);
      if (!title)
        return {
          status: 'NEEDS_INPUT',
          message:
            'What is the offer called? For example "Diwali offer banao 20% off 10 din ke liye".',
        };
      if (!p.discountType || p.discountValue === null)
        return {
          status: 'NEEDS_INPUT',
          message: `How much off for ${title}? Say a percent like "20%" or an amount like "₹50".`,
        };
      const end = await validUntil(
        c,
        (p.until as DaySpec | null) ?? null,
        (p.days as number | null) ?? null,
      );
      if (!end)
        return {
          status: 'NEEDS_INPUT',
          message: `Till when should ${title} run? Say "10 din ke liye" or "30 nov tak".`,
        };
      const services = await c.deps.prisma.service.findMany({
        where: { salonId: c.salonId, isActive: true },
        select: { id: true, name: true },
      });
      const said = ` ${normalizeText(c.text)} `;
      const chosen = services.filter((s) =>
        said.includes(` ${normalizeText(s.name)} `),
      );
      const input = {
        kind: 'OFFER' as const,
        title,
        discountType: p.discountType as 'PERCENT' | 'FLAT',
        discountValue: Number(p.discountValue),
        audience: 'ALL' as const,
        validFrom: new Date().toISOString(),
        validTo: end.iso,
        perCustomerLimit: 1,
        serviceIds: chosen.map((s) => s.id),
      };
      const check = createOfferSchema.safeParse(input);
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message: `${check.error.issues[0]?.message ?? 'That offer is not valid.'} Nothing was changed.`,
        };
      const existing = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 100,
      });
      return c.seal(
        input,
        { titles: existing.items.map((o) => o.title).sort() },
        [
          { label: 'Offer', before: null, after: title },
          {
            label: 'Discount',
            before: null,
            after: discountText(input.discountType, input.discountValue),
          },
          { label: 'Valid', before: null, after: `From now ${end.label}` },
          {
            label: 'Services',
            before: null,
            after: chosen.length
              ? chosen.map((s) => s.name).join(', ')
              : 'All services',
          },
          {
            label: 'Status',
            before: null,
            after: 'Draft (customers do not see it yet)',
          },
        ],
        'Customers see it only after you publish it ("offer live karo").',
      );
    },
    async execute(c) {
      const existing = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 100,
      });
      c.assertUnchanged({ titles: existing.items.map((o) => o.title).sort() });
      const created = await c.deps.offers.create(
        c.user.id,
        c.salonId,
        c.payload as never,
      );
      return c.done(
        `${created.title} saved as a draft.`,
        'offers',
        created.id,
        [{ label: created.title, before: null, after: 'Draft' }],
        `/dashboard/salons/${c.salonId}/offers`,
      );
    },
  },

  [AssistantActionId.OFFERS_EDIT]: {
    async plan(c, p) {
      const page = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 100,
      });
      const rows = page.items.filter((o) => o.status !== 'EXPIRED');
      if (!rows.length)
        throw new Reply({
          status: 'DONE',
          message: 'There are no offers to change.',
        });
      const target = pick(
        rows,
        c.text,
        (o) => o.title,
        'Which offer?',
        (o) => `${o.title} offer ${c.text}`,
      );
      if (target.status === 'ACTIVE')
        return {
          status: 'NEEDS_INPUT',
          message: `${target.title} is live. Pause it first ("${target.title} offer pause karo"), then change it. Nothing was changed.`,
        };
      const patch: Record<string, unknown> = {};
      const rowsOut: { label: string; before: string | null; after: string }[] =
        [];
      if (p.discountType && p.discountValue !== null) {
        patch.discountType = p.discountType;
        patch.discountValue = Number(p.discountValue);
        rowsOut.push({
          label: 'Discount',
          before: discountText(
            target.discountType,
            Number(target.discountValue),
          ),
          after: discountText(String(p.discountType), Number(p.discountValue)),
        });
      }
      const end = await validUntil(
        c,
        (p.until as DaySpec | null) ?? null,
        (p.days as number | null) ?? null,
      );
      if (end) {
        patch.validTo = end.iso;
        rowsOut.push({
          label: 'Valid',
          before: `till ${target.validTo.slice(0, 10)}`,
          after: end.label,
        });
      }
      if (!rowsOut.length)
        return {
          status: 'NEEDS_INPUT',
          message: `What should change in ${target.title}? A new discount ("25%") or end date ("30 nov tak").`,
        };
      const check = updateOfferSchema.safeParse(patch);
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message: `${check.error.issues[0]?.message ?? 'That change is not valid.'} Nothing was changed.`,
        };
      return c.seal(
        { offerId: target.id, patch },
        {
          id: target.id,
          discountValue: target.discountValue,
          validTo: target.validTo,
          status: target.status,
        },
        rowsOut,
      );
    },
    async execute(c) {
      const page = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 100,
      });
      const row = page.items.find((o) => o.id === c.payload.offerId);
      if (!row) throw staleReply();
      c.assertUnchanged({
        id: row.id,
        discountValue: row.discountValue,
        validTo: row.validTo,
        status: row.status,
      });
      const updated = await c.deps.offers.update(
        c.user.id,
        c.salonId,
        row.id,
        c.payload.patch as never,
      );
      return c.done(
        `${updated.title} updated.`,
        'offers',
        updated.id,
        [
          {
            label: updated.title,
            before: discountText(row.discountType, Number(row.discountValue)),
            after: discountText(
              updated.discountType,
              Number(updated.discountValue),
            ),
          },
        ],
        `/dashboard/salons/${c.salonId}/offers`,
      );
    },
  },

  [AssistantActionId.SALON_PROFILE_VIEW]: {
    async plan(c) {
      const s = await c.deps.salonProfile.get(c.user.id, c.salonId);
      return {
        status: 'DONE',
        message: `${s.name}: your public shop details.`,
        result: {
          summary: s.name,
          items: [
            { title: 'Phone', detail: s.phone ?? 'not set' },
            { title: 'Email', detail: s.email ?? 'not set' },
            { title: 'Address', detail: s.addressLine },
            {
              title: 'Description',
              detail: (s.description ?? 'not set').slice(0, 120),
            },
          ],
        },
        navigateTo: `/dashboard/salons/${c.salonId}/settings`,
      };
    },
  },

  [AssistantActionId.SALON_PROFILE_SET]: {
    async plan(c, p) {
      const field = p.field as keyof typeof FIELD_LABEL;
      const value = text(p.value);
      if (!value) {
        return {
          status: 'NEEDS_INPUT',
          message: `What should the ${FIELD_LABEL[field].toLowerCase()} be? Say it after a colon, for example "dukaan ka ${field === 'phone' ? 'phone' : field === 'email' ? 'email' : field === 'addressLine' ? 'address' : 'description'}: ...".`,
        };
      }
      const check = updateSalonProfileSchema.safeParse({ [field]: value });
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message: `${check.error.issues[0]?.message ?? 'That value is not valid.'} Nothing was changed.`,
        };
      const s = await c.deps.salonProfile.get(c.user.id, c.salonId);
      const before =
        (s as unknown as Record<string, string | null>)[field] ?? null;
      if (before === value)
        return {
          status: 'DONE',
          message: 'That is already saved. Nothing was changed.',
        };
      return c.seal(
        { field, value },
        { field, before },
        [
          {
            label: FIELD_LABEL[field],
            before: before ?? 'not set',
            after: value,
          },
        ],
        'Customers see this on your public shop page.',
      );
    },
    async execute(c) {
      const field = text(c.payload.field) as keyof typeof FIELD_LABEL;
      const s = await c.deps.salonProfile.get(c.user.id, c.salonId);
      const before =
        (s as unknown as Record<string, string | null>)[field] ?? null;
      c.assertUnchanged({ field, before });
      const updated = await c.deps.salonProfile.update(c.user.id, c.salonId, {
        [field]: text(c.payload.value),
      });
      return c.done(
        `${FIELD_LABEL[field]} updated.`,
        'profile',
        updated.id,
        [
          {
            label: FIELD_LABEL[field],
            before: before ?? 'not set',
            after:
              (updated as unknown as Record<string, string | null>)[field] ??
              '',
          },
        ],
        `/dashboard/salons/${c.salonId}/settings`,
      );
    },
  },

  [AssistantActionId.REVIEW_WRITE]: {
    async plan(c, p) {
      const rating = p.rating as number | null;
      const done = await c.deps.prisma.booking.findMany({
        where: { customerId: c.user.id, status: BookingStatus.COMPLETED },
        select: {
          id: true,
          slotStart: true,
          salon: { select: { name: true } },
          service: { select: { name: true } },
        },
        orderBy: { slotStart: 'desc' },
        take: 20,
      });
      const reviewed = new Set(
        (
          await c.deps.prisma.review.findMany({
            where: { bookingId: { in: done.map((b) => b.id) } },
            select: { bookingId: true },
          })
        ).map((r) => r.bookingId),
      );
      const open = done.filter((b) => !reviewed.has(b.id));
      if (!open.length)
        return {
          status: 'DONE',
          message: 'You have no completed visits waiting for a review.',
        };
      const named = matchByName(
        c.text,
        open,
        (b) => `${b.service.name} ${b.salon.name}`,
      );
      const visit = named.length === 1 ? named[0] : open[0];
      if (!rating) {
        return {
          status: 'NEEDS_INPUT',
          message: `How many stars for ${visit.service.name} at ${visit.salon.name}?`,
          options: [5, 4, 3, 2, 1].map((n) => ({
            label: '★'.repeat(n),
            text: `${visit.service.name} ko ${n} star review do`,
          })),
        };
      }
      const comment = text(p.comment) || null;
      return c.seal(
        { bookingId: visit.id, rating, ...(comment ? { comment } : {}) },
        { bookingId: visit.id, reviewed: false },
        [
          {
            label: `${visit.service.name} · ${visit.salon.name}`,
            before: 'Not reviewed',
            after: `${'★'.repeat(rating)}${comment ? ` “${comment}”` : ''}`,
          },
        ],
        'Your review is public on the salon page. You can edit it later.',
      );
    },
    async execute(c) {
      const existing = await c.deps.prisma.review.count({
        where: { bookingId: text(c.payload.bookingId) },
      });
      c.assertUnchanged({
        bookingId: text(c.payload.bookingId),
        reviewed: existing > 0,
      });
      const r = await c.deps.customerReviews.create(
        c.user.id,
        c.payload as never,
      );
      return c.done(
        'Thank you, your review is posted.',
        'myBookings',
        r.id,
        [
          {
            label: 'Review',
            before: 'Not reviewed',
            after: '★'.repeat(r.rating),
          },
        ],
        '/account/bookings',
      );
    },
  },

  [AssistantActionId.LANGUAGE_SET]: {
    async plan(c, p) {
      const me = await c.deps.prisma.user.findUnique({
        where: { id: c.user.id },
        select: { preferredLanguage: true },
      });
      const next = p.language === 'HI' ? 'HI' : 'EN';
      const label = (l: string) => (l === 'HI' ? 'हिंदी (Hindi)' : 'English');
      if (me?.preferredLanguage === next)
        return {
          status: 'DONE',
          message: `Your language is already ${label(next)}.`,
        };
      return c.seal(
        { language: next },
        { language: me?.preferredLanguage ?? 'EN' },
        [
          {
            label: 'App language',
            before: label(me?.preferredLanguage ?? 'EN'),
            after: label(next),
          },
        ],
      );
    },
    async execute(c) {
      const me = await c.deps.prisma.user.findUnique({
        where: { id: c.user.id },
        select: { preferredLanguage: true },
      });
      c.assertUnchanged({ language: me?.preferredLanguage ?? 'EN' });
      await c.deps.auth.setLanguage(
        c.user.id,
        c.user.roles,
        c.user.audience,
        text(c.payload.language) as 'EN' | 'HI',
      );
      return c.done('Language updated.', 'profile', c.user.id, [
        {
          label: 'App language',
          before: null,
          after: text(c.payload.language) === 'HI' ? 'हिंदी' : 'English',
        },
      ]);
    },
  },
};
