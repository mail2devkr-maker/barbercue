import { useEffect, useState } from 'react';
import { NOTIFICATION_PATHS } from '@barbercue/shared';
import { apiFetch } from './api';

const UNREAD_POLL_INTERVAL_MS = 60_000;

/** Polls the Notification Center's unread count for a tab badge (Phase 11/12) — shared by the
 * customer, owner and staff navigators, since "my own unread count" is identical regardless of
 * role. Same polling approach as web's NotificationBell; no dedicated realtime channel for this. */
export function useUnreadNotificationCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    function refresh() {
      apiFetch<{ count: number }>(
        `${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.mine}/${NOTIFICATION_PATHS.unreadCount}`,
      )
        .then((r) => {
          if (!cancelled) setCount(r.count);
        })
        .catch(() => {
          /* non-critical badge */
        });
    }
    refresh();
    const id = setInterval(refresh, UNREAD_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return count;
}
