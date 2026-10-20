import { formatMoney } from "@barbercue/shared";
import type { CustomerSegment, OwnerCustomerDirectoryItemDto, OwnerCustomerServiceHistoryItemDto } from "@barbercue/shared";

// Owner Customers directory (requirement #5), on Codex's docs/contracts/FASTQUE_CUSTOMER_CRM_DIRECTORY_V1.md (PR #265):
//   GET dashboard/salons/:salonId/customers/directory?q&segment&sort&minVisits&limit&cursor
//   GET dashboard/salons/:salonId/customers/:customerId/services?limit&cursor
//
// The server filters and sorts the whole shop, so this screen does no client-side filtering. The cursor is a signed, opaque
// string bound to the exact filters it was issued for and is only ever sent back unchanged. FastQue has no verified customer
// name, so no name is shown (the API returns displayName: null on purpose) and a visit's own label is never used as one.

export type DirectorySegment = "" | CustomerSegment;
export type DirectorySort = "lastVisit" | "totalSpent" | "visits";

export const DIRECTORY_SEGMENTS: ReadonlyArray<{ value: DirectorySegment; label: string; help: string }> = [
  { value: "", label: "All", help: "Everyone with a booking or Live Queue visit at your shop" },
  { value: "new", label: "New", help: "Exactly 1 completed visit here" },
  { value: "repeat", label: "Repeat", help: "2 to 4 completed visits here" },
  { value: "frequent", label: "Frequent", help: "5 or more completed visits here" },
];

export const DIRECTORY_SORTS: ReadonlyArray<{ value: DirectorySort; label: string }> = [
  { value: "lastVisit", label: "Most recent visit" },
  { value: "totalSpent", label: "Highest recorded spend" },
  { value: "visits", label: "Most completed visits" },
];

export const MIN_VISITS_MAX = 50_000;

export interface DirectoryFilter {
  search: string;
  segment: DirectorySegment;
  sort: DirectorySort;
  minVisits: string;
}

export const EMPTY_DIRECTORY_FILTER: DirectoryFilter = { search: "", segment: "", sort: "lastVisit", minVisits: "" };

export function isFilteringDirectory(f: DirectoryFilter): boolean {
  return f.search.trim() !== "" || f.segment !== "" || f.sort !== "lastVisit" || f.minVisits.trim() !== "";
}

/**
 * The server's `q`: 1 to 120 characters of an account id, recorded phone or email, or a visit label. A phone-like entry is
 * reduced to its digits so "98765 43210" and "+91-98765-43210" find the same stored number. Nothing is sent for fewer than
 * two characters (so one keystroke never asks for everyone) or a phone-like entry of fewer than three digits.
 */
export function directorySearchTerm(input: string): string | null {
  const text = input.trim();
  if (text.length < 2) return null;
  if (/^[\d\s()+\-.]+$/.test(text)) {
    const digits = text.replace(/\D+/g, "");
    return digits.length >= 3 ? digits.slice(0, 120) : null;
  }
  return text.slice(0, 120);
}

/** A whole number of visits from 0 to 50,000, or null when the box is empty or not such a number. */
export function parseMinVisits(input: string): number | null {
  const t = input.trim();
  if (!/^\d{1,5}$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= MIN_VISITS_MAX ? n : null;
}

export function minVisitsProblem(input: string): string | null {
  if (input.trim() === "") return null;
  return parseMinVisits(input) === null ? `Enter a whole number from 0 to ${MIN_VISITS_MAX}.` : null;
}

/** Query values for the directory (the shared list hook adds `limit` and `cursor`). Empty values are left out. */
export function directoryParams(f: DirectoryFilter): Record<string, string | undefined> {
  const min = parseMinVisits(f.minVisits);
  return {
    q: directorySearchTerm(f.search) ?? undefined,
    segment: f.segment || undefined,
    sort: f.sort === "lastVisit" ? undefined : f.sort,
    minVisits: min !== null && min > 0 ? String(min) : undefined,
  };
}

export function segmentLabel(segment: CustomerSegment | null): string | null {
  if (!segment) return null;
  return DIRECTORY_SEGMENTS.find((s) => s.value === segment)?.label ?? segment;
}

/** The contact line for a row: recorded phone and email, or an honest "no contact recorded". Never a guessed name. */
export function contactLine(item: Pick<OwnerCustomerDirectoryItemDto, "phone" | "email">): string {
  const parts = [item.phone, item.email].filter((p): p is string => typeof p === "string" && p.trim() !== "");
  return parts.length > 0 ? parts.join(" · ") : "No contact recorded";
}

export function moneyText(amount: number, currency: string | null): string {
  return formatMoney(amount, currency ?? undefined);
}

/** Counts people read at a glance: "3 completed visits". */
export function visitsText(n: number): string {
  return `${n} completed visit${n === 1 ? "" : "s"}`;
}

export function repeatText(n: number): string {
  return `${n} repeat visit${n === 1 ? "" : "s"}`;
}

/** What `totalSpent` is, in words the owner can check against their own books. */
export function spendNote(item: Pick<OwnerCustomerDirectoryItemDto, "recordedCollections" | "recordedRefunds">, currency: string | null): string {
  return `Collected ${moneyText(item.recordedCollections, currency)} less refunds ${moneyText(item.recordedRefunds, currency)}, as recorded in FastQue`;
}

/** Server messages for the codes this screen can meet; anything else is shown as the server sent it. */
export function directoryErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case "INVALID_FILTER":
      return "The list changed while you were paging, so it was reloaded from the start.";
    case "CUSTOMER_DIRECTORY_CURSOR_UNAVAILABLE":
      return "Paging more customers is not available right now. The customers already shown are unaffected.";
    case "FORBIDDEN":
    case "FORBIDDEN_ROLE":
      return "Only the shop owner can open the customer directory.";
    default:
      return message;
  }
}

export function serviceHistoryErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case "BOOKING_NOT_FOUND":
      return "This customer has no visits at your shop.";
    case "INVALID_FILTER":
      return "The list changed while you were paging. Reload the services.";
    default:
      return directoryErrorText(code, message);
  }
}

/** A booking source word for a completed service row. */
export function serviceSourceLabel(source: OwnerCustomerServiceHistoryItemDto["source"]): string {
  switch (source) {
    case "ONLINE_BOOKING":
      return "Online booking";
    case "IN_SHOP_APPOINTMENT":
      return "In-shop appointment";
    case "LIVE_QUEUE":
      return "Live Queue";
    default:
      return source;
  }
}

/** Invoiced line total, or the honest reason there is none. It is billed value, not proof of collection. */
export function serviceAmountText(item: Pick<OwnerCustomerServiceHistoryItemDto, "amount" | "currency">): string {
  return item.amount === null ? "No invoice line recorded" : `${moneyText(item.amount, item.currency)} invoiced`;
}
