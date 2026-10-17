// Demo Workspace (requirements #22 and #23, owner decision D3), on Codex PR #252 (docs/owner-operations/demo-workspace-api.md).
// Sample data lives in a private workspace that is separate from the shop's real records: it never mixes with real
// customers, bookings, revenue or reports, and it is never public. Every response is still read defensively.
//
//   GET    dashboard/salons/:id/demo/status
//   POST   dashboard/salons/:id/demo/import           (Idempotency-Key, a UUID)
//   POST   dashboard/salons/:id/demo/delete-preview   -> a five-minute confirmation token bound to this owner and workspace
//   DELETE dashboard/salons/:id/demo                  {workspaceId, confirmation: "DELETE DEMO DATA", confirmationToken}
//   GET    dashboard/salons/:id/demo/workspaces/:workspaceId   -> the synthetic dataset (amounts are simulated projections)

export const DELETE_CONFIRMATION = "DELETE DEMO DATA";
export const DEFAULT_DEMO_LABEL = "DEMO DATA — Not real business records";

export interface DemoCounts {
  customers: number;
  staff: number;
  chairs: number;
  services: number;
  visits: number;
  bookings: number;
  invoices: number;
  reviews: number;
}

export interface DemoStatus {
  active: boolean;
  workspaceId: string | null;
  /** The server's own label, shown verbatim wherever demo data appears. */
  label: string;
  counts: Partial<DemoCounts> | null;
}

export interface DeletePreview {
  confirmationToken: string;
  expiresAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const COUNT_KEYS: ReadonlyArray<keyof DemoCounts> = ["customers", "staff", "chairs", "services", "visits", "bookings", "invoices", "reviews"];

function parseCounts(raw: unknown): Partial<DemoCounts> | null {
  if (!isRecord(raw)) return null;
  const counts: Partial<DemoCounts> = {};
  for (const key of COUNT_KEYS) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) counts[key] = value;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

/**
 * Reads a status or import response. `active` is true only when the server says exactly `true` AND names the
 * workspace; anything else is treated as "no demo data", so the screen can never show a workspace it cannot delete.
 */
export function parseDemoStatus(raw: unknown): DemoStatus {
  if (!isRecord(raw)) return { active: false, workspaceId: null, label: DEFAULT_DEMO_LABEL, counts: null };
  const workspaceId = typeof raw.workspaceId === "string" && raw.workspaceId ? raw.workspaceId : null;
  return {
    active: raw.active === true && workspaceId !== null,
    workspaceId,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label : DEFAULT_DEMO_LABEL,
    counts: parseCounts(raw.counts),
  };
}

/** The confirmation token is required; without one the delete cannot be authorised, so the preview is rejected. */
export function parseDeletePreview(raw: unknown): DeletePreview | null {
  if (!isRecord(raw)) return null;
  const token = raw.confirmationToken;
  if (typeof token !== "string" || !token) return null;
  return { confirmationToken: token, expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : null };
}

/** The owner must type the phrase exactly (surrounding spaces ignored). */
export function confirmationMatches(input: string): boolean {
  return input.trim() === DELETE_CONFIRMATION;
}

export function deleteBody(workspaceId: string, confirmationToken: string): { workspaceId: string; confirmation: string; confirmationToken: string } {
  return { workspaceId, confirmation: DELETE_CONFIRMATION, confirmationToken };
}

export const COUNT_LABELS: Record<keyof DemoCounts, string> = {
  customers: "Customers",
  staff: "Staff",
  chairs: "Chairs",
  services: "Services",
  visits: "Visits",
  bookings: "Bookings",
  invoices: "Invoices",
  reviews: "Reviews",
};

/** Only the counts the server reported, in a fixed order. */
export function countRows(counts: Partial<DemoCounts> | null): Array<{ key: keyof DemoCounts; label: string; value: number }> {
  if (!counts) return [];
  return COUNT_KEYS.filter((key) => typeof counts[key] === "number").map((key) => ({ key, label: COUNT_LABELS[key], value: counts[key] as number }));
}

/** True once the preview's expiry has passed, so the owner is asked to start again instead of sending a dead token. */
export function previewExpired(preview: DeletePreview, now: Date = new Date()): boolean {
  if (!preview.expiresAt) return false;
  const at = Date.parse(preview.expiresAt);
  return Number.isFinite(at) && at <= now.getTime();
}

// ---------- reading the demo dataset ----------

export const DEMO_BANNER = "DEMO DATA — NOT REAL BUSINESS RECORDS";
export const SIMULATED_NOTE = "Every amount here is a simulated projection. It is not recorded revenue, not a payment and not money collected.";

export interface MoneyPoint {
  label: string;
  estimated: number;
  collection: number;
}

export interface MoneyBreakdown {
  id: string;
  completedVisits: number;
  estimatedValueMinor: number;
  collectionProjectionMinor: number;
}

export interface DemoView {
  workspaceId: string;
  label: string;
  currency: string;
  timezone: string;
  generatedAt: string | null;
  counts: Partial<DemoCounts> | null;
  customers: Array<{ id: string; name: string; email: string; firstVisitAt: string; lastVisitAt: string; visitCount: number }>;
  staff: Array<{ id: string; name: string; role: string }>;
  chairs: Array<{ id: string; label: string; status: string }>;
  services: Array<{ id: string; name: string; category: string; durationMinutes: number; listPriceMinor: number }>;
  visits: Array<{ id: string; status: string; customerName: string; serviceId: string; staffId: string | null; joinedAt: string; completedAt: string | null; estimatedValueMinor: number; simulatedCollectionMinor: number }>;
  bookings: Array<{ id: string; source: string; status: string; customerId: string; serviceIds: string[]; slotStart: string }>;
  invoices: Array<{ id: string; status: string; totalMinor: number; simulatedCollectionProjectionMinor: number }>;
  reviews: Array<{ id: string; customerName: string; rating: number; comment: string }>;
  revenue: {
    daily: MoneyPoint[];
    weekly: MoneyPoint[];
    monthly: MoneyPoint[];
    byService: MoneyBreakdown[];
    byStaff: MoneyBreakdown[];
    byCustomer: MoneyBreakdown[];
  };
}

function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function series(rows: unknown, key: string): MoneyPoint[] {
  return arr(rows).map((r) => ({ label: str(r[key]), estimated: int(r.estimatedValueMinor), collection: int(r.collectionProjectionMinor) }));
}
function breakdown(rows: unknown, key: string): MoneyBreakdown[] {
  return arr(rows).map((r) => ({
    id: str(r[key]),
    completedVisits: int(r.completedVisits),
    estimatedValueMinor: int(r.estimatedValueMinor),
    collectionProjectionMinor: int(r.collectionProjectionMinor),
  }));
}

/**
 * Reads GET demo/workspaces/:id. Returns null unless the answer names a workspace and carries a dataset object, so a broken
 * answer shows an error rather than an invented dashboard. Every list is read defensively and amounts stay whole minor units.
 */
export function parseDemoView(raw: unknown): DemoView | null {
  if (!isRecord(raw) || typeof raw.workspaceId !== "string" || !raw.workspaceId || !isRecord(raw.dataset)) return null;
  const d = raw.dataset;
  const revenue = isRecord(d.revenue) ? d.revenue : {};
  return {
    workspaceId: raw.workspaceId,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label : DEFAULT_DEMO_LABEL,
    currency: str(d.currency, ""),
    timezone: str(d.timezone, "UTC"),
    generatedAt: typeof d.generatedAt === "string" ? d.generatedAt : null,
    counts: parseCounts(d.counts),
    customers: arr(d.customers).map((c) => ({ id: str(c.id), name: str(c.name), email: str(c.email), firstVisitAt: str(c.firstVisitAt), lastVisitAt: str(c.lastVisitAt), visitCount: int(c.visitCount) })),
    staff: arr(d.staff).map((x) => ({ id: str(x.id), name: str(x.name), role: str(x.role) })),
    chairs: arr(d.chairs).map((x) => ({ id: str(x.id), label: str(x.label), status: str(x.status) })),
    services: arr(d.services).map((x) => ({ id: str(x.id), name: str(x.name), category: str(x.category), durationMinutes: int(x.durationMinutes), listPriceMinor: int(x.listPriceMinor) })),
    visits: arr(d.visits).map((v) => ({
      id: str(v.id),
      status: str(v.status),
      customerName: str(v.customerName),
      serviceId: str(v.serviceId),
      staffId: typeof v.staffId === "string" ? v.staffId : null,
      joinedAt: str(v.joinedAt),
      completedAt: typeof v.completedAt === "string" ? v.completedAt : null,
      estimatedValueMinor: int(v.estimatedValueMinor),
      simulatedCollectionMinor: int(v.simulatedCollectionMinor),
    })),
    bookings: arr(d.bookings).map((b) => ({
      id: str(b.id),
      source: str(b.source),
      status: str(b.status),
      customerId: str(b.customerId),
      serviceIds: Array.isArray(b.serviceIds) ? b.serviceIds.filter((x): x is string => typeof x === "string") : [],
      slotStart: str(b.slotStart),
    })),
    invoices: arr(d.invoices).map((i) => ({ id: str(i.id), status: str(i.status), totalMinor: int(i.totalMinor), simulatedCollectionProjectionMinor: int(i.simulatedCollectionProjectionMinor) })),
    reviews: arr(d.reviews).map((r) => ({ id: str(r.id), customerName: str(r.customerName), rating: int(r.rating), comment: str(r.comment) })),
    revenue: {
      daily: series(revenue.daily, "date"),
      weekly: series(revenue.weekly, "weekStarting"),
      monthly: series(revenue.monthly, "month"),
      byService: breakdown(revenue.byService, "serviceId"),
      byStaff: breakdown(revenue.byStaff, "staffId"),
      byCustomer: breakdown(revenue.byCustomer, "customerId"),
    },
  };
}

/** Whole minor units (paise, cents) shown as money. Only for display; nothing is summed from these. */
export function minorText(minor: number, currency: string): string {
  const major = minor / 100;
  const text = major.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2 });
  if (!currency) return text;
  return currency === "INR" ? `\u20B9${text}` : `${currency} ${text}`;
}

/** Looks a name up by id in a list of {id, name}; an id the dataset does not list is shown as "Unknown", never guessed. */
export function nameOf(list: ReadonlyArray<{ id: string; name: string }>, id: string | null): string {
  if (!id) return "Not assigned";
  return list.find((x) => x.id === id)?.name ?? "Unknown";
}

const STATUS_WORDS: Record<string, string> = {
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
  WAITING: "Waiting",
  IN_SERVICE: "In service",
  CONFIRMED: "Confirmed",
  PAID: "Paid (simulated)",
  PARTIALLY_PAID: "Part paid (simulated)",
  AWAITING_PAYMENT: "Awaiting payment (simulated)",
  FASTQUE_WEB: "FastQue website",
  FASTQUE_APP: "FastQue app",
  BARBER: "Barber",
  MANAGER: "Manager",
  AVAILABLE: "Free",
  OCCUPIED: "Occupied",
};

export function statusWord(value: string): string {
  return STATUS_WORDS[value] ?? value;
}

/** Points for a chart: the series label and either the estimated value or the simulated collection, in major units for the axis. */
export function chartPoints(rows: ReadonlyArray<MoneyPoint>, field: "estimated" | "collection"): Array<{ label: string; value: number }> {
  return rows.map((r) => ({ label: r.label, value: (field === "estimated" ? r.estimated : r.collection) / 100 }));
}
