import type { AdminSalonLocationProposalDto } from "@barbercue/shared";

// Admin review of owner-proposed shop locations (requirement #12), on Codex PR #241:
//   GET  admin/location-verifications?cursor&limit            pending proposals, oldest first
//   POST admin/location-verifications/:id/decision {decision: APPROVED | REJECTED, note (3-500 characters)}
//
// Only a global platform administrator other than the person who proposed it may decide, and the server enforces that.
// A proposal's source (device location or typed) records how the owner entered the numbers; it is not proof of where
// the shop is. This file only helps the reviewer see the facts (how far the proposal is from what is public now) and
// build a valid decision; it never decides anything.

export const NOTE_MIN = 3;
export const NOTE_MAX = 500;

export type Decision = "APPROVED" | "REJECTED";

/** The server's own rule for the required review note (trimmed length 3 to 500). */
export function validateNote(note: string): string | null {
  const length = note.trim().length;
  if (length < NOTE_MIN) return `Write a short note (at least ${NOTE_MIN} characters) saying why.`;
  if (length > NOTE_MAX) return `The note can be at most ${NOTE_MAX} characters.`;
  return null;
}

const EARTH_RADIUS_KM = 6371.0088;

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Straight-line distance in kilometres between two points (haversine). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How far the proposal is from the location customers see now, in words a reviewer can compare at a glance. */
export function describeShift(item: Pick<AdminSalonLocationProposalDto, "latitude" | "longitude" | "salon">): string {
  const { currentLatitude, currentLongitude } = item.salon;
  if (currentLatitude === null || currentLongitude === null) return "The shop has no public location yet.";
  const km = distanceKm({ latitude: currentLatitude, longitude: currentLongitude }, item);
  if (km < 0.05) return "Essentially the same point as the current location (under 50 m).";
  if (km < 1) return `About ${Math.round(km * 1000)} m from the current location.`;
  return `About ${km.toFixed(1)} km from the current location.`;
}

/** Address lines the reviewer compares against the map, skipping empty parts. */
export function addressLine(salon: AdminSalonLocationProposalDto["salon"]): string {
  return [salon.addressLine, salon.localityText, salon.cityName, salon.postalCode].filter((p): p is string => Boolean(p && p.trim())).join(", ");
}

export function decisionBody(decision: Decision, note: string): { decision: Decision; note: string } {
  return { decision, note: note.trim() };
}

export function decisionVerb(decision: Decision): string {
  return decision === "APPROVED" ? "Approve" : "Reject";
}
