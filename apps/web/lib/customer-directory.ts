import type { OwnerCustomerSummaryDto, PaginatedResult } from "@barbercue/shared";

// Owner Customers tab: search, segment filters, sorting and capped paging over the customers the shop already has
// (requirement #5). Everything is computed from the rows the server returned for THIS shop; nothing leaves the page
// and no other shop's data is involved. The server does not search or filter yet (contract PR #220: `q`, `status`),
// so this works on the loaded rows and says plainly how many are loaded. It does not invent a customer name or a
// total-spend figure: the API has neither today.

export type CustomerSegmentFilter = "all" | "new" | "repeat" | "frequent" | "dues";
export type CustomerSort = "lastVisit" | "mostVisits" | "firstVisit";

export const SEGMENT_FILTERS: ReadonlyArray<{ id: CustomerSegmentFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "repeat", label: "Repeat" },
  { id: "frequent", label: "Frequent" },
  { id: "dues", label: "Has dues" },
];

export const SORT_OPTIONS: ReadonlyArray<{ id: CustomerSort; label: string }> = [
  { id: "lastVisit", label: "Most recent visit" },
  { id: "mostVisits", label: "Most completed visits" },
  { id: "firstVisit", label: "Longest-standing customers" },
];

type Row = Pick<
  OwnerCustomerSummaryDto,
  "customerId" | "phone" | "email" | "completedCount" | "firstVisitAt" | "lastVisitAt" | "preferredServiceName" | "preferredStaffName" | "segment" | "outstandingTotalAmount"
>;

/** Completed visits after the first one. 0 for a customer with no completed visit or only one. */
export function repeatVisits(c: Pick<OwnerCustomerSummaryDto, "completedCount">): number {
  return Math.max(c.completedCount - 1, 0);
}

function digits(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Case-insensitive search over the contact and the habits the shop already sees. Phone numbers match on digits
 * only, so "98765 43210", "+91-98765-43210" and "9876543210" all find the same customer, and a typed fragment of
 * at least 3 digits matches anywhere in the number. Text fragments match email, usual service and usual barber.
 */
export function matchesSearch(c: Row, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const typedDigits = digits(needle);
  if (typedDigits.length >= 3 && c.phone && digits(c.phone).includes(typedDigits)) return true;
  return [c.email, c.preferredServiceName, c.preferredStaffName, c.phone].some((v) => (v ?? "").toLowerCase().includes(needle));
}

export function matchesSegment(c: Row, segment: CustomerSegmentFilter): boolean {
  if (segment === "all") return true;
  if (segment === "dues") return c.outstandingTotalAmount > 0;
  return c.segment === segment;
}

export function filterCustomers<T extends Row>(rows: ReadonlyArray<T>, filter: { search: string; segment: CustomerSegmentFilter }): T[] {
  return rows.filter((c) => matchesSegment(c, filter.segment) && matchesSearch(c, filter.search));
}

/** Rows per segment among the rows that match the SEARCH (so a chip's count is what clicking it would show). */
export function segmentCounts<T extends Row>(rows: ReadonlyArray<T>, search: string): Record<CustomerSegmentFilter, number> {
  const base = rows.filter((c) => matchesSearch(c, search));
  return {
    all: base.length,
    new: base.filter((c) => c.segment === "new").length,
    repeat: base.filter((c) => c.segment === "repeat").length,
    frequent: base.filter((c) => c.segment === "frequent").length,
    dues: base.filter((c) => c.outstandingTotalAmount > 0).length,
  };
}

function time(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Stable sort; customers without the sorted date go last; ties keep the server's order. */
export function sortCustomers<T extends Row>(rows: ReadonlyArray<T>, sort: CustomerSort): T[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    let result = 0;
    if (sort === "mostVisits") {
      result = b.row.completedCount - a.row.completedCount;
    } else {
      const ta = time(sort === "lastVisit" ? a.row.lastVisitAt : a.row.firstVisitAt);
      const tb = time(sort === "lastVisit" ? b.row.lastVisitAt : b.row.firstVisitAt);
      if (ta === null && tb === null) result = 0;
      else if (ta === null) result = 1;
      else if (tb === null) result = -1;
      else result = sort === "lastVisit" ? tb - ta : ta - tb;
    }
    return result || a.index - b.index;
  });
  return indexed.map((x) => x.row);
}

export const CUSTOMER_PAGE_SIZE = 50; // the server's maximum
export const CUSTOMER_PAGES_PER_LOAD = 20; // up to 1,000 customers per load

export interface CustomerLoad<T> {
  items: T[];
  /** Offset cursor for the next batch, or null when every customer has been loaded. */
  nextCursor: string | null;
}

/**
 * Loads customers page by page (offset cursor) up to `maxPages`. A failure on the first page is thrown. A failure
 * on a later page keeps what was loaded and leaves `nextCursor` at the page that failed, so the owner can retry
 * from there instead of seeing a silently shorter list.
 */
export async function loadCustomerPages<T extends Row>(
  fetchPage: (cursor: string | undefined) => Promise<PaginatedResult<T>>,
  startCursor: string | undefined = undefined,
  maxPages: number = CUSTOMER_PAGES_PER_LOAD,
): Promise<CustomerLoad<T>> {
  const first = await fetchPage(startCursor);
  const items = [...first.items];
  let cursor = first.nextCursor;
  let pages = 1;
  while (cursor && pages < maxPages) {
    try {
      const next = await fetchPage(cursor);
      items.push(...next.items);
      cursor = next.nextCursor;
      pages += 1;
    } catch {
      return { items, nextCursor: cursor };
    }
  }
  return { items, nextCursor: cursor };
}
