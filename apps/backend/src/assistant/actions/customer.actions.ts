import {
  AssistantActionId,
  BookingSource,
  BookingStatus,
  type BookingDetailDto,
} from '@barbercue/shared';
import {
  utcToZonedDateStr,
  zonedDateToDayOfWeek,
  zonedWallTimeToUtc,
} from '../../common/timezone/timezone';
import { matchByName } from '../assistant-parser';
import { resolveDay, type DaySpec } from '../assistant-when';
import { localTime, prettyDate } from './shop-ops.actions';
import {
  Reply,
  rupees,
  staleReply,
  type ExecCtx,
  type HandlerMap,
  type PlanCtx,
  text,
} from './kit';

/**
 * Customer self-service: find salons, book, see/cancel/reschedule my appointments, my queue place.
 * Everything runs as the signed-in customer through BookingsService/QueueService, which only ever see
 * that customer's own bookings and queue entries.
 */

const ACTIVE: string[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.PENDING_PAYMENT,
];
const MY_BOOKINGS_PAGE = '/account/bookings';

async function upcoming(
  c: Pick<PlanCtx, 'user' | 'deps'>,
): Promise<BookingDetailDto[]> {
  const page = await c.deps.bookings.listMine(c.user.id, undefined, 30);
  const now = Date.now();
  return page.items
    .filter(
      (b) => ACTIVE.includes(b.status) && new Date(b.slotStart).getTime() > now,
    )
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart));
}

const tzOf = (b: BookingDetailDto) => b.salonTimezone ?? 'Asia/Kolkata';
const label = (b: BookingDetailDto) =>
  `${b.serviceName} · ${b.salonName} · ${prettyDate(utcToZonedDateStr(new Date(b.slotStart), tzOf(b)))} ${localTime(b.slotStart, tzOf(b))}`;

function chooseMine(
  c: PlanCtx,
  rows: BookingDetailDto[],
  verb: string,
): BookingDetailDto {
  if (!rows.length)
    throw new Reply({
      status: 'DONE',
      message: 'You have no upcoming appointments. Nothing was changed.',
      navigateTo: MY_BOOKINGS_PAGE,
    });
  if (rows.length === 1) return rows[0];
  const hits = matchByName(
    c.text,
    rows,
    (b) => `${b.serviceName} ${b.salonName}`,
  );
  if (hits.length === 1) return hits[0];
  throw new Reply({
    status: 'NEEDS_INPUT',
    message: 'Which appointment?',
    options: (hits.length ? hits : rows).slice(0, 6).map((b) => ({
      label: label(b),
      text: `${verb} my ${b.serviceName} appointment at ${b.salonName}`,
    })),
  });
}

/** Exact requested slot if free, otherwise NEEDS_INPUT with the nearest free times as options. */
async function freeSlot(
  c: Pick<PlanCtx, 'deps'>,
  salonId: string,
  serviceIds: string[],
  date: string,
  time: string,
  tz: string,
  optionText: (t: string) => string,
): Promise<string> {
  const slots = await c.deps.availability.getAvailability(
    salonId,
    serviceIds,
    date,
  );
  const wanted = zonedWallTimeToUtc(date, time, tz);
  const free = slots.filter(
    (s) => s.available && new Date(s.slotStart).getTime() > Date.now(),
  );
  const exact =
    wanted &&
    free.find((s) => new Date(s.slotStart).getTime() === wanted.getTime());
  if (exact) return exact.slotStart;
  const near = free
    .map((s) => ({
      s,
      d: Math.abs(new Date(s.slotStart).getTime() - (wanted?.getTime() ?? 0)),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)
    .map((x) => localTime(x.s.slotStart, tz))
    .sort();
  throw new Reply({
    status: 'NEEDS_INPUT',
    message: near.length
      ? `${time} on ${prettyDate(date)} is not free. Pick a time:`
      : `There are no free times on ${prettyDate(date)}. Try another day.`,
    options: near.map((t) => ({ label: t, text: optionText(t) })),
  });
}

async function myBookingNow(c: ExecCtx, id: string): Promise<BookingDetailDto> {
  const row = (
    await c.deps.bookings.listMine(c.user.id, undefined, 30)
  ).items.find((b) => b.id === id);
  if (!row) throw staleReply();
  c.assertUnchanged({
    id: row.id,
    status: row.status,
    slotStart: row.slotStart,
  });
  return row;
}

export const CUSTOMER_HANDLERS: HandlerMap = {
  [AssistantActionId.SALON_SEARCH]: {
    async plan(c, p) {
      const serviceQuery = p.serviceQuery as string | null;
      if (!serviceQuery)
        return {
          status: 'NEEDS_INPUT',
          message:
            'Which service are you looking for? For example "haircut salon dhoondo".',
        };
      const today = utcToZonedDateStr(new Date(), 'Asia/Kolkata');
      const r = await c.deps.search.search({
        serviceQuery,
        date: today,
        ...(p.city ? { city: text(p.city) } : {}),
      } as never);
      return {
        status: 'DONE',
        message: r.candidates.length
          ? `${r.candidates.length} matching salons.`
          : 'No matching salons found.',
        result: {
          summary: `Salons offering “${serviceQuery}”`,
          items: r.candidates.slice(0, 10).map((x) => ({
            id: x.salon.id,
            title: x.salon.name,
            detail: `${x.service.name} · ${rupees(x.service.price)}${x.salon.distanceKm !== null ? ` · ${x.salon.distanceKm} km` : ''}`,
          })),
        },
        navigateTo: '/search',
      };
    },
  },

  [AssistantActionId.MY_BOOKINGS]: {
    async plan(c) {
      const rows = await upcoming(c);
      return {
        status: 'DONE',
        message: rows.length
          ? `You have ${rows.length} upcoming appointment${rows.length === 1 ? '' : 's'}.`
          : 'You have no upcoming appointments.',
        result: {
          summary: 'Upcoming appointments',
          items: rows.map((b) => ({
            id: b.id,
            title: label(b),
            detail: b.status === 'CONFIRMED' ? 'Confirmed' : 'Awaiting payment',
          })),
        },
        navigateTo: MY_BOOKINGS_PAGE,
      };
    },
  },

  [AssistantActionId.MY_BOOKING_CANCEL]: {
    async plan(c) {
      const b = chooseMine(c, await upcoming(c), 'cancel');
      return c.seal(
        { bookingId: b.id },
        { id: b.id, status: b.status, slotStart: b.slotStart },
        [{ label: label(b), before: 'Confirmed', after: 'Cancelled' }],
        'The salon’s cancellation policy applies. Any charge is shown after cancelling.',
      );
    },
    async execute(c) {
      const row = await myBookingNow(c, String(c.payload.bookingId));
      const r = await c.deps.bookings.cancel(c.user.id, row.id);
      return c.done(
        `Your ${row.serviceName} appointment is cancelled${r.chargeAmount > 0 ? `. A cancellation charge of ${rupees(r.chargeAmount)} applies` : ''}.`,
        'myBookings',
        row.id,
        [{ label: label(row), before: 'Confirmed', after: 'Cancelled' }],
        MY_BOOKINGS_PAGE,
      );
    },
  },

  [AssistantActionId.MY_BOOKING_RESCHEDULE]: {
    async plan(c, p) {
      const b = chooseMine(c, await upcoming(c), 'reschedule');
      const time = p.time as string | null;
      const tz = tzOf(b);
      const bookedDate = utcToZonedDateStr(new Date(b.slotStart), tz);
      const today = utcToZonedDateStr(new Date(), tz);
      const date = p.day
        ? resolveDay(p.day as DaySpec, today, zonedDateToDayOfWeek(today))
        : bookedDate;
      if (!time)
        return {
          status: 'NEEDS_INPUT',
          message: `To what time? Your ${b.serviceName} is at ${localTime(b.slotStart, tz)} on ${prettyDate(bookedDate)}.`,
        };
      const slotStart = await freeSlot(
        c,
        b.salonId,
        b.services.map((s) => s.serviceId),
        date,
        time,
        tz,
        (t) => `reschedule my ${b.serviceName} appointment ${date} ${t}`,
      );
      return c.seal(
        { bookingId: b.id, slotStart },
        { id: b.id, status: b.status, slotStart: b.slotStart },
        [
          {
            label: `${b.serviceName} · ${b.salonName}`,
            before: `${prettyDate(bookedDate)} ${localTime(b.slotStart, tz)}`,
            after: `${prettyDate(date)} ${localTime(slotStart, tz)}`,
          },
        ],
      );
    },
    async execute(c) {
      const row = await myBookingNow(c, String(c.payload.bookingId));
      const updated = await c.deps.bookings.reschedule(c.user.id, row.id, {
        slotStart: String(c.payload.slotStart),
      });
      return c.done(
        `Your ${row.serviceName} is now at ${localTime(updated.slotStart, tzOf(updated))}.`,
        'myBookings',
        row.id,
        [
          {
            label: row.serviceName,
            before: localTime(row.slotStart, tzOf(row)),
            after: localTime(updated.slotStart, tzOf(updated)),
          },
        ],
        MY_BOOKINGS_PAGE,
      );
    },
  },

  [AssistantActionId.MY_QUEUE_STATUS]: {
    async plan(c) {
      const e = await c.deps.queue.getActiveForCustomer(c.user.id);
      if (!e)
        return {
          status: 'DONE',
          message: 'You are not in any queue right now.',
        };
      return {
        status: 'DONE',
        message:
          e.position !== null
            ? `You are number ${e.position} in line (token ${e.tokenNumber})${e.estimatedWaitMinutes !== null ? `, about ${e.estimatedWaitMinutes} min` : ''}.`
            : `Token ${e.tokenNumber}: ${e.status.toLowerCase().replace('_', ' ')}.`,
        result: {
          summary: 'Your queue place',
          items: [
            {
              id: e.id,
              title: `Token ${e.tokenNumber}`,
              detail: e.serviceName ?? undefined,
            },
          ],
        },
      };
    },
  },

  [AssistantActionId.MY_QUEUE_LEAVE]: {
    async plan(c) {
      const e = await c.deps.queue.getActiveForCustomer(c.user.id);
      if (!e)
        return {
          status: 'DONE',
          message: 'You are not in any queue. Nothing was changed.',
        };
      if (e.bookingId)
        return {
          status: 'NEEDS_INPUT',
          message:
            'This queue place comes from your appointment. Say "mera appointment cancel karo" to cancel it instead.',
        };
      return c.seal(
        { entryId: e.id },
        { id: e.id, status: e.status },
        [
          {
            label: `Token ${e.tokenNumber}${e.serviceName ? ` · ${e.serviceName}` : ''}`,
            before: e.status.toLowerCase().replace('_', ' '),
            after: 'Left the queue',
          },
        ],
        'You lose your place in line.',
      );
    },
    async execute(c) {
      const e = await c.deps.queue.getActiveForCustomer(c.user.id);
      if (!e || e.id !== c.payload.entryId) throw staleReply();
      c.assertUnchanged({ id: e.id, status: e.status });
      const updated = await c.deps.queue.cancelByCustomer(c.user.id, e.id);
      return c.done(
        `You left the queue (token ${updated.tokenNumber}).`,
        'myQueue',
        updated.id,
        [
          {
            label: `Token ${updated.tokenNumber}`,
            before: e.status.toLowerCase().replace('_', ' '),
            after: 'Left the queue',
          },
        ],
      );
    },
  },

  [AssistantActionId.BOOK_APPOINTMENT]: {
    async plan(c, p) {
      if (!c.salonId)
        return {
          status: 'NEEDS_INPUT',
          message:
            'Open the salon’s page first, then tell me what to book. Or say "haircut salon dhoondo" to find one.',
          navigateTo: '/search',
        };
      await c.deps.availability.getSalonOrThrow(c.salonId);
      const services = await c.deps.prisma.service.findMany({
        where: { salonId: c.salonId, isActive: true },
        select: { id: true, name: true, price: true, durationMinutes: true },
        orderBy: { name: 'asc' },
      });
      const time = p.time as string | null;
      const svcHits = matchByName(c.text, services, (s) => s.name);
      if (svcHits.length !== 1) {
        throw new Reply({
          status: 'NEEDS_INPUT',
          message: 'Which service would you like?',
          options: (svcHits.length ? svcHits : services)
            .slice(0, 8)
            .map((s) => ({
              label: `${s.name} · ${rupees(Number(s.price))}`,
              text: `book ${s.name} appointment ${time ?? ''}`.trim(),
            })),
        });
      }
      const svc = svcHits[0];
      const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
      const today = utcToZonedDateStr(new Date(), tz);
      const date = p.day
        ? resolveDay(p.day as DaySpec, today, zonedDateToDayOfWeek(today))
        : today;
      if (!time)
        return {
          status: 'NEEDS_INPUT',
          message: `What time on ${prettyDate(date)}? For example "shaam 5 baje".`,
        };
      const slotStart = await freeSlot(
        c,
        c.salonId,
        [svc.id],
        date,
        time,
        tz,
        (t) => `book ${svc.name} appointment ${date} ${t}`,
      );
      return c.seal(
        { salonId: c.salonId, serviceId: svc.id, slotStart },
        { salonId: c.salonId, serviceId: svc.id, slotStart },
        [
          {
            label: 'Service',
            before: null,
            after: `${svc.name} · ${svc.durationMinutes} min`,
          },
          {
            label: 'When',
            before: null,
            after: `${prettyDate(date)} ${localTime(slotStart, tz)}`,
          },
          { label: 'Price', before: null, after: rupees(Number(svc.price)) },
        ],
        'Pay at the salon unless it asks for payment in advance. You can cancel from My bookings.',
      );
    },
    async execute(c) {
      const booking = await c.deps.bookings.create(
        c.user.id,
        {
          salonId: String(c.payload.salonId),
          serviceIds: [text(c.payload.serviceId)],
          slotStart: String(c.payload.slotStart),
        },
        BookingSource.WEB,
        // The sealed confirmation is single-use; its nonce makes a retried request the same booking.
        `assistant:${c.sealed.nonce}`,
      );
      return c.done(
        `Booked: ${booking.serviceName} at ${booking.salonName}, ${localTime(booking.slotStart, tzOf(booking))}.`,
        'myBookings',
        booking.id,
        [
          {
            label: booking.serviceName,
            before: null,
            after: `${prettyDate(utcToZonedDateStr(new Date(booking.slotStart), tzOf(booking)))} ${localTime(booking.slotStart, tzOf(booking))}`,
          },
        ],
        MY_BOOKINGS_PAGE,
      );
    },
  },
};
