// Advance notice of the owner-approved maintenance window (22 October 2026, 12:00 AM to 4:00 AM IST).
//
// This only DISPLAYS an announcement. It does not switch any maintenance mode, change any database connection or touch any
// server: pages keep working exactly as before. The notice is part of the static page, and a visitor's own clock only ever
// removes it once the window has ended.

/** 22 October 2026, 00:00 IST (UTC+5:30). */
export const MAINTENANCE_START = "2026-10-21T18:30:00.000Z";
/** 22 October 2026, 04:00 IST (UTC+5:30). */
export const MAINTENANCE_END = "2026-10-21T22:30:00.000Z";

export const MAINTENANCE_HEADLINE = "Scheduled maintenance";
export const MAINTENANCE_WINDOW_TEXT = "Thursday, 22 October 2026, 12:00 AM to 4:00 AM IST";
export const MAINTENANCE_MESSAGE = "FastQue may be unavailable or slow during this time.";
/** Shown after the message on wider screens only: the fixed header must stay compact on a phone. */
export const MAINTENANCE_ADVICE = "Please complete any bookings and queue work before then.";

/** True until the maintenance window has ended. Before and during the window the notice is shown. */
export function isMaintenanceNoticeVisible(nowMs: number): boolean {
  // An unusable clock value never hides the notice.
  return !Number.isFinite(nowMs) || nowMs < Date.parse(MAINTENANCE_END);
}
