import type { NotificationType, PushNotificationData } from '@barbercue/shared';

export interface PushContent {
  title: string;
  body: string;
  data: PushNotificationData;
}

function text(
  payload: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalText(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function formatSalonLocalSlot(
  iso: string | undefined,
  timezone: string | undefined,
): string | null {
  if (!iso || !timezone) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return null;
  }
}

function screenFor(type: NotificationType): PushNotificationData['screen'] {
  if (type.startsWith('owner.booking')) return 'OWNER_BOOKINGS';
  if (type === 'owner.walk_in.joined') return 'OWNER_QUEUE';
  if (type.startsWith('staff.booking')) return 'STAFF_TODAY';
  if (type === 'staff.assigned') return 'STAFF_TODAY';
  if (type === 'queue.turn_approaching') return 'CUSTOMER_QUEUE';
  return 'CUSTOMER_BOOKING';
}

function formatPrice(amount: number, currency: string | undefined): string {
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function buildPushContent(
  type: NotificationType,
  payloadValue: unknown,
): PushContent {
  const payload =
    payloadValue && typeof payloadValue === 'object'
      ? (payloadValue as Record<string, unknown>)
      : {};
  const service = text(payload, 'serviceName', 'Appointment');
  const salon = text(payload, 'salonName', 'your shop');
  const timezone = optionalText(payload, 'salonTimezone');
  const slotStart = optionalText(payload, 'slotStart');
  const slot = formatSalonLocalSlot(slotStart, timezone);
  const duration =
    typeof payload.durationMinutes === 'number'
      ? `${payload.durationMinutes} min`
      : null;
  const customer = optionalText(payload, 'customerDisplayName');
  const staff = optionalText(payload, 'staffDisplayName');
  const price =
    typeof payload.servicePrice === 'number'
      ? formatPrice(payload.servicePrice, optionalText(payload, 'currency'))
      : null;
  const data: PushNotificationData = {
    type,
    screen: screenFor(type),
    ...(optionalText(payload, 'bookingId')
      ? { bookingId: optionalText(payload, 'bookingId') }
      : {}),
    ...(optionalText(payload, 'salonId')
      ? { salonId: optionalText(payload, 'salonId') }
      : {}),
    ...(optionalText(payload, 'queueEntryId')
      ? { queueEntryId: optionalText(payload, 'queueEntryId') }
      : {}),
    ...(slotStart ? { slotStart } : {}),
    ...(timezone ? { salonTimezone: timezone } : {}),
  };

  switch (type) {
    case 'booking.confirmed':
      return {
        title: 'Booking confirmed',
        body: `${service} at ${salon}${slot ? ` · ${slot}` : ''}`,
        data,
      };
    case 'booking.rescheduled':
      return {
        title: 'Booking rescheduled',
        body: `${service} is now ${slot ?? 'at its new time'}`,
        data,
      };
    case 'booking.cancelled':
      return {
        title: 'Booking cancelled',
        body: `Your ${service} booking at ${salon} was cancelled.`,
        data,
      };
    case 'booking.reminder':
      return {
        title: 'Upcoming appointment',
        body: `${service} at ${salon} in about 1 hour.`,
        data,
      };
    case 'queue.turn_approaching': {
      const ahead =
        typeof payload.peopleAhead === 'number' ? payload.peopleAhead : null;
      return {
        title: 'Your turn is approaching',
        body: `${ahead === null ? 'Please head' : `${ahead} customer${ahead === 1 ? '' : 's'} ahead · please head`} to ${salon}.`,
        data,
      };
    }
    case 'owner.booking.created':
      return {
        title: 'New booking',
        body: [
          service,
          customer ? `Customer: ${customer}` : null,
          staff ? `Barber: ${staff}` : null,
          slot,
          duration,
          price,
        ]
          .filter(Boolean)
          .join(' · '),
        data,
      };
    case 'owner.booking.rescheduled':
      return {
        title: 'Booking rescheduled',
        body: `${service}${slot ? ` · ${slot}` : ''}`,
        data,
      };
    case 'owner.booking.cancelled':
      return {
        title: 'Booking cancelled',
        body: `${service}${slot ? ` · ${slot}` : ''}`,
        data,
      };
    case 'owner.walk_in.joined':
      return {
        title: 'New walk-in',
        body: `${service} joined the live queue.`,
        data,
      };
    case 'staff.assigned':
      return {
        title: 'Queue assignment',
        body: `${service} is ready in your queue.`,
        data,
      };
    case 'staff.booking.created':
      return {
        title: 'New appointment',
        body: [service, slot, duration].filter(Boolean).join(' · '),
        data,
      };
    case 'staff.booking.rescheduled':
      return {
        title: 'Appointment rescheduled',
        body: [service, slot, duration].filter(Boolean).join(' · '),
        data,
      };
    case 'staff.booking.cancelled':
      return {
        title: 'Appointment cancelled',
        body: [service, slot].filter(Boolean).join(' · '),
        data,
      };
  }
}
