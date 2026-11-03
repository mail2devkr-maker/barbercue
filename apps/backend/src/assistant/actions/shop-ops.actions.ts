import {
  AssistantActionId,
  BookingStatus,
  QueueEntryStatus,
  type OperatingHoursDto,
  type OwnerBookingDetailDto,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import {
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
} from '../../common/timezone/timezone';
import { matchByName } from '../assistant-parser';
import { DAY_LABEL, resolveDay, type DaySpec } from '../assistant-when';
import {
  Reply,
  maskPhone,
  staleReply,
  type ExecCtx,
  type HandlerMap,
  type PlanCtx,
  text,
} from './kit';

/** Opening hours, Live Queue operations, the appointment schedule, customers and today's figures. */

type Ctx = Pick<PlanCtx, 'user' | 'salonId' | 'deps'>;

export async function shopDate(
  c: Ctx,
  spec: DaySpec | null,
): Promise<{ tz: string; date: string }> {
  const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
  const today = utcToZonedDateStr(new Date(), tz);
  return {
    tz,
    date: spec ? resolveDay(spec, today, zonedDateToDayOfWeek(today)) : today,
  };
}

export function localTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const hoursText = (h: OperatingHoursDto) =>
  h.isClosed ? 'Closed' : `${h.openTime}–${h.closeTime}`;

// ---------------------------------------------------------------- live queue helpers

const QUEUE_RULES: Record<
  string,
  { allowed: QueueEntryStatus[]; verb: string; done: string; warning?: string }
> = {
  [AssistantActionId.QUEUE_CALL_NEXT]: {
    allowed: [QueueEntryStatus.WAITING],
    verb: 'Call',
    done: 'called',
  },
  [AssistantActionId.QUEUE_MARK_ARRIVED]: {
    allowed: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED],
    verb: 'Mark arrived',
    done: 'marked as arrived',
  },
  [AssistantActionId.QUEUE_NO_SHOW]: {
    allowed: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED],
    verb: 'Mark no-show',
    done: 'marked as a no-show',
    warning: 'They leave the queue. Any no-show rule your shop uses applies.',
  },
  [AssistantActionId.QUEUE_CANCEL]: {
    allowed: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED],
    verb: 'Cancel',
    done: 'removed from the queue',
    warning: 'They leave the queue and are told it was cancelled.',
  },
  [AssistantActionId.QUEUE_COMPLETE]: {
    allowed: [QueueEntryStatus.IN_SERVICE],
    verb: 'Complete',
    done: 'completed',
  },
};

const entryLabel = (e: QueueEntryDetailDto) =>
  `#${e.tokenNumber} ${e.customerName ?? 'Guest'}${e.serviceName ? ` · ${e.serviceName}` : ''}`;

function queueHandler(
  actionId: keyof typeof QUEUE_RULES,
): NonNullable<HandlerMap[AssistantActionId]> {
  const rule = QUEUE_RULES[actionId];
  return {
    async plan(c, p) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const candidates = q.entries.filter((e) =>
        rule.allowed.includes(e.status),
      );
      let target: QueueEntryDetailDto | undefined;
      if (actionId === AssistantActionId.QUEUE_CALL_NEXT) {
        target = candidates
          .filter((e) => e.position !== null)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
        if (!target)
          return {
            status: 'DONE',
            message: 'Nobody is waiting right now. Nothing was changed.',
            navigateTo: `/dashboard/salons/${c.salonId}/queue`,
          };
      } else {
        const token = p.token as number | null;
        target =
          token !== null
            ? candidates.find((e) => e.tokenNumber === token)
            : (() => {
                const hits = matchByName(
                  c.text,
                  candidates,
                  (e) => e.customerName ?? '',
                );
                return hits.length === 1 ? hits[0] : undefined;
              })();
        if (!target) {
          const any =
            token !== null
              ? q.entries.find((e) => e.tokenNumber === token)
              : undefined;
          throw new Reply({
            status: 'NEEDS_INPUT',
            message: any
              ? `Token ${token} is ${any.status.toLowerCase().replace('_', ' ')}, so it cannot be ${rule.done} now.`
              : candidates.length
                ? 'Which customer? Say the token number.'
                : `There is nobody in the queue who can be ${rule.done}.`,
            options: candidates.slice(0, 8).map((e) => ({
              label: entryLabel(e),
              text: `${rule.verb.toLowerCase()} token ${e.tokenNumber}`,
            })),
          });
        }
      }
      if (
        actionId === AssistantActionId.QUEUE_COMPLETE &&
        !target.activeServiceSessionId
      ) {
        return {
          status: 'NEEDS_INPUT',
          message: `Token ${target.tokenNumber} has no service in progress. Start it from the Live Queue screen first.`,
        };
      }
      return c.seal(
        {
          entryId: target.id,
          sessionId: target.activeServiceSessionId ?? null,
        },
        { id: target.id, status: target.status },
        [
          {
            label: entryLabel(target),
            before: target.status.replace('_', ' ').toLowerCase(),
            after: rule.verb,
          },
        ],
        rule.warning,
      );
    },
    async execute(c) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const row = q.entries.find((e) => e.id === c.payload.entryId);
      if (!row) throw staleReply();
      c.assertUnchanged({ id: row.id, status: row.status });
      const id = String(c.payload.entryId);
      const u = c.user.id;
      const updated =
        actionId === AssistantActionId.QUEUE_CALL_NEXT
          ? await c.deps.queue.call(u, id)
          : actionId === AssistantActionId.QUEUE_MARK_ARRIVED
            ? await c.deps.queue.markArrived(u, id)
            : actionId === AssistantActionId.QUEUE_NO_SHOW
              ? await c.deps.queue.noShow(u, id)
              : actionId === AssistantActionId.QUEUE_CANCEL
                ? await c.deps.queue.cancelByStaff(u, id)
                : await c.deps.queue.completeSession(
                    u,
                    String(c.payload.sessionId),
                  );
      return c.done(
        `Token ${row.tokenNumber} ${rule.done}.`,
        'queue',
        updated.id,
        [
          {
            label: entryLabel(row),
            before: row.status.replace('_', ' ').toLowerCase(),
            after: updated.status.replace('_', ' ').toLowerCase(),
          },
        ],
        `/dashboard/salons/${c.salonId}/queue`,
      );
    },
  };
}

// ---------------------------------------------------------------- appointments (shop side)

const ACTIVE_BOOKING: string[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PENDING_PAYMENT,
];

async function dayBookings(
  c: Ctx,
  date: string,
): Promise<OwnerBookingDetailDto[]> {
  const page = await c.deps.dashboardBookings.list(
    c.user.id,
    c.salonId,
    undefined,
    undefined,
    '50',
    undefined,
    undefined,
    date,
  );
  return page.items;
}

const bookingLabel = (b: OwnerBookingDetailDto, tz: string) =>
  `${localTime(b.slotStart, tz)} · ${b.serviceName}${b.guestName ? ` · ${b.guestName}` : ''}`;

function chooseBooking(
  c: PlanCtx,
  rows: OwnerBookingDetailDto[],
  tz: string,
  time: string | null,
  verb: string,
  date: string,
): OwnerBookingDetailDto {
  const active = rows.filter((b) => ACTIVE_BOOKING.includes(b.status));
  if (!active.length)
    throw new Reply({
      status: 'DONE',
      message: `There are no active appointments on ${prettyDate(date)}. Nothing was changed.`,
    });
  let hits = time
    ? active.filter((b) => localTime(b.slotStart, tz) === time)
    : active;
  if (hits.length > 1) {
    const named = matchByName(c.text, hits, (b) =>
      `${b.serviceName} ${b.guestName ?? ''}`.trim(),
    );
    if (named.length) hits = named;
  }
  if (hits.length === 1) return hits[0];
  throw new Reply({
    status: 'NEEDS_INPUT',
    message: hits.length
      ? 'More than one appointment matches. Which one?'
      : `No active appointment ${time ? `at ${time} ` : ''}on ${prettyDate(date)}. Which one?`,
    options: (hits.length ? hits : active).slice(0, 8).map((b) => ({
      label: bookingLabel(b, tz),
      text: `${verb} appointment ${date} ${localTime(b.slotStart, tz)}`,
    })),
  });
}

async function bookingNow(c: ExecCtx, id: string, date: string) {
  const row = (await dayBookings(c, date)).find((b) => b.id === id);
  if (!row) throw staleReply();
  c.assertUnchanged({
    id: row.id,
    status: row.status,
    slotStart: row.slotStart,
  });
  return row;
}

// ---------------------------------------------------------------- handlers

export const SHOP_OPS_HANDLERS: HandlerMap = {
  [AssistantActionId.QUEUE_STATUS]: {
    async plan(c) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const waiting = q.entries
        .filter((e) => e.position !== null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const n = q.counts;
      return {
        status: 'DONE',
        message: n
          ? `${n.waiting} waiting, ${n.inService} in service, ${n.completedToday} completed today.`
          : `${waiting.length} waiting.`,
        result: {
          summary: `${waiting.length} waiting now`,
          items: waiting.slice(0, 10).map((e) => ({
            id: e.id,
            title: `#${e.position} ${e.customerName ?? 'Guest'}`,
            detail: `Token ${e.tokenNumber}${e.serviceName ? ` · ${e.serviceName}` : ''}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/queue`,
      };
    },
  },
  [AssistantActionId.QUEUE_CALL_NEXT]: queueHandler(
    AssistantActionId.QUEUE_CALL_NEXT,
  ),
  [AssistantActionId.QUEUE_MARK_ARRIVED]: queueHandler(
    AssistantActionId.QUEUE_MARK_ARRIVED,
  ),
  [AssistantActionId.QUEUE_NO_SHOW]: queueHandler(
    AssistantActionId.QUEUE_NO_SHOW,
  ),
  [AssistantActionId.QUEUE_CANCEL]: queueHandler(
    AssistantActionId.QUEUE_CANCEL,
  ),
  [AssistantActionId.QUEUE_COMPLETE]: queueHandler(
    AssistantActionId.QUEUE_COMPLETE,
  ),

  [AssistantActionId.QUEUE_ADD_WALK_IN]: {
    async plan(c, p) {
      const name = p.name as string | null;
      if (!name)
        return {
          status: 'NEEDS_INPUT',
          message:
            'What is the customer’s name? For example "Walk-in add karo Amit".',
        };
      // Barbers may add walk-ins but not manage services, so read only the shop's active service
      // names (what the public booking page shows) rather than the owner-only services list.
      const services = await c.deps.prisma.service.findMany({
        where: { salonId: c.salonId, isActive: true },
        select: { id: true, name: true },
      });
      const svc = matchByName(c.text, services, (s) => s.name);
      const service = svc.length === 1 ? svc[0] : null;
      // Plain string removal: a service name is shop data and must never act as a pattern.
      const at = service
        ? name.toLocaleLowerCase().indexOf(service.name.toLocaleLowerCase())
        : -1;
      const customerName =
        service && at >= 0
          ? `${name.slice(0, at)} ${name.slice(at + service.name.length)}`
              .replace(/\s+/g, ' ')
              .trim() || name
          : name;
      return c.seal(
        { name: customerName, serviceId: service?.id ?? null },
        { queue: 'add' },
        [
          { label: 'Customer', before: null, after: customerName },
          {
            label: 'Service',
            before: null,
            after: service?.name ?? 'Not chosen',
          },
        ],
        p.phoneMentioned
          ? 'The phone number is not saved from here: record it on the Live Queue screen, where the customer’s consent is captured.'
          : undefined,
      );
    },
    async execute(c) {
      const created = await c.deps.queue.createOperatorEntry(
        c.user.id,
        c.salonId,
        {
          name: String(c.payload.name),
          contactConsent: false,
          ...(c.payload.serviceId
            ? { serviceId: text(c.payload.serviceId) }
            : {}),
        },
      );
      return c.done(
        `${created.customerName ?? 'Customer'} joined the queue as token ${created.tokenNumber}.`,
        'queue',
        created.id,
        [{ label: 'Token', before: null, after: String(created.tokenNumber) }],
        `/dashboard/salons/${c.salonId}/queue`,
      );
    },
  },

  [AssistantActionId.HOURS_VIEW]: {
    async plan(c) {
      const rows = await c.deps.hours.list(c.user.id, c.salonId);
      return {
        status: 'DONE',
        message: `Open ${rows.filter((r) => !r.isClosed).length} days a week.`,
        result: {
          summary: 'Opening hours',
          items: rows.map((r) => ({
            title: DAY_LABEL[r.dayOfWeek],
            detail: hoursText(r),
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/hours`,
      };
    },
  },

  [AssistantActionId.HOURS_SET]: {
    async plan(c, p) {
      const current = await c.deps.hours.list(c.user.id, c.salonId);
      const days =
        p.days === 'all' ? [0, 1, 2, 3, 4, 5, 6] : (p.days as number[]);
      const closed = p.closed === true;
      const open = p.open as string | null;
      const close = p.close as string | null;
      if (!closed && (!open || !close))
        return {
          status: 'NEEDS_INPUT',
          message:
            'Say the opening and closing time, for example "Monday 10 se 8 baje".',
        };
      if (!closed && close! <= open!) {
        return {
          status: 'NEEDS_INPUT',
          message: `Closing (${close}) must be after opening (${open}) on the same day. Overnight hours are not supported.`,
        };
      }
      const next = current.map((h) =>
        days.includes(h.dayOfWeek)
          ? closed
            ? { ...h, isClosed: true }
            : { ...h, isClosed: false, openTime: open!, closeTime: close! }
          : h,
      );
      const rows = next
        .filter((h, i) => hoursText(h) !== hoursText(current[i]))
        .map((h) => ({
          label: DAY_LABEL[h.dayOfWeek],
          before: hoursText(current.find((x) => x.dayOfWeek === h.dayOfWeek)!),
          after: hoursText(h),
        }));
      if (!rows.length)
        return {
          status: 'DONE',
          message: 'Those hours are already set. Nothing was changed.',
        };
      return c.seal(
        { days: next },
        current,
        rows,
        'Customers see the new hours immediately. Existing appointments are not moved.',
      );
    },
    async execute(c) {
      const current = await c.deps.hours.list(c.user.id, c.salonId);
      c.assertUnchanged(current);
      const updated = await c.deps.hours.set(c.user.id, c.salonId, {
        days: c.payload.days as OperatingHoursDto[],
      });
      return c.done(
        'Opening hours updated.',
        'hours',
        c.salonId,
        updated.map((h) => ({
          label: DAY_LABEL[h.dayOfWeek],
          before: null,
          after: hoursText(h),
        })),
        `/dashboard/salons/${c.salonId}/hours`,
      );
    },
  },

  [AssistantActionId.SCHEDULE_VIEW]: {
    async plan(c, p) {
      const { tz, date } = await shopDate(c, (p.day as DaySpec | null) ?? null);
      const rows = await dayBookings(c, date);
      const active = rows.filter((b) => ACTIVE_BOOKING.includes(b.status));
      return {
        status: 'DONE',
        message: `${active.length} active appointment${active.length === 1 ? '' : 's'} on ${prettyDate(date)}.`,
        result: {
          summary: prettyDate(date),
          items: rows.map((b) => ({
            id: b.id,
            title: bookingLabel(b, tz),
            detail: `${b.status.toLowerCase().replace('_', ' ')}${b.customerPhone ? ` · ${maskPhone(b.customerPhone)}` : ''}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/schedule`,
      };
    },
  },

  [AssistantActionId.BOOKING_CANCEL_BY_SHOP]: {
    async plan(c, p) {
      const { tz, date } = await shopDate(c, (p.day as DaySpec | null) ?? null);
      const target = chooseBooking(
        c,
        await dayBookings(c, date),
        tz,
        (p.time as string | null) ?? null,
        'cancel',
        date,
      );
      return c.seal(
        { bookingId: target.id, date },
        { id: target.id, status: target.status, slotStart: target.slotStart },
        [
          {
            label: `${prettyDate(date)} ${bookingLabel(target, tz)}`,
            before: 'Confirmed',
            after: 'Cancelled',
          },
        ],
        'The customer is notified. Your shop’s cancellation rules apply.',
      );
    },
    async execute(c) {
      const row = await bookingNow(
        c,
        String(c.payload.bookingId),
        String(c.payload.date),
      );
      const r = await c.deps.shopBookings.cancel(c.user, c.salonId, row.id, {});
      return c.done(
        `Appointment ${row.serviceName} cancelled.`,
        'bookings',
        r.bookingId,
        [
          {
            label: row.serviceName,
            before: 'Confirmed',
            after: String(r.status).toLowerCase(),
          },
        ],
        `/dashboard/salons/${c.salonId}/bookings`,
      );
    },
  },

  [AssistantActionId.BOOKING_RESCHEDULE_BY_SHOP]: {
    async plan(c, p) {
      const { tz, date } = await shopDate(c, (p.day as DaySpec | null) ?? null);
      const to = p.to as string | null;
      if (!to)
        return {
          status: 'NEEDS_INPUT',
          message:
            'To what time? For example "5 baje wala appointment 6 baje kar do".',
        };
      const target = chooseBooking(
        c,
        await dayBookings(c, date),
        tz,
        (p.from as string | null) ?? null,
        'reschedule',
        date,
      );
      const slot = zonedWallTimeToUtc(date, to, tz);
      if (!slot)
        return {
          status: 'FAILED',
          message: 'That time could not be understood. Nothing was changed.',
        };
      if (slot.getTime() <= Date.now())
        return {
          status: 'NEEDS_INPUT',
          message: 'That time has already passed. Choose a later time.',
        };
      return c.seal(
        { bookingId: target.id, date, slotStart: slot.toISOString() },
        { id: target.id, status: target.status, slotStart: target.slotStart },
        [
          {
            label: target.serviceName,
            before: `${prettyDate(date)} ${localTime(target.slotStart, tz)}`,
            after: `${prettyDate(date)} ${to}`,
          },
        ],
        'FastQue checks the new time is free before moving it. The customer is notified.',
      );
    },
    async execute(c) {
      const row = await bookingNow(
        c,
        String(c.payload.bookingId),
        String(c.payload.date),
      );
      await c.deps.shopBookings.reschedule(c.user, c.salonId, row.id, {
        slotStart: String(c.payload.slotStart),
      });
      const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
      return c.done(
        `${row.serviceName} moved to ${localTime(String(c.payload.slotStart), tz)}.`,
        'bookings',
        row.id,
        [
          {
            label: row.serviceName,
            before: localTime(row.slotStart, tz),
            after: localTime(String(c.payload.slotStart), tz),
          },
        ],
        `/dashboard/salons/${c.salonId}/bookings`,
      );
    },
  },

  [AssistantActionId.CUSTOMERS_FIND]: {
    async plan(c, p) {
      const page = await c.deps.dashboardCustomers.list(
        c.user.id,
        c.salonId,
        '0',
        '10',
        (p.query as string | null) ?? undefined,
      );
      return {
        status: 'DONE',
        message: page.items.length
          ? `${page.items.length} customer${page.items.length === 1 ? '' : 's'} found.`
          : 'No matching customers.',
        result: {
          summary: 'Customers',
          items: page.items.map((x) => ({
            id: x.customerId,
            title:
              maskPhone(x.phone) ??
              (x.email ? `${x.email.slice(0, 3)}•••` : 'Customer'),
            detail: `${x.completedCount} visits${x.preferredServiceName ? ` · ${x.preferredServiceName}` : ''}`,
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}/customers`,
      };
    },
  },

  [AssistantActionId.TODAY_INSIGHTS]: {
    async plan(c, p) {
      const r = await c.deps.insights.query(c.user.id, c.salonId, {
        question: p.topic === 'revenue' ? "today's revenue" : 'today summary',
      });
      return {
        status: 'DONE',
        message: r.answer,
        result: {
          summary: r.answer,
          items: r.figures.map((f) => ({
            title: String(f.metric),
            detail: text((f as { value?: unknown }).value),
          })),
        },
        navigateTo: `/dashboard/salons/${c.salonId}`,
      };
    },
  },
};
