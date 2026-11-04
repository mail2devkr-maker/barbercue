import { AssistantActionId } from '@barbercue/shared';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
} from '../../common/timezone/timezone';
import { type HandlerMap } from './kit';

/**
 * Batch 13 (issue #362): where the shop's bookings came from (BookingAttributionService.summarize,
 * owner or admin; counts only, no customer rows), and the automatic staff assignment switch
 * (QueueAutoAssignService: anyone in the shop team may read it; only the owner or an admin may
 * change it, after an on-screen confirmation). The switch is reversible and only changes how
 * waiting, arrived visitors are handed to free barbers; it sends no customer message.
 */

const SOURCE_LABEL: Record<string, string> = {
  FASTQUE_WEB: 'FastQue website',
  FASTQUE_APP: 'FastQue app',
  WALK_IN: 'Walk-in',
  IN_SHOP: 'Added in the shop',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  CHATGPT: 'ChatGPT',
  OTHER: 'Other links',
  UNKNOWN: 'Unknown',
};

const onOff = (v: boolean) => (v ? 'On' : 'Off');

export const BATCH13_HANDLERS: HandlerMap = {
  [AssistantActionId.BOOKING_SOURCES]: {
    async plan(c, p) {
      const range = p.range === 'today' || p.range === '7d' ? p.range : '30d';
      const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
      const to = utcToZonedDateStr(new Date(), tz);
      const from =
        range === 'today'
          ? to
          : addZonedCalendarDays(to, range === '7d' ? -6 : -29);
      const s = await c.deps.attribution.summarize(c.user.id, c.salonId, {
        from,
        to,
      });
      const label =
        range === 'today'
          ? 'today'
          : range === '7d'
            ? 'last 7 days'
            : 'last 30 days';
      const total = s.bySource.reduce((n, r) => n + r.bookingCount, 0);
      const ranked = s.bySource
        .filter((r) => r.bookingCount > 0)
        .sort((a, b) => b.bookingCount - a.bookingCount);
      const top = ranked[0];
      return {
        status: 'DONE',
        message:
          total === 0
            ? `No bookings were made ${label === 'today' ? 'today' : `in the ${label}`}.`
            : `${label}: ${total} bookings. Most came from ${SOURCE_LABEL[top.source] ?? top.source} (${top.bookingCount}).`,
        result: {
          summary: `Booking sources, ${label}`,
          items: [
            ...ranked.map((r) => ({
              title: SOURCE_LABEL[r.source] ?? r.source,
              detail: String(r.bookingCount),
            })),
            ...s.campaigns.slice(0, 5).map((k) => ({
              title: `Link: ${k.label}`,
              detail: `${k.bookingCount} · ${SOURCE_LABEL[k.source] ?? k.source}`,
            })),
          ],
        },
        navigateTo: `/dashboard/salons/${c.salonId}/booking-sources`,
      };
    },
  },

  [AssistantActionId.AUTO_ASSIGN_VIEW]: {
    async plan(c) {
      const { autoAssignEnabled } =
        await c.deps.autoAssign.getAutomaticAssignment(c.user.id, c.salonId);
      return {
        status: 'DONE',
        message: autoAssignEnabled
          ? 'Automatic staff assignment is ON: arrived customers go to the next free barber.'
          : 'Automatic staff assignment is OFF: the shop assigns each customer by hand.',
        result: {
          summary: 'Automatic staff assignment',
          items: [{ title: 'Status', detail: onOff(autoAssignEnabled) }],
        },
        navigateTo: `/dashboard/salons/${c.salonId}/settings`,
      };
    },
  },

  [AssistantActionId.AUTO_ASSIGN_SET]: {
    async plan(c, p) {
      const next = p.enabled === true;
      const { autoAssignEnabled: now } =
        await c.deps.autoAssign.getAutomaticAssignment(c.user.id, c.salonId);
      if (now === next)
        return {
          status: 'DONE',
          message: `Automatic staff assignment is already ${onOff(next).toUpperCase()}.`,
        };
      return c.seal(
        { enabled: next },
        { enabled: now },
        [
          {
            label: 'Automatic staff assignment',
            before: onOff(now),
            after: onOff(next),
          },
        ],
        next
          ? 'Customers who have arrived and are waiting will be given to free barbers right away.'
          : 'New arrivals will wait until someone in the shop assigns them.',
      );
    },
    async execute(c) {
      const { autoAssignEnabled: now } =
        await c.deps.autoAssign.getAutomaticAssignment(c.user.id, c.salonId);
      c.assertUnchanged({ enabled: now });
      const next = c.payload.enabled === true;
      const r = await c.deps.autoAssign.setAutomaticAssignment(
        c.user.id,
        c.salonId,
        next,
      );
      return c.done(
        `Automatic staff assignment is now ${onOff(r.autoAssignEnabled).toUpperCase()}.`,
        'queue',
        c.salonId,
        [
          {
            label: 'Automatic staff assignment',
            before: onOff(now),
            after: onOff(r.autoAssignEnabled),
          },
        ],
        `/dashboard/salons/${c.salonId}/settings`,
      );
    },
  },
};
