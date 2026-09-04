import { ChargeType } from '../enums';
import { CREDIT_PER_SLAB_INR, CREDIT_SLAB_AMOUNT_INR } from '../constants';

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

// Customer Dues + Cancellation Policy mission — a salon can be more generous than this, but never
// stingier: no salon policy may ever require less than 60 minutes' notice for a free cancellation.
export const PLATFORM_MINIMUM_FREE_CANCELLATION_WINDOW_MINUTES = 60;

/**
 * The free-cancellation window actually enforced for a salon: whichever is more generous of the
 * platform-wide floor and the salon's own configured value. Single source of truth for this floor
 * — computeCancellationCharge below and every display-facing "free cancellation up to N" surface
 * (web/mobile) must derive the effective window through this function, never re-implement the
 * max(60, ...) rule themselves, so the charge computed and the number shown to a customer before
 * they cancel can never silently disagree.
 */
export function effectiveFreeCancellationWindowMinutes(configuredMinutes: number): number {
  return Math.max(PLATFORM_MINIMUM_FREE_CANCELLATION_WINDOW_MINUTES, configuredMinutes);
}

/**
 * FastQue Credits / Wallet V1 — the REDEMPTION CAP for a booking at this price, NOT an earn rate:
 * floor(price / CREDIT_SLAB_AMOUNT_INR) * CREDIT_PER_SLAB_INR. A ₹50 service caps redemption at
 * ₹10, ₹100 at ₹20, ₹150 at ₹30, and so on — exactly 20% at every whole-slab price and strictly
 * less at any price that isn't an exact multiple of ₹50 (₹75 caps at ₹10, not ₹15).
 *
 * Single source of truth shared by the server (CustomerCreditsService.redeemUpTo — the actual
 * authority, which independently re-derives this from its own trusted price and never trusts a
 * client-supplied redemption amount) and every client-side redemption preview (e.g. web's
 * BookingFlow slider), so the number a customer sees before booking can never silently disagree
 * with what the server will actually allow.
 */
export function computeMaxRedeemableCredits(servicePrice: number): number {
  const slabs = Math.floor(servicePrice / CREDIT_SLAB_AMOUNT_INR);
  return slabs * CREDIT_PER_SLAB_INR;
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
  if (minutesUntilSlot >= effectiveFreeCancellationWindowMinutes(policy.freeCancellationWindowMinutes)) {
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

// A service that has already run past its nominal duration hasn't necessarily just finished —
// the customer is still literally in the chair. Flooring "remaining" at 0 the instant nominal
// duration elapses (the old behaviour) understates how much longer everyone behind them will
// actually wait. This assumes a modest fixed tail instead of pretending the session is already
// over — a deliberate heuristic, not a data-driven prediction (that's Phase 32's job).
export const OVERRUN_TAIL_MINUTES = 5;

export function remainingSessionMinutes(
  durationMinutes: number,
  elapsedMinutes: number,
): number {
  const remaining = durationMinutes - elapsedMinutes;
  return remaining > 0 ? remaining : OVERRUN_TAIL_MINUTES;
}

// Smart Queue (Phase 5) — "Please arrive between 4:10-4:20" instead of a falsely precise single
// number. The band widens with the estimate itself (queue timing gets less certain the further out
// it is) but never collapses below a few minutes even for a near-zero estimate, since "your turn
// right now" still has some real slop in practice.
const WAIT_RANGE_MIN_BAND_MINUTES = 5;
const WAIT_RANGE_FRACTION = 0.25;

export function estimateWaitRangeMinutes(
  estimatedWaitMinutes: number | null,
): { min: number; max: number } | null {
  if (estimatedWaitMinutes === null) return null;
  const band = Math.max(WAIT_RANGE_MIN_BAND_MINUTES, Math.round(estimatedWaitMinutes * WAIT_RANGE_FRACTION));
  return { min: Math.max(0, estimatedWaitMinutes - band), max: estimatedWaitMinutes + band };
}

// Smart Queue (Phase 5) — "turn approaching" is the point a customer should start heading over.
export const TURN_APPROACHING_THRESHOLD_MINUTES = 5;
// "Estimated wait meaningfully changed" — small fluctuations every recompute cycle would be noisy
// enough to be worse than no alert at all; only a real swing is worth interrupting the customer for.
export const MEANINGFUL_WAIT_CHANGE_MINUTES = 10;

/**
 * Whether a queue wait-time update is worth actively alerting the customer about (vs. just quietly
 * updating the displayed number) — newly within the turn-approaching window, or a large enough
 * swing either direction that the customer's plans might change. Pure so both the backend (decides
 * whether to emit a realtime alert) and any client rendering copy can agree on the same rule.
 */
export function isWaitAlertWorthy(
  previousWaitMinutes: number | null,
  nextWaitMinutes: number | null,
): boolean {
  if (nextWaitMinutes === null) return false;
  const justApproaching =
    nextWaitMinutes <= TURN_APPROACHING_THRESHOLD_MINUTES &&
    (previousWaitMinutes === null || previousWaitMinutes > TURN_APPROACHING_THRESHOLD_MINUTES);
  const meaningfulSwing =
    previousWaitMinutes !== null &&
    Math.abs(nextWaitMinutes - previousWaitMinutes) >= MEANINGFUL_WAIT_CHANGE_MINUTES;
  return justApproaching || meaningfulSwing;
}
