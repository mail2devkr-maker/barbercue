import {
  AssistantActionId,
  NOTIFICATION_TYPE_LABELS,
  type OperatingHoursDto,
  type StaffWorkingHoursDto,
} from '@barbercue/shared';
import {
  utcToZonedDateStr,
  addZonedCalendarDays,
} from '../../common/timezone/timezone';
import { matchByName } from '../assistant-parser';
import { DAY_LABEL, type DaySpec } from '../assistant-when';
import {
  chooseBooking,
  dayBookings,
  bookingLabel,
  localTime,
  prettyDate,
  shopDate,
} from './shop-ops.actions';
import { Reply, pick, rupees, staleReply, text, type HandlerMap } from './kit';

/**
 * Batch 3 (issue #362): chairs, staff weekly hours, appointment no-show, offers, reviews, invoices,
 * revenue report, notifications, customer queue join / favorites / bills, and read-only platform
 * figures. Same rules as every other handler: existing services only, as the session user, and every
 * write previewed, confirmed and re-checked against the state it was previewed from.
 */

const hoursText = (h: {
  isClosed: boolean;
  openTime: string;
  closeTime: string;
}) => (h.isClosed ? 'Off' : `${h.openTime}–${h.closeTime}`);
const staffHoursText = (h: StaffWorkingHoursDto) =>
  h.configured ? hoursText(h) : 'Any shop hours';
const CHAIR_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'In use',
  INACTIVE: 'Off',
  MAINTENANCE: 'Under repair',
};

export const BATCH3_HANDLERS: HandlerMap = {
  // ------------------------------------------------------------------ chairs
  [AssistantActionId.CHAIRS_LIST]: {
    async plan(c) {
      const rows = await c.deps.chairs.list(c.user.id, c.salonId);
      return {
        status: 'DONE',
        message: `${rows.filter((r) => r.status === 'ACTIVE').length} of ${rows.length} chairs in use.`,
        result: {
          summary: 'Chairs',
          items: rows.map((r) => ({
            id: r.id,
            title: r.label,
            detail: CHAIR_STATUS_LABEL[r.status],
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/chairs`,
      };
    },
  },
  [AssistantActionId.CHAIRS_ADD]: {
    async plan(c, p) {
      const rows = await c.deps.chairs.list(c.user.id, c.salonId);
      const label = text(p.label) || `Chair ${rows.length + 1}`;
      if (
        rows.some(
          (r) => r.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
        )
      ) {
        return {
          status: 'NEEDS_INPUT',
          message: `A chair called ${label} already exists. Say a different name.`,
        };
      }
      return c.seal(
        { label },
        { labels: rows.map((r) => r.label).sort() },
        [{ label: 'New chair', before: null, after: label }],
        'An active chair adds booking capacity straight away.',
      );
    },
    async execute(c) {
      const rows = await c.deps.chairs.list(c.user.id, c.salonId);
      c.assertUnchanged({ labels: rows.map((r) => r.label).sort() });
      const created = await c.deps.chairs.create(c.user.id, c.salonId, {
        label: text(c.payload.label),
      });
      return c.done(
        `${created.label} added.`,
        'chairs',
        created.id,
        [{ label: 'New chair', before: null, after: created.label }],
        `/dashboard/salons/${c.salonId}/chairs`,
      );
    },
  },
  [AssistantActionId.CHAIRS_SET_STATUS]: {
    async plan(c, p) {
      const status = p.status as 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
      const rows = await c.deps.chairs.list(c.user.id, c.salonId);
      const target = pick(
        rows,
        c.text,
        (r) => r.label,
        'Which chair?',
        (r) =>
          `${r.label} ${status === 'ACTIVE' ? 'chalu karo' : status === 'MAINTENANCE' ? 'maintenance mein daalo' : 'band karo'}`,
      );
      if (target.status === status)
        return {
          status: 'DONE',
          message: `${target.label} is already ${CHAIR_STATUS_LABEL[status].toLowerCase()}. Nothing was changed.`,
        };
      return c.seal(
        { chairId: target.id, status },
        { id: target.id, status: target.status },
        [
          {
            label: target.label,
            before: CHAIR_STATUS_LABEL[target.status],
            after: CHAIR_STATUS_LABEL[status],
          },
        ],
        status === 'ACTIVE'
          ? undefined
          : 'Fewer chairs means fewer bookable slots. FastQue refuses if a customer is in this chair right now.',
      );
    },
    async execute(c) {
      const row = (await c.deps.chairs.list(c.user.id, c.salonId)).find(
        (r) => r.id === c.payload.chairId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, status: row.status });
      const updated = await c.deps.chairs.update(c.user.id, c.salonId, row.id, {
        status: c.payload.status as 'ACTIVE',
      });
      return c.done(
        `${updated.label} is now ${CHAIR_STATUS_LABEL[updated.status].toLowerCase()}.`,
        'chairs',
        updated.id,
        [
          {
            label: updated.label,
            before: CHAIR_STATUS_LABEL[row.status],
            after: CHAIR_STATUS_LABEL[updated.status],
          },
        ],
        `/dashboard/salons/${c.salonId}/chairs`,
      );
    },
  },

  // ------------------------------------------------------------------ staff weekly hours
  [AssistantActionId.STAFF_HOURS_VIEW]: {
    async plan(c) {
      const staff = pick(
        await c.deps.staff.list(c.user.id, c.salonId),
        c.text,
        (s) => s.displayName,
        'Whose hours?',
        (s) => `${s.displayName} staff ki timing dikhao`,
      );
      const rows = await c.deps.staffHours.list(c.user.id, c.salonId, staff.id);
      return {
        status: 'DONE',
        message: `${staff.displayName}'s week.`,
        result: {
          summary: staff.displayName,
          items: rows.map((h) => ({
            title: DAY_LABEL[h.dayOfWeek],
            detail: staffHoursText(h),
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/staff`,
      };
    },
  },
  [AssistantActionId.STAFF_HOURS_SET]: {
    async plan(c, p) {
      const staff = pick(
        await c.deps.staff.list(c.user.id, c.salonId),
        c.text,
        (s) => s.displayName,
        'Whose hours?',
        (s) => `${s.displayName} staff ${c.text}`,
      );
      const days =
        p.days === 'all' ? [0, 1, 2, 3, 4, 5, 6] : (p.days as number[]);
      const closed = p.closed === true;
      const open = p.open as string | null;
      const close = p.close as string | null;
      if (!closed && (!open || !close))
        return {
          status: 'NEEDS_INPUT',
          message:
            'Say the start and end time, for example "Ravi staff Monday 10 se 6 baje".',
        };
      if (!closed && close! <= open!)
        return {
          status: 'NEEDS_INPUT',
          message: `End (${close}) must be after start (${open}) on the same day.`,
        };
      const current = await c.deps.staffHours.list(
        c.user.id,
        c.salonId,
        staff.id,
      );
      const shop = await c.deps.hours.list(c.user.id, c.salonId);
      // Saving replaces the whole week, so a day never set ("any shop hours") becomes the shop's
      // current hours for that day. Show that change too instead of hiding it.
      const next: OperatingHoursDto[] = current.map((h) => {
        if (days.includes(h.dayOfWeek)) {
          return closed
            ? {
                dayOfWeek: h.dayOfWeek,
                openTime: h.openTime,
                closeTime: h.closeTime,
                isClosed: true,
              }
            : {
                dayOfWeek: h.dayOfWeek,
                openTime: open!,
                closeTime: close!,
                isClosed: false,
              };
        }
        if (h.configured)
          return {
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime,
            closeTime: h.closeTime,
            isClosed: h.isClosed,
          };
        const s = shop.find((x) => x.dayOfWeek === h.dayOfWeek)!;
        return {
          dayOfWeek: h.dayOfWeek,
          openTime: s.openTime,
          closeTime: s.closeTime,
          isClosed: s.isClosed,
        };
      });
      const rows = next
        .map((n) => {
          const before = current.find((x) => x.dayOfWeek === n.dayOfWeek)!;
          const after =
            hoursText(n) +
            (!before.configured && !days.includes(n.dayOfWeek)
              ? ' (fixed)'
              : '');
          return {
            label: DAY_LABEL[n.dayOfWeek],
            before: staffHoursText(before),
            after,
          };
        })
        .filter((r) => r.before !== r.after);
      if (!rows.length)
        return {
          status: 'DONE',
          message: 'Those hours are already set. Nothing was changed.',
        };
      const fixes = rows.some((r) => r.after.endsWith('(fixed)'));
      return c.seal(
        { staffId: staff.id, days: next },
        current,
        rows,
        fixes
          ? 'Days that followed the shop’s hours are saved as the shop’s current hours, so they will not follow later shop-hour changes.'
          : undefined,
      );
    },
    async execute(c) {
      const staffId = text(c.payload.staffId);
      const current = await c.deps.staffHours.list(
        c.user.id,
        c.salonId,
        staffId,
      );
      c.assertUnchanged(current);
      const updated = await c.deps.staffHours.set(
        c.user.id,
        c.salonId,
        staffId,
        { days: c.payload.days as OperatingHoursDto[] },
      );
      return c.done(
        'Staff hours updated.',
        'staffHours',
        staffId,
        updated.map((h) => ({
          label: DAY_LABEL[h.dayOfWeek],
          before: null,
          after: staffHoursText(h),
        })),
        `/dashboard/salons/${c.salonId}/staff`,
      );
    },
  },

  // ------------------------------------------------------------------ appointment no-show
  [AssistantActionId.BOOKING_NO_SHOW]: {
    async plan(c, p) {
      const { tz, date } = await shopDate(c, (p.day as DaySpec | null) ?? null);
      const target = chooseBooking(
        c,
        await dayBookings(c, date),
        tz,
        (p.time as string | null) ?? null,
        'no show',
        date,
      );
      if (new Date(target.slotStart).getTime() > Date.now()) {
        return {
          status: 'NEEDS_INPUT',
          message: `That appointment starts at ${localTime(target.slotStart, tz)}. A no-show can only be marked after it was due.`,
        };
      }
      return c.seal(
        { bookingId: target.id, date },
        { id: target.id, status: target.status, slotStart: target.slotStart },
        [
          {
            label: `${prettyDate(date)} ${bookingLabel(target, tz)}`,
            before: 'Confirmed',
            after: 'No-show',
          },
        ],
        'Your shop’s no-show rule applies, which can add a charge to the customer’s next visit.',
      );
    },
    async execute(c) {
      const row = (await dayBookings(c, text(c.payload.date))).find(
        (b) => b.id === c.payload.bookingId,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({
        id: row.id,
        status: row.status,
        slotStart: row.slotStart,
      });
      const r = await c.deps.noShow.markNoShow(c.user.id, row.id);
      return c.done(
        `Marked as no-show${r.chargeAmount > 0 ? ` (charge ${rupees(r.chargeAmount)})` : ''}.`,
        'bookings',
        row.id,
        [{ label: row.serviceName, before: 'Confirmed', after: 'No-show' }],
        `/dashboard/salons/${c.salonId}/bookings`,
      );
    },
  },

  // ------------------------------------------------------------------ offers (owner only)
  [AssistantActionId.OFFERS_LIST]: {
    async plan(c) {
      const page = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 25,
      });
      return {
        status: 'DONE',
        message: `${page.items.filter((o) => o.status === 'ACTIVE').length} live offers.`,
        result: {
          summary: 'Offers',
          items: page.items.map((o) => ({
            id: o.id,
            title: o.title,
            detail: o.status.toLowerCase(),
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/offers`,
      };
    },
  },
  [AssistantActionId.OFFERS_PAUSE]: offerToggle('pause'),
  [AssistantActionId.OFFERS_PUBLISH]: offerToggle('publish'),

  // ------------------------------------------------------------------ reviews
  [AssistantActionId.REVIEWS_LIST]: {
    async plan(c) {
      const page = await c.deps.reviews.list(
        c.user.id,
        c.salonId,
        undefined,
        '10',
      );
      return {
        status: 'DONE',
        message: page.items.length
          ? `${page.items.filter((r) => !r.ownerResponse).length} reviews waiting for a reply.`
          : 'No reviews yet.',
        result: {
          summary: 'Latest reviews',
          items: page.items.map((r) => ({
            id: r.id,
            title: `${'★'.repeat(r.rating)} ${r.serviceName}`,
            detail: `${(r.comment ?? '').slice(0, 80)}${r.ownerResponse ? ' · replied' : ''}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/reviews`,
      };
    },
  },
  [AssistantActionId.REVIEWS_REPLY]: {
    async plan(c, p) {
      const reply = text(p.reply);
      if (!reply)
        return {
          status: 'NEEDS_INPUT',
          message:
            'What should the reply say? For example "Review ka jawab do: Thank you, phir aaiye!".',
        };
      const page = await c.deps.reviews.list(
        c.user.id,
        c.salonId,
        undefined,
        '20',
      );
      const open = page.items.filter((r) => !r.ownerResponse);
      if (!open.length)
        return {
          status: 'DONE',
          message: 'Every review already has a reply. Nothing was changed.',
        };
      const named = matchByName(c.text, open, (r) => r.serviceName);
      const target = named.length === 1 ? named[0] : open[0];
      return c.seal(
        { reviewId: target.id, reply },
        { id: target.id, ownerResponse: target.ownerResponse },
        [
          {
            label: `${'★'.repeat(target.rating)} ${target.serviceName}: “${(target.comment ?? '').slice(0, 60)}”`,
            before: 'No reply',
            after: reply,
          },
        ],
        'Your reply is shown publicly under this review.',
      );
    },
    async execute(c) {
      const page = await c.deps.reviews.list(
        c.user.id,
        c.salonId,
        undefined,
        '50',
      );
      const row = page.items.find((r) => r.id === c.payload.reviewId);
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, ownerResponse: row.ownerResponse });
      const updated = await c.deps.reviews.respond(
        c.user.id,
        c.salonId,
        row.id,
        text(c.payload.reply),
      );
      return c.done(
        'Reply posted.',
        'reviews',
        updated.id,
        [
          {
            label: row.serviceName,
            before: 'No reply',
            after: updated.ownerResponse ?? '',
          },
        ],
        `/dashboard/salons/${c.salonId}/reviews`,
      );
    },
  },

  // ------------------------------------------------------------------ money (read only)
  [AssistantActionId.INVOICES_LIST]: {
    async plan(c) {
      const page = await c.deps.invoices.list(c.user.id, c.salonId, {
        limit: 10,
      });
      const due = page.items.filter((i) => i.balanceDue > 0);
      return {
        status: 'DONE',
        message: `${page.items.length} recent invoices, ${due.length} with money still due.`,
        result: {
          summary: 'Recent invoices',
          items: page.items.map((i) => ({
            id: i.id,
            title: `${i.number} · ${i.customerName ?? 'Customer'}`,
            detail: `${rupees(i.total)}${i.balanceDue > 0 ? ` · ${rupees(i.balanceDue)} due` : ' · paid'}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/invoices`,
      };
    },
  },
  [AssistantActionId.REVENUE_REPORT]: {
    async plan(c, p) {
      const { date: today } = await shopDate(c, null);
      const from =
        p.range === 'month'
          ? `${today.slice(0, 8)}01`
          : addZonedCalendarDays(today, -6);
      const r = await c.deps.revenue.getReport(c.user.id, c.salonId, {
        from,
        to: today,
        groupBy: 'day',
      } as never);
      const t = r.totals;
      return {
        status: 'DONE',
        message: `${prettyDate(from)} – ${prettyDate(today)}: ${t.completedVisits} completed visits, ${rupees(t.recordedCollections)} collected.`,
        result: {
          summary: 'Revenue report',
          items: [
            { title: 'Completed visits', detail: String(t.completedVisits) },
            {
              title: 'Recorded collections',
              detail: rupees(t.recordedCollections),
            },
            {
              title: 'Estimated service value',
              detail: rupees(t.estimatedServiceValue),
            },
            { title: 'Invoiced', detail: rupees(t.invoicedAmount) },
            ...r.byService.slice(0, 3).map((s) => ({
              title: `Top: ${(s as { serviceName?: string }).serviceName ?? 'Service'}`,
              detail: String(
                (s as { completedVisits?: number }).completedVisits ?? '',
              ),
            })),
          ],
        },
        navigateTo: `/dashboard/salons/${c.salonId}/revenue`,
      };
    },
  },

  // ------------------------------------------------------------------ notifications (own)
  [AssistantActionId.NOTIFICATIONS_LIST]: {
    async plan(c) {
      const [page, unread] = await Promise.all([
        c.deps.notifications.listMine(c.user.id, undefined, 10),
        c.deps.notifications.unreadCount(c.user.id),
      ]);
      const labels = NOTIFICATION_TYPE_LABELS.EN;
      return {
        status: 'DONE',
        message: unread
          ? `${unread} unread notification${unread === 1 ? '' : 's'}.`
          : 'You are all caught up.',
        result: {
          summary: 'Notifications',
          items: page.items.map((n) => ({
            id: n.id,
            title: labels[n.type] ?? n.type,
            detail: `${n.readAt ? 'read' : 'new'} · ${n.createdAt.slice(0, 10)}`,
          })),
        },
      };
    },
  },
  [AssistantActionId.NOTIFICATIONS_READ_ALL]: {
    async plan(c) {
      const unread = await c.deps.notifications.unreadCount(c.user.id);
      if (!unread)
        return {
          status: 'DONE',
          message: 'Nothing unread. Nothing was changed.',
        };
      return c.seal({}, { unread }, [
        { label: 'Unread notifications', before: String(unread), after: '0' },
      ]);
    },
    async execute(c) {
      // A newer notification may have arrived; marking all read is still exactly what was asked.
      await c.deps.notifications.markAllRead(c.user.id);
      return c.done(
        'All notifications marked as read.',
        'notifications',
        c.user.id,
        [{ label: 'Unread notifications', before: null, after: '0' }],
      );
    },
  },

  // ------------------------------------------------------------------ customer
  [AssistantActionId.MY_QUEUE_JOIN]: {
    async plan(c) {
      if (!c.salonId)
        return {
          status: 'NEEDS_INPUT',
          message: 'Open the salon’s page first, then ask to join its queue.',
          navigateTo: '/search',
        };
      const salon = await c.deps.availability.getSalonOrThrow(c.salonId);
      // FastQue needs a mobile number so the shop can reach you about your turn: say so up front.
      const me = await c.deps.prisma.user.findUnique({
        where: { id: c.user.id },
        select: { phone: true },
      });
      if (!me?.phone) {
        return {
          status: 'NEEDS_INPUT',
          message:
            'Add your mobile number to your profile first, so the shop can reach you about your turn.',
          navigateTo: '/account/profile',
        };
      }
      const already = await c.deps.queue.getActiveForCustomer(c.user.id);
      if (already)
        return {
          status: 'DONE',
          message: `You are already in a queue (token ${already.tokenNumber}). Nothing was changed.`,
        };
      const services = await c.deps.prisma.service.findMany({
        where: { salonId: c.salonId, isActive: true },
        select: { id: true, name: true },
      });
      const hit = matchByName(c.text, services, (s) => s.name);
      const service = hit.length === 1 ? hit[0] : null;
      const status = await c.deps.queue.getQueueStatus(c.salonId);
      return c.seal(
        { salonId: c.salonId, serviceId: service?.id ?? null },
        { joined: false },
        [
          { label: 'Salon', before: null, after: salon.name },
          {
            label: 'Service',
            before: null,
            after: service?.name ?? 'Choose at the counter',
          },
          {
            label: 'Waiting now',
            before: null,
            after: String(status.waitingCount),
          },
        ],
        'Your phone gets updates as the line moves. Leave any time with "queue chhod do".',
      );
    },
    async execute(c) {
      const entry = await c.deps.queue.joinWalkIn(
        c.user.id,
        text(c.payload.salonId),
        text(c.payload.serviceId) || undefined,
      );
      return c.done(
        `You joined the queue: token ${entry.tokenNumber}${entry.position ? `, number ${entry.position} in line` : ''}.`,
        'myQueue',
        entry.id,
        [{ label: 'Token', before: null, after: String(entry.tokenNumber) }],
        '/account/bookings',
      );
    },
  },
  [AssistantActionId.MY_FAVORITES]: {
    async plan(c) {
      const rows = await c.deps.favorites.list(c.user.id);
      return {
        status: 'DONE',
        message: rows.length
          ? `${rows.length} favorite salon${rows.length === 1 ? '' : 's'}.`
          : 'No favorite salons yet.',
        result: {
          summary: 'Favorite salons',
          items: rows.map((s) => ({ id: s.id, title: s.name })),
        },
        navigateTo: '/account/favorites',
      };
    },
  },
  [AssistantActionId.MY_FAVORITE_ADD]: {
    async plan(c) {
      if (!c.salonId)
        return {
          status: 'NEEDS_INPUT',
          message:
            'Open the salon’s page first, then say "is salon ko favorite karo".',
        };
      const salon = await c.deps.availability.getSalonOrThrow(c.salonId);
      const { salonIds } = await c.deps.favorites.ids(c.user.id);
      if (salonIds.includes(c.salonId))
        return {
          status: 'DONE',
          message: `${salon.name} is already a favorite. Nothing was changed.`,
        };
      return c.seal({ salonId: c.salonId }, { favorite: false }, [
        { label: salon.name, before: 'Not saved', after: 'Favorite' },
      ]);
    },
    async execute(c) {
      const r = await c.deps.favorites.add(c.user.id, text(c.payload.salonId));
      return c.done(
        'Saved to your favorites.',
        'favorites',
        r.salonId,
        [{ label: 'Favorite', before: 'Not saved', after: 'Favorite' }],
        '/account/favorites',
      );
    },
  },
  [AssistantActionId.MY_FAVORITE_REMOVE]: {
    async plan(c) {
      const rows = await c.deps.favorites.list(c.user.id);
      if (!rows.length)
        return {
          status: 'DONE',
          message: 'You have no favorite salons. Nothing was changed.',
        };
      const onPage = c.salonId
        ? rows.find((s) => s.id === c.salonId)
        : undefined;
      const target =
        onPage ??
        pick(
          rows,
          c.text,
          (s) => s.name,
          'Which salon?',
          (s) => `${s.name} favorite se hatao`,
        );
      return c.seal({ salonId: target.id }, { favorite: true, id: target.id }, [
        { label: target.name, before: 'Favorite', after: 'Not saved' },
      ]);
    },
    async execute(c) {
      const r = await c.deps.favorites.remove(
        c.user.id,
        text(c.payload.salonId),
      );
      return c.done(
        'Removed from your favorites.',
        'favorites',
        r.salonId,
        [{ label: 'Favorite', before: 'Favorite', after: 'Not saved' }],
        '/account/favorites',
      );
    },
  },
  [AssistantActionId.MY_INVOICES]: {
    async plan(c) {
      const page = await c.deps.invoices.listMine(c.user.id, undefined, 10);
      return {
        status: 'DONE',
        message: page.items.length
          ? `${page.items.length} bills.`
          : 'No bills yet.',
        result: {
          summary: 'Your bills',
          items: page.items.map((i) => ({
            id: i.id,
            title: i.number,
            detail: `${rupees(i.total)}${i.balanceDue > 0 ? ` · ${rupees(i.balanceDue)} due` : ' · paid'}`,
          })),
        },
        navigateTo: '/account/invoices',
      };
    },
  },

  // ------------------------------------------------------------------ platform (read only)
  [AssistantActionId.ADMIN_OVERVIEW]: {
    async plan(c) {
      const to = utcToZonedDateStr(new Date(), 'Asia/Kolkata');
      const from = addZonedCalendarDays(to, -29);
      const o = await c.deps.executive.getOverview({ from, to });
      // Most figures are {current, previous}; a few are plain numbers or not tracked (null).
      const items = Object.entries(o.kpis).map(([k, v]) => {
        const shown =
          v === null
            ? 'not tracked'
            : typeof v === 'number'
              ? String(v)
              : `${v.current ?? '—'}${v.previous !== null && v.current !== null ? ` (prev ${v.previous})` : ''}`;
        return {
          title: k
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (s) => s.toUpperCase()),
          detail: shown,
        };
      });
      return {
        status: 'DONE',
        message: `Platform, ${prettyDate(from)} – ${prettyDate(to)}.`,
        result: { summary: 'Platform overview', items },
        navigateTo: '/dashboard/admin/command-center',
      };
    },
  },
  [AssistantActionId.ADMIN_SHOP_STATUS]: {
    async plan(c) {
      const s = await c.deps.shopStatus.getStatus();
      const n = s.counts;
      return {
        status: 'DONE',
        message: `${n.scheduledOpen} of ${n.eligible} active shops are scheduled open now.`,
        result: {
          summary: 'Shops right now',
          items: [
            { title: 'Registered', detail: String(n.registered) },
            { title: 'Active', detail: String(n.eligible) },
            { title: 'Scheduled open', detail: String(n.scheduledOpen) },
            { title: 'Scheduled closed', detail: String(n.scheduledClosed) },
            { title: 'Closed for today', detail: String(n.temporarilyClosed) },
            { title: 'No schedule set', detail: String(n.unknownSchedule) },
          ],
        },
        navigateTo: '/dashboard/admin/shops/status',
      };
    },
  },
};

function offerToggle(
  kind: 'pause' | 'publish',
): NonNullable<HandlerMap[typeof AssistantActionId.OFFERS_PAUSE]> {
  const from = kind === 'pause' ? ['ACTIVE'] : ['DRAFT', 'PAUSED'];
  return {
    async plan(c) {
      const page = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 100,
      });
      const rows = page.items.filter((o) => from.includes(o.status));
      if (!rows.length)
        throw new Reply({
          status: 'DONE',
          message:
            kind === 'pause'
              ? 'No live offers to pause.'
              : 'No draft or paused offers to publish.',
        });
      const target = pick(
        rows,
        c.text,
        (o) => o.title,
        'Which offer?',
        (o) =>
          `${o.title} offer ${kind === 'pause' ? 'pause karo' : 'live karo'}`,
      );
      return c.seal(
        { offerId: target.id },
        { id: target.id, status: target.status },
        [
          {
            label: target.title,
            before: target.status.toLowerCase(),
            after: kind === 'pause' ? 'paused' : 'live',
          },
        ],
        kind === 'publish'
          ? 'Customers can see and use this offer as soon as it is live.'
          : 'Customers stop seeing this offer straight away. Bookings already made keep it.',
      );
    },
    async execute(c) {
      const page = await c.deps.offers.listForOwner(c.user.id, c.salonId, {
        limit: 100,
      });
      const row = page.items.find((o) => o.id === c.payload.offerId);
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, status: row.status });
      const updated =
        kind === 'pause'
          ? await c.deps.offers.pause(c.user.id, c.salonId, row.id)
          : await c.deps.offers.publish(c.user.id, c.salonId, row.id);
      return c.done(
        `${updated.title} is now ${updated.status.toLowerCase()}.`,
        'offers',
        updated.id,
        [
          {
            label: updated.title,
            before: row.status.toLowerCase(),
            after: updated.status.toLowerCase(),
          },
        ],
        `/dashboard/salons/${c.salonId}/offers`,
      );
    },
  };
}
