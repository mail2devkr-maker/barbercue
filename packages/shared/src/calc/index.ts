import { ChargeType } from '../enums';

// Pure functions only — no I/O, no Date.now() side effects baked in (callers pass "now" in).
// These mirror the rules in PAYMENTS.md / STATE_MACHINES.md / DATABASE.md exactly so web, mobile,
// and backend can render/preview the same numbers the server will ultimately (re-)compute and
// enforce authoritatively.

export interface ChargeRule {
  type: ChargeType;
  value: number;
}

/**
 * Computes a charge amount from a FLAT/PERCENTAGE rule against a service price, capped at the
 * service price (a cancellation charge can never exceed what the service would have cost).
 */
export function computeChargeAmount(rule: ChargeRule, servicePrice: number): number {
  const raw = rule.type === ChargeType.FLAT ? rule.value : (rule.value / 100) * servicePrice;
  return Math.min(Math.max(raw, 0), servicePrice);
}

export interface CancellationPolicyLike {
  freeCancellationWindowMinutes: number;
  lateCancellationChargeType: ChargeType;
  lateCancellationChargeValue: number;
  noShowChargeType: ChargeType;
  noShowChargeValue: number;
}

/**
 * Resolved cancellation-charge computation from STATE_MACHINES.md's cancellation flow. Does not
 * decide *how* the charge is collected (refund-netting vs. CustomerLedgerEntry) — that depends on
 * whether an eligible Payment exists, which only the backend can determine.
 */
export function computeCancellationCharge(
  policy: CancellationPolicyLike,
  servicePrice: number,
  minutesUntilSlot: number,
  isNoShow: boolean,
): number {
  if (isNoShow) {
    return computeChargeAmount({ type: policy.noShowChargeType, value: policy.noShowChargeValue }, servicePrice);
  }
  if (minutesUntilSlot >= policy.freeCancellationWindowMinutes) {
    return 0;
  }
  return computeChargeAmount(
    { type: policy.lateCancellationChargeType, value: policy.lateCancellationChargeValue },
    servicePrice,
  );
}

/**
 * Service-level booking capacity per DATABASE.md: a service consumes one staff member and one
 * chair simultaneously, so the scarcer resource is the binding constraint. Correctly yields 2 for
 * both "3 barbers + 2 chairs" and "2 barbers + 3 chairs".
 */
export function computeSlotCapacity(qualifiedStaffCount: number, activeChairCount: number): number {
  return Math.min(qualifiedStaffCount, activeChairCount);
}

export function isSlotBookable(slotCapacity: number, consumedCapacity: number): boolean {
  return consumedCapacity < slotCapacity;
}

/**
 * Phase 3C — STATE_MACHINES.md describes `QueueEntry.estimatedWaitMinutes` only as "a derived,
 * cached value, never authoritative for ordering," without specifying an exact algorithm. This is
 * the resolved one: `serverCount` reuses `computeSlotCapacity` (qualified-ACTIVE-staff × ACTIVE
 * chairs, scoped to the entry's own service — same StaffService rule as booking). `null` when
 * there's no capacity at all to estimate against, rather than a misleading number.
 */
export function estimateWaitMinutes(
  serverCount: number,
  peopleAhead: number,
  avgServiceDurationMinutes: number,
  activeSessionsRemainingMinutes: number,
): number | null {
  if (serverCount <= 0) return null;
  const batchesAhead = Math.floor(peopleAhead / serverCount);
  return Math.round(batchesAhead * avgServiceDurationMinutes + activeSessionsRemainingMinutes);
}

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two lat/lng points, in kilometres — the standard formula, no paid
 * Maps/geocoding API involved. Used by "Near Me" salon search (packages/backend salons.service.ts)
 * and by clients that want to render the same figure the server sorted by.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
