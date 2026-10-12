import { DASHBOARD_PATHS, OWNER_OPS_PATHS } from '@barbercue/shared';

/**
 * Owner-operations API surface for the Android app: one place for every route and every piece of
 * display formatting, so the screens stay thin and a test can pin the routes (the same lesson the
 * Live Queue learned when un-prefixed paths silently 404'd in production).
 */

const salonBase = (salonId: string): string => `${OWNER_OPS_PATHS.dashboard}/${OWNER_OPS_PATHS.salons}/${salonId}`;

export const ownerOpsPaths = {
  overview: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.overview}`,
  cancellationAnalytics: (salonId: string, range: '7d' | '30d' | '90d', actor?: string): string => {
    const params = new URLSearchParams({ range });
    if (actor && actor !== 'ALL') params.set('actor', actor);
    return `${salonBase(salonId)}/${OWNER_OPS_PATHS.cancellationAnalytics}?${params.toString()}`;
  },
  queue: (salonId: string): string => `${salonBase(salonId)}/${DASHBOARD_PATHS.queue}`,
  queueCustomers: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.queueCustomers}`,
  queueAutoAssign: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.queueAutoAssign}`,
  queueTakeNext: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.queueTakeNext}`,
  queueSettings: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.queueSettings}`,
  entryAutoAssign: (entryId: string): string =>
    `${OWNER_OPS_PATHS.dashboard}/${OWNER_OPS_PATHS.queueEntries}/${entryId}/${OWNER_OPS_PATHS.autoAssign}`,
  inShopBooking: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.bookingsInShop}`,
  cancelBooking: (salonId: string, bookingId: string): string =>
    `${salonBase(salonId)}/${OWNER_OPS_PATHS.bookings}/${bookingId}/${OWNER_OPS_PATHS.cancel}`,
  rescheduleBooking: (salonId: string, bookingId: string): string =>
    `${salonBase(salonId)}/${OWNER_OPS_PATHS.bookings}/${bookingId}/${OWNER_OPS_PATHS.reschedule}`,
  staffMeWork: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.staffMeWork}`,
  staffAccess: (salonId: string, staffId: string, action: 'revoke' | 'restore'): string =>
    `${salonBase(salonId)}/${OWNER_OPS_PATHS.staff}/${staffId}/${OWNER_OPS_PATHS.staffAccess}/${action}`,
  billingProfile: (salonId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.billingProfile}`,
  contactVisibility: (salonId: string): string => `${salonBase(salonId)}/contact-visibility`,
  invoices: (salonId: string, params: { payment?: string; q?: string; cursor?: string | null } = {}): string => {
    const query = new URLSearchParams();
    if (params.payment && params.payment !== 'ALL') query.set('payment', params.payment);
    if (params.q) query.set('q', params.q);
    if (params.cursor) query.set('cursor', params.cursor);
    const qs = query.toString();
    return `${salonBase(salonId)}/${OWNER_OPS_PATHS.invoices}${qs ? `?${qs}` : ''}`;
  },
  invoice: (salonId: string, invoiceId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.invoices}/${invoiceId}`,
  invoiceBySource: (salonId: string, source: { bookingId?: string; queueEntryId?: string }): string => {
    const query = new URLSearchParams();
    if (source.bookingId) query.set('bookingId', source.bookingId);
    if (source.queueEntryId) query.set('queueEntryId', source.queueEntryId);
    return `${salonBase(salonId)}/${OWNER_OPS_PATHS.invoices}/by-source?${query.toString()}`;
  },
  invoicePayments: (salonId: string, invoiceId: string): string =>
    `${salonBase(salonId)}/${OWNER_OPS_PATHS.invoices}/${invoiceId}/${OWNER_OPS_PATHS.payments}`,
  myInvoices: (cursor?: string | null): string => `${OWNER_OPS_PATHS.customerInvoices}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  myInvoice: (invoiceId: string): string => `${OWNER_OPS_PATHS.customerInvoices}/${invoiceId}`,
  booking: (salonId: string, bookingId: string): string => `${salonBase(salonId)}/${OWNER_OPS_PATHS.bookings}/${bookingId}`,
} as const;

// ---------- Display formatting ----------

/** Indian digit grouping (12,34,567) without depending on Intl being present on the device. */
function groupIndian(integerPart: string): string {
  if (integerPart.length <= 3) return integerPart;
  const last3 = integerPart.slice(-3);
  const rest = integerPart.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** ₹ with Indian grouping for INR; an ISO code (never a guessed symbol) for any other currency. */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const code = currency ?? 'INR';
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const hasFraction = !Number.isInteger(abs);
  const [whole, fraction = ''] = (hasFraction ? abs.toFixed(2) : String(abs)).split('.');
  const grouped = code === 'INR' ? groupIndian(whole) : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${grouped}${fraction ? `.${fraction}` : ''}`;
  const text = code === 'INR' ? `₹${body}` : `${code} ${body}`;
  return negative ? `-${text}` : text;
}

/** Never a fabricated percentage: with nothing earlier to compare with the text says so. */
export function formatChange(changePercent: number | null): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (changePercent === null) return { text: 'No earlier data', tone: 'flat' };
  if (changePercent === 0) return { text: 'No change', tone: 'flat' };
  return { text: `${changePercent > 0 ? '+' : ''}${changePercent}%`, tone: changePercent > 0 ? 'up' : 'down' };
}

/** Time of day in the shop's own timezone, e.g. "4:30 pm" (falls back to the device zone). */
export function formatShopTime(iso: string, timeZone: string | null | undefined): string {
  try {
    return new Date(iso)
      .toLocaleTimeString('en-IN', { timeZone: timeZone ?? undefined, hour: 'numeric', minute: '2-digit', hour12: true })
      .toLowerCase();
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

export function formatShopDate(iso: string, timeZone: string | null | undefined): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { timeZone: timeZone ?? undefined, day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Short staff/customer initials that never expose an e-mail address. */
export function initialsOf(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '?';
  if (text.includes('@')) return text.split('@')[0].replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?';
  const words = text.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : text.slice(0, 2)).toUpperCase() || '?';
}

/** The plain-English label for each recorded cancellation actor. */
export const CANCELLATION_ACTOR_LABEL: Record<string, string> = {
  CUSTOMER: 'Customer',
  OWNER: 'Owner',
  STAFF: 'Barber',
  SYSTEM: 'Automatic',
  ADMIN: 'FastQue support',
  UNKNOWN: 'Not recorded',
};

/** One honest sentence about whether the customer was told about a shop cancellation. */
export function describeCancellationNotice(result: {
  notification: { inApp: string; push: string };
}): string {
  const { inApp, push } = result.notification;
  if (inApp === 'NO_ACCOUNT') return 'This appointment was made for a customer without a FastQue account, so no app notification was sent.';
  const inAppSent = inApp === 'SENT';
  const pushSent = push === 'SENT';
  if (inAppSent && pushSent) return 'The customer was notified in the app and by push notification.';
  if (inAppSent && push === 'NO_DEVICE') return 'The customer was notified in the app. They have no device registered for push notifications.';
  if (inAppSent) return 'The customer was notified in the app. The push notification will be retried automatically.';
  return 'The appointment is cancelled. The customer notification is queued and will be retried automatically.';
}
