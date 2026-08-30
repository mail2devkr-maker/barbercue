"use client";

import { useEffect, useRef, useState } from "react";
import { SALON_QUEUE_PATHS } from "@barbercue/shared";
import type { QueueStatusDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import styles from "./discovery-content.module.css";

// How often a visitor browsing the public salon page (never logged in, so never holds a realtime
// socket — see realtime.gateway.ts's handleConnection, which requires a valid JWT at handshake)
// re-polls the queue snapshot. Short enough to feel "live" for someone deciding whether to walk
// in, long enough not to hammer a public, unauthenticated endpoint.
const POLL_INTERVAL_MS = 20_000;

/**
 * Issue 5 — live queue details on the public salon page: salon-wide waiting count/ETA plus a
 * per-barber breakdown, entirely from GET salons/:salonId/queue/status (already @Public(), reused
 * unmodified — see SalonQueueController). Every field this renders is already privacy-safe by
 * construction (QueueStatusDto.staffBreakdown carries only staffId/displayName/busy/
 * waitingForThisStaff — never a customer name, phone, email, or queue-entry id).
 */
export function LiveQueueBoard({ salonId }: { salonId: string }) {
  const [status, setStatus] = useState<QueueStatusDto | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    function poll() {
      apiFetch<QueueStatusDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.status}`)
        .then((result) => {
          if (mountedRef.current) setStatus(result);
        })
        .catch(() => {
          // A transient failure (or a salon that stopped being ACTIVE between page load and this
          // poll) just leaves the last-known snapshot on screen rather than showing an error card.
        });
    }
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [salonId]);

  // Nothing yet, or an ACTIVE-but-not-actually-staffed shop (Issue 9's NO_ACTIVE_STAFF gap) —
  // same "render nothing, not a broken-looking empty state" convention as TeamSection.
  if (!status || status.staffBreakdown.length === 0) return null;

  return (
    <section className={styles.queueBoard} aria-label="Live queue status">
      <p className={styles.queueBoardEyebrow}>Right now</p>
      <div className={styles.queueBoardStat}>
        <strong>{status.waitingCount}</strong>
        <span>{status.waitingCount === 1 ? "person waiting" : "people waiting"}</span>
      </div>
      {status.estimatedWaitRangeMinutes && (
        <p className={styles.queueBoardEta}>
          Est. wait {status.estimatedWaitRangeMinutes.min}–{status.estimatedWaitRangeMinutes.max} min
        </p>
      )}
      <ul className={styles.queueStaffList}>
        {status.staffBreakdown.map((staff) => (
          <li key={staff.staffId} className={styles.queueStaffRow}>
            <span className={styles.queueStaffName}>{staff.displayName}</span>
            <span
              className={
                staff.busy
                  ? `${styles.queueStaffStatus} ${styles.queueStaffBusy}`
                  : `${styles.queueStaffStatus} ${styles.queueStaffFree}`
              }
            >
              {staff.busy ? "With a customer" : "Available"}
            </span>
            {staff.waitingForThisStaff > 0 && (
              <span className={styles.queueStaffWaiting}>
                {staff.waitingForThisStaff} waiting for them
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
