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
