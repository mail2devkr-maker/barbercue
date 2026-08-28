"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, type CapacitySummaryDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom } from "../../lib/realtime";
import styles from "./capacity-summary.module.css";

function capacityPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.capacity}`;
}

/**
 * Owner Capacity Dashboard (Phase 6) — a small, decision-oriented operational snapshot, not a
 * historical/trend report (see Phase 9's analytics for that). Deliberately compact per the
 * mission's "don't overload the UI" instruction: a handful of counts, not a chart. Lives at the
 * top of the live-queue page, where an owner is already making staffing/assignment decisions.
 */
export function CapacitySummaryPanel({ salonId }: { salonId: string }) {
  const [data, setData] = useState<CapacitySummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      apiFetch<CapacitySummaryDto>(capacityPath(salonId))
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load capacity.");
        });
    }
    load();

    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    function onEvent(payload: { salonId: string }) {
      if (payload.salonId === salonId) load();
    }
    socket.on("queue.updated", onEvent);
    socket.on("staff.status.changed", onEvent);
    socket.on("booking.created", onEvent);
    socket.on("booking.cancelled", onEvent);
    return () => {
      cancelled = true;
      socket.off("queue.updated", onEvent);
      socket.off("staff.status.changed", onEvent);
      socket.off("booking.created", onEvent);
      socket.off("booking.cancelled", onEvent);
    };
  }, [salonId]);

  if (error) return null; // non-critical widget — fail quietly, the queue below still works
  if (!data) return <div className={styles.bar} aria-busy="true" />;

  return (
    <div className={styles.bar}>
      <div className={styles.stat}>
        <span className={styles.value}>
          {data.chairs.available}/{data.chairs.active}
        </span>
        <span className={styles.label}>Chairs free</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.value}>
          {data.staff.available}/{data.staff.active}
        </span>
        <span className={styles.label}>Barbers free</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.value}>{data.waitingCustomers}</span>
        <span className={styles.label}>Waiting</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.value}>{data.currentServices}</span>
        <span className={styles.label}>In service</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.value}>
          {data.averageEstimatedWaitMinutes !== null ? `~${data.averageEstimatedWaitMinutes}m` : "—"}
        </span>
        <span className={styles.label}>Avg wait</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.value}>{data.todaysBookings}</span>
        <span className={styles.label}>Today&apos;s bookings</span>
      </div>
      {(data.chairs.maintenance > 0 || data.staff.offDuty > 0) && (
        <div className={styles.stat}>
          <span className={styles.value}>
            {data.chairs.maintenance > 0 ? `${data.chairs.maintenance} chair` : ""}
            {data.chairs.maintenance > 0 && data.staff.offDuty > 0 ? " · " : ""}
            {data.staff.offDuty > 0 ? `${data.staff.offDuty} off-duty` : ""}
          </span>
          <span className={styles.label}>Unavailable</span>
        </div>
      )}
    </div>
  );
}
