import { AssistantActionId } from '@barbercue/shared';
import { type HandlerMap } from './kit';

/**
 * Batch 14 (issue #362):
 * - A barber takes the next arrived customer they can serve (QueueAutoAssignService.takeNext, the
 *   same path as the Live Queue "Take next" button: the barber's own on-duty profile, a free chair,
 *   service starts). Previewed from the barber's own work view; the preview goes stale if their
 *   queue changed. Customer phone numbers are never read out.
 * - The shop's public booking link (SalonShareLinksService, owner or admin).
 * - Tracked booking links (BookingAttributionService.listCampaigns, owner or admin): labels, status
 *   and booking counts only. A link's secret token is shown once at creation and never here.
 */

const MAX = 8;

// The work view's `revision` is a read timestamp, so the fingerprint uses the queue itself.
const eligibleIds = (w: {
  waiting: Array<{ queueEntryId: string; eligible: boolean }>;
}) => w.waiting.filter((x) => x.eligible).map((x) => x.queueEntryId);

const SOURCE_LABEL: Record<string, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  CHATGPT: 'ChatGPT',
  OTHER: 'Other',
};

export const BATCH14_HANDLERS: HandlerMap = {
  [AssistantActionId.STAFF_TAKE_NEXT]: {
    async plan(c) {
      const w = await c.deps.staffWork.getMyWork(c.user.id, c.salonId);
      if (w.current)
        return {
          status: 'FAILED',
          message: `You are serving token ${w.current.tokenNumber}. Complete that service first.`,
          navigateTo: `/dashboard/salons/${c.salonId}/queue`,
        };
      if (w.assigned)
        return {
          status: 'FAILED',
          message: `Token ${w.assigned.tokenNumber} is already assigned to you. Start or release that visit first.`,
          navigateTo: `/dashboard/salons/${c.salonId}/queue`,
        };
      const next = w.waiting
        .filter((x) => x.eligible)
        .sort((a, b) => a.position - b.position)[0];
      if (!next)
        return {
          status: 'DONE',
          message:
            'No arrived customer in the queue can be served by you right now.',
          navigateTo: `/dashboard/salons/${c.salonId}/queue`,
        };
      return c.seal(
        {},
        {
          staffId: w.staffId,
          next: next.queueEntryId,
          eligible: eligibleIds(w),
        },
        [
          { label: 'Barber', before: null, after: w.displayName },
          {
            label: 'Next customer',
            before: null,
            after: `Token ${next.tokenNumber} · ${next.customerLabel}${next.serviceName ? ` · ${next.serviceName}` : ''}`,
          },
        ],
        'Their service starts now, on a free chair.',
      );
    },
    async execute(c) {
      const w = await c.deps.staffWork.getMyWork(c.user.id, c.salonId);
      const next = w.waiting
        .filter((x) => x.eligible)
        .sort((a, b) => a.position - b.position)[0];
      c.assertUnchanged({
        staffId: w.staffId,
        next: next?.queueEntryId,
        eligible: eligibleIds(w),
      });
      const entry = await c.deps.autoAssign.takeNext(c.user.id, c.salonId);
      return c.done(
        `Started token ${entry.tokenNumber} for ${w.displayName}.`,
        'queue',
        entry.id,
        [
          {
            label: 'Now serving',
            before: null,
            after: `Token ${entry.tokenNumber}`,
          },
        ],
        `/dashboard/salons/${c.salonId}/queue`,
      );
    },
  },

  [AssistantActionId.SHARE_LINKS]: {
    async plan(c) {
      const s = await c.deps.shareLinks.getForSalon(c.user.id, c.salonId);
      const why: Record<string, string> = {
        SALON_NOT_PUBLIC: 'the shop is not public yet',
        WEB_BASE_URL_NOT_CONFIGURED: 'the website address is not set up',
      };
      if (!s.readiness.ready || !s.publicUrl)
        return {
          status: 'DONE',
          message: `Your booking link is not ready: ${s.readiness.reasons.map((r) => why[r] ?? r).join('; ') || 'not available'}.`,
          result: {
            summary: 'Booking link',
            items: [{ title: 'Page path', detail: s.publicPath }],
          },
        };
      return {
        status: 'DONE',
        message: `Your booking link: ${s.publicUrl}`,
        result: {
          summary: 'Booking link',
          items: [
            { title: 'Link', detail: s.publicUrl },
            { title: 'Shown as', detail: s.metadata.title },
          ],
        },
      };
    },
  },

  [AssistantActionId.TRACKED_LINKS]: {
    async plan(c) {
      const page = await c.deps.attribution.listCampaigns(
        c.user.id,
        c.salonId,
        { limit: MAX },
      );
      const live = page.items.filter((k) => !k.revokedAt);
      return {
        status: 'DONE',
        message:
          page.items.length === 0
            ? 'You have no tracked booking links yet.'
            : `${live.length} active tracked link${live.length === 1 ? '' : 's'}${page.items.length > live.length ? `, ${page.items.length - live.length} switched off` : ''}.`,
        result: {
          summary: 'Tracked booking links',
          items: page.items.map((k) => ({
            title: k.label,
            detail: `${SOURCE_LABEL[k.source] ?? k.source} · ${k.bookingCount} bookings${k.revokedAt ? ' · switched off' : ''}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/booking-sources`,
      };
    },
  },
};
