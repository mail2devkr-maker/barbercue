import {
  AssistantActionId,
  BookingStatus,
  QueueEntryStatus,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import { zonedWallTimeToUtc } from '../../common/timezone/timezone';
import { matchByName } from '../assistant-parser';
import { type DaySpec } from '../assistant-when';
import {
  chooseBooking,
  dayBookings,
  bookingLabel,
  localTime,
  prettyDate,
  shopDate,
} from './shop-ops.actions';
import {
  Reply,
  maskPhone,
  rupees,
  staleReply,
  text,
  type HandlerMap,
} from './kit';

/**
 * Batch 4 (issue #362): actions that need an explicit human choice or a stronger confirmation.
 *
 * - Seating a customer never picks the barber or chair itself: both must be named (or tapped from
 *   the offered free pairs), and the live queue decides if they are still free.
 * - An in-shop appointment saves a phone number only when the operator says the customer agreed.
 * - Correcting a no-show reverses its charge, so the preview says so plainly.
 */

const label = (e: QueueEntryDetailDto) =>
  `#${e.tokenNumber} ${e.customerName ?? 'Guest'}${e.serviceName ? ` · ${e.serviceName}` : ''}`;

export const BATCH4_HANDLERS: HandlerMap = {
  [AssistantActionId.QUEUE_ASSIGN]: {
    async plan(c, p) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const waiting = q.entries.filter(
        (e) =>
          (e.status === QueueEntryStatus.WAITING ||
            e.status === QueueEntryStatus.CALLED) &&
          !e.assignedStaffId,
      );
      const token = p.token as number | null;
      const entry =
        token !== null
          ? waiting.find((e) => e.tokenNumber === token)
          : waiting.length === 1
            ? waiting[0]
            : undefined;
      if (!entry) {
        throw new Reply({
          status: 'NEEDS_INPUT',
          message: waiting.length
            ? 'Which customer? Say the token number.'
            : 'Nobody is waiting to be seated.',
          options: waiting.slice(0, 8).map((e) => ({
            label: label(e),
            text: `token ${e.tokenNumber} assign karo`,
          })),
        });
      }
      const staff = q.staffRoster.filter(
        (s) =>
          s.status === 'ACTIVE' &&
          (!s.availabilityState || s.availabilityState === 'AVAILABLE'),
      );
      const chairs = q.chairs.filter(
        (ch) =>
          (!ch.occupancy || ch.occupancy === 'FREE') && !ch.reservedForEntryId,
      );
      const sHit = matchByName(c.text, staff, (s) => s.displayName);
      const cHit = matchByName(c.text, chairs, (ch) => ch.label);
      if (sHit.length !== 1 || cHit.length !== 1) {
        // No automatic choice: offer the currently free pairs for the operator to tap.
        const barbers = sHit.length === 1 ? sHit : staff;
        const seats = cHit.length === 1 ? cHit : chairs;
        const pairs = barbers
          .flatMap((s) => seats.map((ch) => ({ s, ch })))
          .slice(0, 8);
        throw new Reply({
          status: 'NEEDS_INPUT',
          message: pairs.length
            ? `Choose a barber and chair for token ${entry.tokenNumber}.`
            : 'No barber and chair are free together right now.',
          options: pairs.map(({ s, ch }) => ({
            label: `${s.displayName} · ${ch.label}`,
            text: `token ${entry.tokenNumber} ${s.displayName} ${ch.label} assign karo`,
          })),
        });
      }
      const [s] = sHit;
      const [ch] = cHit;
      return c.seal(
        {
          entryId: entry.id,
          staffId: s.id,
          chairId: ch.id,
          serviceId: entry.serviceId ?? null,
        },
        {
          id: entry.id,
          status: entry.status,
          assignedStaffId: entry.assignedStaffId,
        },
        [
          {
            label: label(entry),
            before: 'Waiting',
            after: 'Assigned (not started)',
          },
          { label: 'Barber', before: null, after: s.displayName },
          { label: 'Chair', before: null, after: ch.label },
        ],
        'The barber and chair are held for this customer. Start the service when they sit down.',
      );
    },
    async execute(c) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const row = q.entries.find((e) => e.id === c.payload.entryId);
      if (!row) throw staleReply();
      c.assertUnchanged({
        id: row.id,
        status: row.status,
        assignedStaffId: row.assignedStaffId,
      });
      const updated = await c.deps.queue.assign(c.user.id, row.id, {
        staffId: text(c.payload.staffId),
        chairId: text(c.payload.chairId),
        ...(c.payload.serviceId
          ? { serviceId: text(c.payload.serviceId) }
          : {}),
        startService: false,
      });
      return c.done(
        `Token ${updated.tokenNumber} assigned to ${updated.assignedStaffName ?? 'the barber'}.`,
        'queue',
        updated.id,
        [{ label: label(row), before: 'Waiting', after: 'Assigned' }],
        `/dashboard/salons/${c.salonId}/queue`,
      );
    },
  },

  [AssistantActionId.QUEUE_START]: {
    async plan(c, p) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const ready = q.entries.filter(
        (e) =>
          e.status === QueueEntryStatus.CALLED &&
          e.assignedStaffId &&
          e.assignedChairId,
      );
      const token = p.token as number | null;
      const entry =
        token !== null
          ? ready.find((e) => e.tokenNumber === token)
          : ready.length === 1
            ? ready[0]
            : undefined;
      if (!entry) {
        throw new Reply({
          status: 'NEEDS_INPUT',
          message: ready.length
            ? 'Which customer? Say the token number.'
            : 'Nobody is assigned and waiting to start. Assign a barber and chair first.',
          options: ready.slice(0, 8).map((e) => ({
            label: label(e),
            text: `token ${e.tokenNumber} start karo`,
          })),
        });
      }
      return c.seal(
        { entryId: entry.id },
        {
          id: entry.id,
          status: entry.status,
          assignedStaffId: entry.assignedStaffId,
        },
        [
          {
            label: label(entry),
            before: 'Assigned',
            after: `In service with ${entry.assignedStaffName ?? 'the barber'}`,
          },
        ],
      );
    },
    async execute(c) {
      const q = await c.deps.queue.getDashboardQueue(c.user.id, c.salonId);
      const row = q.entries.find((e) => e.id === c.payload.entryId);
      if (!row) throw staleReply();
      c.assertUnchanged({
        id: row.id,
        status: row.status,
        assignedStaffId: row.assignedStaffId,
      });
      const updated = await c.deps.queue.startService(c.user.id, row.id);
      return c.done(
        `Service started for token ${updated.tokenNumber}.`,
        'queue',
        updated.id,
        [{ label: label(row), before: 'Assigned', after: 'In service' }],
        `/dashboard/salons/${c.salonId}/queue`,
      );
    },
  },

  [AssistantActionId.BOOKING_IN_SHOP]: {
    async plan(c, p) {
      const name = p.name as string | null;
      const time = p.time as string | null;
      if (!name)
        return {
          status: 'NEEDS_INPUT',
          message:
            'Who is the appointment for? For example "Amit ke liye kal 5 baje haircut appointment book karo".',
        };
      const services = await c.deps.prisma.service.findMany({
        where: { salonId: c.salonId, isActive: true },
        select: { id: true, name: true, price: true, durationMinutes: true },
        orderBy: { name: 'asc' },
      });
      const hits = matchByName(c.text, services, (s) => s.name);
      if (hits.length !== 1) {
        throw new Reply({
          status: 'NEEDS_INPUT',
          message: `Which service for ${name}?`,
          options: (hits.length ? hits : services).slice(0, 8).map((s) => ({
            label: s.name,
            text: `${name} ke liye ${s.name} appointment book karo ${time ?? ''}`.trim(),
          })),
        });
      }
      const svc = hits[0];
      const { tz, date } = await shopDate(c, (p.day as DaySpec | null) ?? null);
      if (!time)
        return {
          status: 'NEEDS_INPUT',
          message: `What time on ${prettyDate(date)}? For example "shaam 5 baje".`,
        };
      const slot = zonedWallTimeToUtc(date, time, tz);
      if (!slot)
        return {
          status: 'FAILED',
          message: 'That time could not be understood. Nothing was changed.',
        };
      const phone = p.phone as string | null;
      const consent = p.consent === true;
      const savePhone = !!phone && consent;
      return c.seal(
        {
          guestName: name,
          serviceIds: [svc.id],
          slotStart: slot.toISOString(),
          ...(savePhone
            ? { guestPhone: phone, contactConsent: true }
            : { contactConsent: false }),
        },
        { slot: slot.toISOString() },
        [
          { label: 'Customer', before: null, after: name },
          {
            label: 'Service',
            before: null,
            after: `${svc.name} · ${rupees(Number(svc.price))}`,
          },
          { label: 'When', before: null, after: `${prettyDate(date)} ${time}` },
          {
            label: 'Mobile',
            before: null,
            after: savePhone
              ? `${maskPhone(phone)} (customer agreed)`
              : 'Not saved',
          },
        ],
        phone && !consent
          ? 'The mobile number is NOT saved because you did not say the customer agreed to be contacted. Say "customer agreed" to save it.'
          : 'FastQue checks the time is free before booking.',
      );
    },
    async execute(c) {
      const created = await c.deps.shopBookings.createInShop(
        c.user,
        c.salonId,
        c.payload as never,
        // The sealed confirmation is single-use; its nonce makes a retried request the same booking.
        `assistant:${c.sealed.nonce}`,
      );
      const tz = await c.deps.availability.resolveTimeZoneOrThrow(c.salonId);
      return c.done(
        `Appointment booked for ${text(c.payload.guestName)} at ${localTime(text(c.payload.slotStart), tz)}.`,
        'bookings',
        created.id,
        [
          {
            label: text(c.payload.guestName),
            before: null,
            after: localTime(text(c.payload.slotStart), tz),
          },
        ],
        `/dashboard/salons/${c.salonId}/bookings`,
      );
    },
  },

  [AssistantActionId.BOOKING_CORRECT_COMPLETED]: {
    async plan(c, p) {
      const { tz, date } = await shopDate(c, (p.day as DaySpec | null) ?? null);
      const rows = (await dayBookings(c, date)).filter(
        (b) => b.status === BookingStatus.NO_SHOW,
      );
      if (!rows.length)
        return {
          status: 'DONE',
          message: `No no-show appointments on ${prettyDate(date)}. Nothing was changed.`,
        };
      const time = (p.time as string | null) ?? null;
      const target = chooseBooking(
        c,
        rows.map((b) => ({ ...b, status: BookingStatus.CONFIRMED })),
        tz,
        time,
        'no show galat tha completed',
        date,
      );
      const real = rows.find((b) => b.id === target.id)!;
      return c.seal(
        { bookingId: real.id, date },
        { id: real.id, status: real.status, slotStart: real.slotStart },
        [
          {
            label: `${prettyDate(date)} ${bookingLabel(real, tz)}`,
            before: 'No-show',
            after: 'Completed',
          },
        ],
        'This removes the no-show and any no-show charge it added for this customer. Use it only if they really came.',
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
      const r = await c.deps.noShow.correctToCompleted(c.user.id, row.id);
      return c.done(
        `Corrected to completed${r.waivedLedgerEntryIds.length ? ' and the no-show charge was removed' : ''}.`,
        'bookings',
        row.id,
        [{ label: row.serviceName, before: 'No-show', after: 'Completed' }],
        `/dashboard/salons/${c.salonId}/bookings`,
      );
    },
  },
};
