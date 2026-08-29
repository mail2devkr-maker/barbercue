"use client";

import { useOnlineStatus } from "../../lib/network-status";
import styles from "./offline-banner.module.css";

/**
 * Phase 15 (Low-Network / Resilience Mode). App-wide, mounted once in each root layout (customer
 * and dashboard). Deliberately says "reconnecting automatically" rather than offering a manual
 * retry button — the realtime socket already has `reconnection: true` and re-syncs itself via
 * onReconnect() (see lib/realtime.ts), and apiFetch calls simply fail with a clear NETWORK_OFFLINE
 * message in the meantime rather than needing a dedicated retry action here.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className={styles.bar} role="status">
      You&apos;re offline — showing the last data we had. We&apos;ll reconnect automatically.
    </div>
  );
}
