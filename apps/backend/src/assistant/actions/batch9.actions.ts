import {
  AssistantActionId,
  CrmLeadStatus,
  createCrmFollowUpSchema,
  updateReviewSchema,
} from '@barbercue/shared';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
} from '../../common/timezone/timezone';
import { matchByName } from '../assistant-parser';
import { resolveDay, type DaySpec } from '../assistant-when';
import { prettyDate } from './shop-ops.actions';
import { Reply, pick, staleReply, text, type HandlerMap } from './kit';

/**
 * Batch 9 (issue #362): an employee schedules a follow-up on one of their own leads; a customer
 * edits their own review; platform readers see shop activity counts (no contact details) with the
 * same audience as the admin route. Employee times are India time (the CRM is India-only today).
 */

const IST = 'Asia/Kolkata';
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const MAX = 8;

export const BATCH9_HANDLERS: HandlerMap = {
  [AssistantActionId.EMPLOYEE_SCHEDULE_FOLLOW_UP]: {
    async plan(c, p) {
      const leads = (await c.deps.employee.listLeads(c.user.id)).filter(
        (l) =>
          l.status !== CrmLeadStatus.LOST &&
          l.status !== CrmLeadStatus.ONBOARDED,
      );
      if (!leads.length)
        throw new Reply({
          status: 'DONE',
          message: 'You have no open leads to follow up.',
        });
      const lead = pick(
        leads,
        c.text,
        (l) => l.shopName,
        'Which of your leads is the follow-up for?',
        (l) => `${l.shopName} ka follow up ${c.text}`,
      );
      const day = (p.day as DaySpec | null) ?? null;
      if (!day)
        return {
          status: 'NEEDS_INPUT',
          message: `When should you follow up with ${lead.shopName}? Say a day and time, for example "kal 4 baje".`,
        };
      const today = utcToZonedDateStr(new Date(), IST);
      const date = resolveDay(day, today, zonedDateToDayOfWeek(today));
      const time = text(p.time) || '11:00';
      const due = date ? zonedWallTimeToUtc(date, time, IST) : null;
      if (!due || due.getTime() <= Date.now()) {
        return {
          status: 'NEEDS_INPUT',
          message:
            'That time has already passed. Say a later day or time. Nothing was saved.',
        };
      }
      if (date && date > addZonedCalendarDays(today, 365))
        return {
          status: 'NEEDS_INPUT',
          message: 'Choose a date within the next year.',
        };
      const notes = text(p.notes) || undefined;
      const input = {
        leadId: lead.id,
        dueAt: due.toISOString(),
        channel: text(p.channel) || 'CALL',
        ...(notes ? { notes } : {}),
      };
      const check = createCrmFollowUpSchema.safeParse(input);
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message: `${check.error.issues[0]?.message ?? 'That follow-up is not valid.'} Nothing was saved.`,
        };
      const open = await c.deps.employee.listFollowUps(c.user.id, 'OPEN');
      return c.seal(
        input,
        {
          leadId: lead.id,
          open: open.filter((f) => f.leadId === lead.id).length,
        },
        [
          { label: 'Follow-up', before: null, after: lead.shopName },
          {
            label: 'When',
            before: null,
            after: `${prettyDate(date)} ${time}`,
          },
          { label: 'How', before: null, after: words(input.channel) },
          ...(notes ? [{ label: 'Notes', before: null, after: notes }] : []),
        ],
      );
    },
    async execute(c) {
      const leadId = text(c.payload.leadId);
      const open = await c.deps.employee.listFollowUps(c.user.id, 'OPEN');
      c.assertUnchanged({
        leadId,
        open: open.filter((f) => f.leadId === leadId).length,
      });
      const f = await c.deps.employee.createFollowUp(
        c.user.id,
        c.payload as never,
      );
      return c.done(
        `Follow-up with ${f.leadShopName} saved.`,
        'employee',
        f.id,
        [{ label: f.leadShopName, before: null, after: 'Open' }],
        '/employee',
      );
    },
  },

  [AssistantActionId.REVIEW_EDIT]: {
    async plan(c, p) {
      const mine = await c.deps.prisma.review.findMany({
        where: { customerId: c.user.id },
        select: {
          id: true,
          rating: true,
          comment: true,
          updatedAt: true,
          salon: { select: { name: true } },
          booking: { select: { service: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      if (!mine.length)
        return {
          status: 'DONE',
          message: 'You have not written any reviews yet.',
        };
      const label = (r: (typeof mine)[number]) =>
        `${r.booking.service.name} · ${r.salon.name}`;
      const named = matchByName(c.text, mine, label);
      if (named.length !== 1 && mine.length > 1) {
        return {
          status: 'NEEDS_INPUT',
          message: 'Which review should change?',
          options: (named.length ? named : mine).slice(0, MAX).map((r) => ({
            label: label(r),
            text: `${r.booking.service.name} ${r.salon.name} ka review badlo ${c.text}`,
          })),
        };
      }
      const r = named[0] ?? mine[0];
      const rating = p.rating as number | null;
      const comment = text(p.comment) || undefined;
      const patch = {
        ...(rating ? { rating } : {}),
        ...(comment ? { comment } : {}),
      };
      const check = updateReviewSchema.safeParse(patch);
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message:
            'Say the new stars ("4 star") or the new words after a colon. Nothing was changed.',
        };
      return c.seal(
        { reviewId: r.id, patch },
        { id: r.id, updatedAt: r.updatedAt.toISOString() },
        [
          ...(rating
            ? [
                {
                  label: 'Stars',
                  before: '★'.repeat(r.rating),
                  after: '★'.repeat(rating),
                },
              ]
            : []),
          ...(comment
            ? [{ label: 'Comment', before: r.comment ?? '—', after: comment }]
            : []),
        ],
        `${label(r)}. Your review is public on the salon page.`,
      );
    },
    async execute(c) {
      const id = text(c.payload.reviewId);
      const r = await c.deps.prisma.review.findFirst({
        where: { id, customerId: c.user.id },
        select: { id: true, updatedAt: true },
      });
      if (!r) throw staleReply();
      c.assertUnchanged({ id, updatedAt: r.updatedAt.toISOString() });
      const updated = await c.deps.customerReviews.update(
        c.user.id,
        id,
        c.payload.patch as never,
      );
      return c.done(
        'Your review is updated.',
        'myBookings',
        updated.id,
        [{ label: 'Review', before: null, after: '★'.repeat(updated.rating) }],
        '/account/bookings',
      );
    },
  },

  [AssistantActionId.ADMIN_SHOP_ACTIVITY]: {
    async plan(c, p) {
      const to = utcToZonedDateStr(new Date(), IST);
      const days = Number(p.days) === 7 ? 7 : 1;
      const from = addZonedCalendarDays(to, -(days - 1));
      const a = await c.deps.shopActivity.getActivity({ from, to });
      const range =
        days === 1 ? 'today' : `${prettyDate(from)} – ${prettyDate(to)}`;
      return {
        status: 'DONE',
        message: `${range}: ${a.bookings.total} bookings (${a.bookings.completed} completed), ${a.queue.joined} queue joins, ${a.queue.liveNow} waiting now.`,
        result: {
          summary: `Shop activity, ${range}`,
          items: a.shops.slice(0, MAX).map((s) => ({
            title: s.name,
            detail: `${s.bookings.total} bookings · ${s.queue.joined} queue · ${s.queue.liveNow} now`,
          })),
        },
        navigateTo: '/dashboard/admin/shops',
      };
    },
  },
};
