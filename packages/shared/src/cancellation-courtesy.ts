// Owner-controlled retention policy for late-cancellation charges.
// This is intentionally separate from NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT (No-Show Grace).
// A free cancellation inside the effective cancellation window never creates a CANCELLATION_CHARGE
// ledger row, so it cannot consume this quota.
export const CANCELLATION_COURTESY_WAIVER_LIMIT = 5;
