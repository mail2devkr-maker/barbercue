// Advance notice of the owner-approved maintenance start (23 October 2026, 12:00 AM IST).
//
// This only DISPLAYS an announcement. It does not switch any maintenance mode, change any database connection or touch any
// server: pages keep working exactly as before. The notice remains visible until a later release removes it; no end time
// has been approved, so the visitor's clock must not imply that maintenance has finished.

/** 23 October 2026, 00:00 IST (UTC+5:30). */
export const MAINTENANCE_START = "2026-10-22T18:30:00.000Z";
/** No end time was approved; the notice is removed by a subsequent release. */
export const MAINTENANCE_END: string | null = null;

export const MAINTENANCE_HEADLINE = "Scheduled maintenance";
export const MAINTENANCE_WINDOW_TEXT = "Starting Friday, 23 October 2026, at 12:00 AM IST";
export const MAINTENANCE_MESSAGE = "FastQue may be unavailable or slow during this time.";
/** Shown after the message on wider screens only: the fixed header must stay compact on a phone. */
export const MAINTENANCE_ADVICE = "Please complete any bookings and queue work before then.";

/** True until a later release removes the notice; this approved announcement has no end time. */
export function isMaintenanceNoticeVisible(nowMs: number): boolean {
  // An unusable clock value never hides the notice.
  if (!Number.isFinite(nowMs)) return true;
  return MAINTENANCE_END === null || nowMs < Date.parse(MAINTENANCE_END);
}
