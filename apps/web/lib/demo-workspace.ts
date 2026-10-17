// Demo Workspace (requirements #22 and #23, owner decision D3). Sample data lives in a private workspace that is
// separate from the shop's real records: it never mixes with real customers, bookings, revenue or reports, and it is
// never public. The routes below are the ones named in the contract; their exact response shapes are still a proposal,
// so every response is read defensively and nothing is assumed beyond what is listed here.
//
//   GET    dashboard/salons/:id/demo/status
//   POST   dashboard/salons/:id/demo/import           (Idempotency-Key)
//   POST   dashboard/salons/:id/demo/delete-preview   -> an expiring confirmation token bound to this owner and workspace
//   DELETE dashboard/salons/:id/demo                  {workspaceId, confirmation: "DELETE DEMO DATA", confirmationToken}

export const DELETE_CONFIRMATION = "DELETE DEMO DATA";
export const DEFAULT_DEMO_LABEL = "DEMO DATA — Not real business records";

export interface DemoCounts {
  customers: number;
  staff: number;
  services: number;
  visits: number;
  bookings: number;
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

const COUNT_KEYS: ReadonlyArray<keyof DemoCounts> = ["customers", "staff", "services", "visits", "bookings"];

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
  services: "Services",
  visits: "Visits",
  bookings: "Bookings",
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
