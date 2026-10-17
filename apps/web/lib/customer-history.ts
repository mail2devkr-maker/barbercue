import type { OwnerCustomerHistoryEntryDto, OwnerCustomerHistoryInvoiceDto } from "@barbercue/shared";

// Owner customer visit history (requirement #5), on Codex PR #235:
//   GET dashboard/salons/:salonId/customers/:customerId/history?cursor&limit&source&status&from&to
//
// One list of an account's visits at THIS shop: online bookings, in-shop appointments and Live Queue visits, newest
// first, each with the invoices and the payments the shop recorded. The server does not merge guests by name or phone,
// and the account has no verified name, so the page shows contact details and each visit's own recorded label (never a
// guessed name). Money arrives as decimal strings; this file reads them as exact cents and never uses floating point
// for arithmetic.

export type HistorySource = OwnerCustomerHistoryEntryDto["source"];

export const HISTORY_SOURCES: ReadonlyArray<{ value: HistorySource; label: string }> = [
  { value: "ONLINE_BOOKING", label: "Online booking" },
  { value: "IN_SHOP_APPOINTMENT", label: "In-shop appointment" },
  { value: "LIVE_QUEUE", label: "Live Queue" },
];

export const HISTORY_STATUSES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "PENDING_PAYMENT", label: "Awaiting payment" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "WAITING", label: "Waiting" },
  { value: "CALLED", label: "Called" },
  { value: "IN_SERVICE", label: "In service" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
  { value: "NO_SHOW", label: "No-show" },
];

/** Words for a source or status; a value this screen does not know yet is shown as sent, never hidden. */
export function sourceLabel(source: string): string {
  return HISTORY_SOURCES.find((s) => s.value === source)?.label ?? source;
}

export function statusLabel(status: string): string {
  return HISTORY_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export const MAX_HISTORY_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return Math.round(ms / 86_400_000);
}

/** The server's own rules for the optional date range (real days, start not after end, at most 366 days). */
export function validateHistoryRange(from: string, to: string): string | null {
  const a = from ? dayNumber(from) : null;
  const b = to ? dayNumber(to) : null;
  if ((from && a === null) || (to && b === null)) return "Enter real dates.";
  if (a !== null && b !== null) {
    if (a > b) return "The start date must be on or before the end date.";
    if (b - a + 1 > MAX_HISTORY_DAYS) return `Choose a range of at most ${MAX_HISTORY_DAYS} days.`;
  }
  return null;
}

export interface HistoryFilter {
  source: string;
  status: string;
  from: string;
  to: string;
}

export const EMPTY_FILTER: HistoryFilter = { source: "", status: "", from: "", to: "" };

export function isFiltering(filter: HistoryFilter): boolean {
  return Boolean(filter.source || filter.status || filter.from || filter.to);
}

/** Query string for one page. Empty filters are left out; the cursor is only valid for the same filters. */
export function historyQueryString(filter: HistoryFilter, cursor: string | null, limit = 20): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filter.source) params.set("source", filter.source);
  if (filter.status) params.set("status", filter.status);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/** What a visit was for: the services, or a plain word when the record names none. */
export function visitTitle(entry: Pick<OwnerCustomerHistoryEntryDto, "serviceNames">): string {
  return entry.serviceNames.length > 0 ? entry.serviceNames.join(", ") : "Visit";
}

/** Exact cents from a decimal string such as "1250.50". Anything else is null, so a bad value is never shown as money. */
export function toCents(amount: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] ? -cents : cents;
}

export interface InvoiceRecordedTotals {
  /** Payments minus refunds the shop recorded against this invoice, in cents; null if any amount could not be read. */
  netCents: number | null;
  totalCents: number | null;
  discountCents: number | null;
}

export function invoiceTotals(invoice: Pick<OwnerCustomerHistoryInvoiceDto, "total" | "discountTotal" | "payments">): InvoiceRecordedTotals {
  let net = 0;
  let readable = true;
  for (const payment of invoice.payments) {
    const cents = toCents(payment.amount);
    if (cents === null) {
      readable = false;
      continue;
    }
    net += payment.kind === "REFUND" ? -cents : cents;
  }
  return { netCents: readable ? net : null, totalCents: toCents(invoice.total), discountCents: toCents(invoice.discountTotal) };
}

/** "₹1,250" style text for exact cents in the invoice's own currency; "—" when the amount could not be read. */
export function formatCents(cents: number | null, currency: string): string {
  if (cents === null) return "—";
  const value = cents / 100;
  const text = value.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
  return currency === "INR" ? `₹${text}` : `${currency} ${text}`;
}

export function methodLabel(method: string): string {
  return ({ CASH: "Cash", UPI: "UPI", CARD: "Card", OTHER: "Other" } as Record<string, string>)[method] ?? method;
}

/** Date and time on the shop's own calendar, or the raw instant if the zone is not usable. */
export function formatVisitTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  } catch {
    return iso;
  }
}
