import type { SalonLocationDto, SalonLocationProposalDto } from "@barbercue/shared";

// Shop location (requirement #12, owner decision D8), on Codex PR #241:
//   GET   dashboard/salons/:salonId/location  -> { current: {latitude, longitude, verification, verifiedAt}, pendingProposal }
//   PATCH dashboard/salons/:salonId/location  {latitude, longitude, source: GPS | MAP_PIN | MANUAL}
//
// An owner can only PROPOSE coordinates. The public location does not change until a different, authorised FastQue
// reviewer approves, so this screen never says a location "is set" because a proposal was sent. The source records how
// the owner entered the numbers; it is not proof of where the shop is. Photos are never used. There is no map library
// yet (decision D8: start with the device location, typed coordinates and a link to an external map), so the pin source
// is not offered.

export type ProposalSource = "GPS" | "MANUAL";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseProposal(raw: unknown): SalonLocationProposalDto | null {
  if (!isRecord(raw)) return null;
  const latitude = num(raw.latitude);
  const longitude = num(raw.longitude);
  if (latitude === null || longitude === null) return null;
  if (typeof raw.id !== "string" || typeof raw.status !== "string" || typeof raw.source !== "string" || typeof raw.submittedAt !== "string") return null;
  return {
    id: raw.id,
    status: raw.status as SalonLocationProposalDto["status"],
    latitude,
    longitude,
    source: raw.source as SalonLocationProposalDto["source"],
    submittedAt: raw.submittedAt,
    reviewedAt: typeof raw.reviewedAt === "string" ? raw.reviewedAt : null,
    reviewNote: typeof raw.reviewNote === "string" ? raw.reviewNote : null,
  };
}

/** The latest approve or reject decision of a FastQue reviewer on this shop's proposals (Codex PR #268, `lastDecision`). */
export interface LastDecision {
  status: "APPROVED" | "REJECTED";
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface LocationView {
  current: { latitude: number | null; longitude: number | null; verified: boolean; verifiedAt: string | null };
  pending: SalonLocationProposalDto | null;
  /** null when there is no decision yet, or when the server does not send one (an older backend). */
  lastDecision: LastDecision | null;
}

/** Reads `lastDecision` defensively: only an approval or a rejection is a decision; anything else is "no decision". */
export function parseLastDecision(raw: unknown): LastDecision | null {
  if (!isRecord(raw)) return null;
  if (raw.status !== "APPROVED" && raw.status !== "REJECTED") return null;
  const note = typeof raw.reviewNote === "string" && raw.reviewNote.trim() !== "" ? raw.reviewNote : null;
  return { status: raw.status, reviewNote: note, reviewedAt: typeof raw.reviewedAt === "string" ? raw.reviewedAt : null };
}

/** Reads the server's answer defensively. Anything that is not the documented shape is "no answer", never a guess. */
export function parseLocation(raw: unknown): LocationView | null {
  if (!isRecord(raw) || !isRecord(raw.current)) return null;
  const c = raw.current;
  const latitude = c.latitude === null ? null : num(c.latitude);
  const longitude = c.longitude === null ? null : num(c.longitude);
  if ((c.latitude !== null && latitude === null) || (c.longitude !== null && longitude === null)) return null;
  if (c.verification !== "VERIFIED" && c.verification !== "UNVERIFIED") return null;
  return {
    current: {
      latitude,
      longitude,
      // Verified only when the server says so AND there are coordinates to be verified.
      verified: c.verification === "VERIFIED" && latitude !== null && longitude !== null,
      verifiedAt: typeof c.verifiedAt === "string" ? c.verifiedAt : null,
    },
    pending: raw.pendingProposal === null || raw.pendingProposal === undefined ? null : parseProposal(raw.pendingProposal),
    lastDecision: parseLastDecision(raw.lastDecision),
  };
}

const DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** A typed coordinate as a number, or null for anything that is not a plain decimal. */
export function parseCoordinate(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!DECIMAL_RE.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export interface CoordinateErrors {
  latitude?: string;
  longitude?: string;
}

export function validateCoordinates(latitudeText: string, longitudeText: string): { errors: CoordinateErrors; value: Coordinates | null } {
  const errors: CoordinateErrors = {};
  const latitude = parseCoordinate(latitudeText);
  const longitude = parseCoordinate(longitudeText);
  if (latitude === null) errors.latitude = "Enter the latitude as a number, for example 28.6139.";
  else if (latitude < -90 || latitude > 90) errors.latitude = "Latitude must be between -90 and 90.";
  if (longitude === null) errors.longitude = "Enter the longitude as a number, for example 77.2090.";
  else if (longitude < -180 || longitude > 180) errors.longitude = "Longitude must be between -180 and 180.";
  if (errors.latitude || errors.longitude || latitude === null || longitude === null) return { errors, value: null };
  return { errors, value: { latitude: round6(latitude), longitude: round6(longitude) } };
}

/** About 0.1 m: more digits only add noise from a device reading. */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** A link to an external map so the owner can check the point themselves. Nothing is loaded into FastQue's pages. */
export function mapLinkOut(latitude: number, longitude: number): string {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  GPS: "Device location",
  MAP_PIN: "Map pin",
  MANUAL: "Typed in",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  PENDING: "Waiting for review",
  APPROVED: "Approved",
  REJECTED: "Not approved",
  SUPERSEDED: "Replaced by a newer proposal",
};

export function proposalStatusLabel(status: string): string {
  return PROPOSAL_STATUS_LABEL[status] ?? status;
}

/** One sentence on what a decision means for the shop's public location, so a rejection is never read as a fault. */
export function decisionConsequence(decision: LastDecision): string {
  return decision.status === "APPROVED"
    ? "Your proposed point became the location customers see."
    : "The location customers see did not change. You can send a new proposal below.";
}

/** Plain words for a browser location failure (GeolocationPositionError codes 1 to 3). */
export function geolocationMessage(code: number | undefined): string {
  if (code === 1) return "Location access was blocked. Allow it for this site in your browser, or type the coordinates instead.";
  if (code === 2) return "Your device could not work out its location. Try again outdoors, or type the coordinates instead.";
  if (code === 3) return "Finding your location took too long. Try again, or type the coordinates instead.";
  return "Could not read your device location. You can type the coordinates instead.";
}

export function formatReviewTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export type { SalonLocationDto };
