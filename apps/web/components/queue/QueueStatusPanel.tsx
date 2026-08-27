"use client";

import { useEffect } from "react";
import { QUEUE_ENTRIES_PATH, type QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom } from "../../lib/realtime";
import styles from "./queue.module.css";

const ACTIVE_STATUSES = new Set(["WAITING", "CALLED", "IN_SERVICE"]);

function statusLabel(entry: QueueEntryDetailDto): string {
  if (entry.status === "CALLED") return "You're being called!";
  if (entry.status === "IN_SERVICE") return "In service";
  if (entry.status === "WAITING" && entry.position) return `Position ${entry.position}`;
  return entry.status;
}

function statusBadgeClass(status: string): string {
  if (status === "CALLED") return styles.statusCalled;
  if (status === "IN_SERVICE") return styles.statusInService;
  if (status === "WAITING") return styles.statusWaiting;
  return styles.statusNeutral;
}

/**
 * Live queue-token status for the current customer — used after both a walk-in join and an
 * appointment check-in. Fully controlled by the parent (`entry` is the current source of truth);
 * subscribes to `salon:{salonId}` for `queue.updated`/`queue.entry.called` and re-fetches
 * `GET queue-entries/mine/active` on either, matching API.md's ids-only realtime payload
 * convention (clients always re-fetch via REST rather than trusting the socket payload), handing
 * the result back to the parent via `onEntryChange` instead of holding its own copy.
 */
export function QueueStatusPanel({
  entry,
  onEntryChange,
}: {
  entry: QueueEntryDetailDto;
  onEntryChange: (entry: QueueEntryDetailDto | null) => void;
}) {
  useEffect(() => {
    if (!ACTIVE_STATUSES.has(entry.status)) return undefined;
    const salonId = entry.salonId;
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);

    let cancelled = false;
    function refetch() {
      apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
        .then((next) => {
          if (!cancelled) onEntryChange(next);
        })
        .catch(() => {
          /* transient — the next event will retry */
        });
    }
    function onQueueUpdated(payload: { salonId: string }) {
      if (payload.salonId === salonId) refetch();
    }
    function onEntryCalled(payload: { salonId: string; queueEntryId: string }) {
      if (payload.salonId === salonId) refetch();
    }

    socket.on("queue.updated", onQueueUpdated);
    socket.on("queue.entry.called", onEntryCalled);
    return () => {
      cancelled = true;
      socket.off("queue.updated", onQueueUpdated);
      socket.off("queue.entry.called", onEntryCalled);
    };
  }, [entry.salonId, entry.status, onEntryChange]);

  return (
    <div className={styles.ticket}>
      <div className={styles.ticketHead}>
        <div>
          <p className={styles.ticketTokenLabel}>Your token</p>
          <p className={styles.ticketToken}>#{entry.tokenNumber}</p>
        </div>
        <span className={`${styles.ticketStatusBadge} ${statusBadgeClass(entry.status)}`}>
          {statusLabel(entry)}
        </span>
      </div>
      {entry.status === "WAITING" && entry.estimatedWaitMinutes !== null && (
        <p className={styles.ticketDetail}>
          Estimated wait: <strong>~{entry.estimatedWaitMinutes} min</strong>
        </p>
      )}
      {entry.status === "IN_SERVICE" && (
        <p className={styles.ticketDetail}>
          {entry.assignedStaffName ? <>With <strong>{entry.assignedStaffName}</strong></> : "In service"}
          {entry.assignedChairLabel ? ` — ${entry.assignedChairLabel}` : ""}
        </p>
      )}
      {ACTIVE_STATUSES.has(entry.status) && (
        <p className={styles.ticketReassure}>
          This updates automatically — no need to refresh.
        </p>
      )}
    </div>
  );
}
