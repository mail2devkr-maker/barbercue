import { DASHBOARD_PATHS, QueueErrorCode, type UiStrings } from '@barbercue/shared';

// The owner/staff queue mutations all live on DashboardQueueController, which is mounted under
// `dashboard/`. The Live Queue used to call `queue-entries/:id/call` (no prefix) and every action —
// call, cancel, assign, no-show, complete — 404'd in production with "Cannot POST /api/v1/…".
// Keeping every path in one place lets a test pin them, so this can never silently drift again.
const entryPath = (entryId: string, action: string): string =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.queueEntries}/${entryId}/${action}`;

export const liveQueuePaths = {
  call: (entryId: string): string => entryPath(entryId, DASHBOARD_PATHS.call),
  arrive: (entryId: string): string => entryPath(entryId, DASHBOARD_PATHS.arrive),
  assign: (entryId: string): string => entryPath(entryId, DASHBOARD_PATHS.assign),
  noShow: (entryId: string): string => entryPath(entryId, DASHBOARD_PATHS.noShow),
  cancel: (entryId: string): string => entryPath(entryId, DASHBOARD_PATHS.cancel),
  complete: (sessionId: string): string =>
    `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.serviceSessions}/${sessionId}/${DASHBOARD_PATHS.complete}`,
} as const;

export type LiveQueueAction = keyof typeof liveQueuePaths;

interface ApiErrorLike {
  status?: unknown;
  code?: unknown;
  message?: unknown;
}

const CURATED_QUEUE_CODES: ReadonlySet<string> = new Set(Object.values(QueueErrorCode));

/**
 * Turns a failed queue action into copy an owner can act on. Never surfaces raw transport/router
 * text such as "Cannot POST /api/v1/…". The backend's own message is only shown for the curated,
 * human-written QueueErrorCodes (e.g. "This chair is already occupied."); everything else falls
 * back to a generic localized line. The raw failure is logged (action, status, code only — no
 * customer data and no message body) so it stays diagnosable from logcat.
 */
export function friendlyQueueActionError(err: unknown, t: UiStrings, action?: LiveQueueAction): string {
  const e: ApiErrorLike = err && typeof err === 'object' ? (err as ApiErrorLike) : {};
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = typeof e.code === 'string' ? e.code : undefined;

  console.warn('[live-queue] action failed', { action, status, code });

  if (code === 'NETWORK_OFFLINE' || status === 0) return t.queueNetworkError;
  if (status === 403 || code === QueueErrorCode.SALON_ACCESS_DENIED) return t.queueActionNotAllowedError;
  if (
    code === QueueErrorCode.INVALID_QUEUE_TRANSITION ||
    code === QueueErrorCode.QUEUE_ENTRY_NOT_FOUND ||
    code === QueueErrorCode.SERVICE_SESSION_NOT_FOUND
  ) {
    return t.queueEntryChangedError;
  }
  if (code && CURATED_QUEUE_CODES.has(code) && typeof e.message === 'string' && e.message.trim()) {
    return e.message;
  }
  return t.couldNotCompleteAction;
}
