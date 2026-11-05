import {
  AssistantActionId,
  BookingStatus,
  QueueEntryStatus,
} from '@barbercue/shared';
import { type HandlerMap } from './kit';
import {
  dayText,
  resolvePeriod,
  type PeriodSpec,
  type ResolvedPeriod,
} from '../assistant-period';
import type { ReportStatus } from '../assistant-parser-report';

/**
 * Period reports (owner directive, 5 Nov 2026). READS only, scoped to the authorized shop (owner or
 * delegated admin access is checked before plan runs), in the shop's own timezone. Counts come from
 * the real rows; nothing is estimated. When the period starts before the shop's first record, the
 * answer says so instead of implying that the earlier days were empty.
 */
export const REPORT_PAGE_SIZE = 10;

const STATUS_TEXT: Record<string, string> = {
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
  PENDING_PAYMENT: 'awaiting payment',
  EXPIRED: 'expired',
};
const LIVE: string[] = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.CALLED,
  QueueEntryStatus.IN_SERVICE,
];
const DROPPED: string[] = [
  QueueEntryStatus.NO_SHOW,
  QueueEntryStatus.CANCELLED,
  QueueEntryStatus.EXPIRED,
];

function timeText(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(at)
    .replace(/\s?(am|pm)$/i, (m) => m.toLowerCase());
}

async function periodFor(
  c: {
    salonId: string;
    deps: {
      availability: { resolveTimeZoneOrThrow(id: string): Promise<string> };
    };
  },
  spec: PeriodSpec,
): Promise<{ tz: string; period: ResolvedPeriod }> {
  const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
  return { tz, period: resolvePeriod(spec, tz) };
}

/** The first moment FastQue holds anything for this shop (imported history can predate the shop row). */
function earliest(...dates: Array<Date | null | undefined>): Date | null {
  const ok = dates.filter((d): d is Date => !!d);
  return ok.length ? new Date(Math.min(...ok.map((d) => d.getTime()))) : null;
}

/** A note when FastQue holds no records for part of the period (the shop joined later). */
function coverageNote(
  period: ResolvedPeriod,
  firstRecord: Date | null,
  tz: string,
): string {
  if (!firstRecord || firstRecord <= period.start) return '';
  const first = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
    firstRecord,
  );
  return ` FastQue has this shop's records only from ${dayText(first)}; earlier days in this period are not counted.`;
}

export const REPORT_HANDLERS: HandlerMap = {
  [AssistantActionId.BOOKINGS_REPORT]: {
    async plan(c, p) {
      const { tz, period } = await periodFor(c, p.period as PeriodSpec);
      const status = (p.status as ReportStatus | null) ?? null;
      const page = Math.max(1, Number(p.page) || 1);
      const inPeriod = {
        salonId: c.salonId,
        slotStart: { gte: period.start, lt: period.end },
      };
      const [byStatus, rows, salon, firstBooking] = await Promise.all([
        c.deps.prisma.booking.groupBy({
          by: ['status'],
          where: inPeriod,
          _count: { _all: true },
        }),
        c.deps.prisma.booking.findMany({
          where: {
            ...inPeriod,
            ...(status ? { status: status as BookingStatus } : {}),
          },
          orderBy: [{ slotStart: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * REPORT_PAGE_SIZE,
          take: REPORT_PAGE_SIZE,
          // No customer contact is read: the shop's own Bookings page shows the details.
          select: {
            id: true,
            slotStart: true,
            status: true,
            source: true,
            service: { select: { name: true } },
          },
        }),
        c.deps.prisma.salon.findUnique({
          where: { id: c.salonId },
          select: { createdAt: true },
        }),
        c.deps.prisma.booking.aggregate({
          where: { salonId: c.salonId },
          _min: { slotStart: true },
        }),
      ]);
      const firstRecord = earliest(
        salon?.createdAt,
        firstBooking._min.slotStart,
      );
      const counts = new Map(
        byStatus.map((r) => [r.status as string, r._count._all]),
      );
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      const matching = status ? (counts.get(status) ?? 0) : total;
      const breakdown = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${n} ${STATUS_TEXT[s] ?? s.toLowerCase()}`)
        .join(', ');
      const what = status
        ? `${STATUS_TEXT[status]} booking${matching === 1 ? '' : 's'}`
        : `booking${matching === 1 ? '' : 's'}`;
      const pages = Math.max(1, Math.ceil(matching / REPORT_PAGE_SIZE));
      const shown = rows.length
        ? ` Showing ${(page - 1) * REPORT_PAGE_SIZE + 1}–${(page - 1) * REPORT_PAGE_SIZE + rows.length} of ${matching}${page < pages ? ' (say "aur dikhao" for more)' : ''}.`
        : page > 1
          ? ' There are no more bookings in this period.'
          : '';
      const message =
        `${period.label}: ${matching} ${what}` +
        (!status && total ? ` — ${breakdown}.` : '.') +
        shown +
        coverageNote(period, firstRecord, tz);
      return {
        status: 'DONE',
        message,
        result: {
          summary: `${period.label}: ${matching} ${what}`,
          items: rows.map((b) => ({
            id: b.id,
            title: `${timeText(b.slotStart, tz)} · ${b.service.name}`,
            detail: `${STATUS_TEXT[b.status] ?? b.status.toLowerCase()} · ${b.source.toLowerCase().replace('_', ' ')}`,
          })),
        },
        options:
          page < pages
            ? [{ label: 'Show more', text: 'aur dikhao' }]
            : undefined,
        reportContext: {
          action: AssistantActionId.BOOKINGS_REPORT,
          period: p.period as PeriodSpec,
          status,
          page,
        },
      };
    },
  },

  [AssistantActionId.QUEUE_HISTORY]: {
    async plan(c, p) {
      const { tz, period } = await periodFor(c, p.period as PeriodSpec);
      const [byStatus, liveNow, salon, firstJoin] = await Promise.all([
        c.deps.prisma.queueEntry.groupBy({
          by: ['status'],
          where: {
            salonId: c.salonId,
            joinedAt: { gte: period.start, lt: period.end },
          },
          _count: { _all: true },
        }),
        c.deps.prisma.queueEntry.count({
          where: {
            salonId: c.salonId,
            status: { in: LIVE as QueueEntryStatus[] },
          },
        }),
        c.deps.prisma.salon.findUnique({
          where: { id: c.salonId },
          select: { createdAt: true },
        }),
        c.deps.prisma.queueEntry.aggregate({
          where: { salonId: c.salonId },
          _min: { joinedAt: true },
        }),
      ]);
      const firstRecord = earliest(salon?.createdAt, firstJoin._min.joinedAt);
      const n = (s: string[]) =>
        byStatus
          .filter((r) => s.includes(r.status))
          .reduce((a, r) => a + r._count._all, 0);
      const joined = byStatus.reduce((a, r) => a + r._count._all, 0);
      const served = n([QueueEntryStatus.COMPLETED]);
      const dropped = n(DROPPED);
      const stillLive = n(LIVE);
      const message =
        `${period.label}: ${joined} customer${joined === 1 ? '' : 's'} joined the queue — ${served} served, ${dropped} left or no-show` +
        (stillLive ? `, ${stillLive} still in the queue` : '') +
        `. (Right now ${liveNow} ${liveNow === 1 ? 'is' : 'are'} in the live queue; that is not part of this period's total.)` +
        coverageNote(period, firstRecord, tz);
      return {
        status: 'DONE',
        message,
        result: {
          summary: `${period.label}: ${joined} joined, ${served} served`,
          items: [
            { title: 'Joined in this period', detail: String(joined) },
            { title: 'Served', detail: String(served) },
            { title: 'Left / no-show / expired', detail: String(dropped) },
            {
              title: 'Live queue right now (separate)',
              detail: String(liveNow),
            },
          ],
        },
        reportContext: {
          action: AssistantActionId.QUEUE_HISTORY,
          period: p.period as PeriodSpec,
          page: 1,
        },
      };
    },
  },
};
