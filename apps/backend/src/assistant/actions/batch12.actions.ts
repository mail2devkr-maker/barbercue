import { AssistantActionId } from '@barbercue/shared';
import { localTime } from './shop-ops.actions';
import { type HandlerMap } from './kit';

/**
 * Batch 12 (issue #362): a barber's own day (StaffWorkService - the barber's own records, with the
 * shop's access check), the owner's cancellation figures (CancellationAnalyticsService, owner or
 * admin), and a customer's credit balance (CustomerCreditsService, own account). Read-only.
 * Customer phone numbers in the barber's work view are never read out.
 */

const MAX = 8;

export const BATCH12_HANDLERS: HandlerMap = {
  [AssistantActionId.STAFF_MY_WORK]: {
    async plan(c) {
      const w = await c.deps.staffWork.getMyWork(c.user.id, c.salonId);
      const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
      const next = w.appointmentsToday.filter(
        (a) =>
          ['CONFIRMED', 'PENDING'].includes(a.status) &&
          new Date(a.slotEnd).getTime() > Date.now(),
      );
      const now = w.current ?? w.assigned ?? null;
      const items = [
        ...(now
          ? [
              {
                title: w.current ? 'Serving now' : 'Assigned to you',
                detail: `Token ${now.tokenNumber} · ${now.customerLabel}${now.serviceName ? ` · ${now.serviceName}` : ''}`,
              },
            ]
          : []),
        ...next.slice(0, MAX).map((a) => ({
          title: localTime(a.slotStart, tz),
          detail: `${a.customerLabel} · ${a.serviceNames.join(', ')}`,
        })),
      ];
      const eligible = w.waiting.filter((x) => x.eligible).length;
      return {
        status: 'DONE',
        message: `${w.displayName}: ${w.completedToday} done today, ${next.length} appointments left, ${eligible} in the queue you can take.`,
        result: { summary: 'My day', items },
        navigateTo: `/dashboard/salons/${c.salonId}/queue`,
      };
    },
  },

  [AssistantActionId.CANCELLATION_ANALYTICS]: {
    async plan(c, p) {
      const range = p.range === '7d' || p.range === '90d' ? p.range : '30d';
      const a = await c.deps.cancellations.getAnalytics(c.user.id, c.salonId, {
        range,
      });
      const label =
        range === '7d'
          ? 'last 7 days'
          : range === '90d'
            ? 'last 90 days'
            : 'last 30 days';
      const rate =
        a.cancellationRatePercent === null
          ? 'no bookings'
          : `${a.cancellationRatePercent}%`;
      return {
        status: 'DONE',
        message: `${label}: ${a.totalCancellations} of ${a.totalBookings} bookings cancelled (${rate}).`,
        result: {
          summary: `Cancellations, ${label}`,
          items: [
            { title: 'By customers', detail: String(a.byActor.CUSTOMER ?? 0) },
            {
              title: 'By the shop',
              detail: String((a.byActor.OWNER ?? 0) + (a.byActor.STAFF ?? 0)),
            },
            ...a.byService
              .slice(0, 3)
              .map((b) => ({ title: b.label, detail: `${b.count} cancelled` })),
            ...a.byReason.slice(0, 3).map((b) => ({
              title: `Reason: ${b.label}`,
              detail: String(b.count),
            })),
            {
              title: 'Live queue dropped',
              detail: `${a.liveQueue.cancelled} cancelled · ${a.liveQueue.noShow} no-show · ${a.liveQueue.expired} expired`,
            },
          ],
        },
        navigateTo: `/dashboard/salons/${c.salonId}/cancellations`,
      };
    },
  },

  [AssistantActionId.MY_CREDITS]: {
    async plan(c) {
      const b = await c.deps.credits.getBalance(c.user.id);
      return {
        status: 'DONE',
        message:
          b.balance > 0
            ? `You have ${b.balance} FastQue credits.`
            : 'You have no FastQue credits right now.',
        result: {
          summary: 'My credits',
          items: [{ title: 'Balance', detail: String(b.balance) }],
        },
        navigateTo: '/account/credits',
      };
    },
  },
};
