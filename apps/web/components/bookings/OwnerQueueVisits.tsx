"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_PATHS,
  type OwnerBookingFilter,
  type PaginatedResult,
  type QueueEntryDetailDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import styles from "./bookings.module.css";

const PAGE_SIZE = 20;

/**
 * Queue-only visits belong in queue_entries, not bookings. Show them alongside appointments
 * without creating fake Booking rows or duplicating check-ins linked to a Booking.
 */
export function OwnerQueueVisits({ salonId, filter }: { salonId: string; filter: OwnerBookingFilter }) {
  const [items, setItems] = useState<QueueEntryDetailDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(
    async (nextCursor?: string, append = false) => {
      const request = ++requestId.current;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      const query = new URLSearchParams({ filter, limit: String(PAGE_SIZE) });
      if (nextCursor) query.set("cursor", nextCursor);
      try {
        const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.queue}/visits`;
        const result = await apiFetch<PaginatedResult<QueueEntryDetailDto>>(`${base}?${query}`);
        if (request !== requestId.current) return;
        setItems((prior) => (append ? [...prior, ...result.items] : result.items));
        setCursor(result.nextCursor);
      } catch (err: unknown) {
        if (request !== requestId.current) return;
        setError(err instanceof ApiError ? err.message : "Could not load Live Queue visits.");
      } finally {
        if (request === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [salonId, filter],
  );

  useEffect(() => {
    // Keep history fresh as the live queue changes; no mutation is performed by this view.
    void Promise.resolve().then(() => load());
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const refresh = (event?: { salonId?: string }) => {
      if (!event?.salonId || event.salonId === salonId) void load();
    };
    socket.on("queue.updated", refresh);
    const unsubscribeReconnect = onReconnect(() => void load());
    return () => {
      ++requestId.current; // ignore stale responses when the shop or selected filter changes
      socket.off("queue.updated", refresh);
      unsubscribeReconnect();
    };
  }, [salonId, load]);

  function statusText(entry: QueueEntryDetailDto): string {
    if (entry.phase === "ASSIGNED") return "Assigned · not started";
    if (entry.status === "NO_SHOW") return "No-show";
    if (entry.status === "IN_SERVICE") return "In service";
    return entry.status.charAt(0) + entry.status.slice(1).toLowerCase();
  }

  return (
    <section className={styles.recordSection} aria-label="Live Queue visits">
      <h2 className={styles.recordHeading}>Live Queue visits</h2>
      <p className={styles.recordDescription}>
        Customers who joined the Live Queue directly. Appointment check-ins are shown below under Appointments, without duplicates.
      </p>
      {error && <p role="alert" className={styles.errorText}>{error}</p>}
      {loading ? (
        <p>Loading Live Queue visits…</p>
      ) : items.length === 0 ? (
        <p className={styles.emptyState}>No Live Queue visits in this view yet.</p>
      ) : (
        <div className={styles.list}>
          {items.map((entry) => (
            <article key={entry.id} className={styles.card}>
              <div className={styles.queueVisitHead}>
                <div>
                  <strong className={styles.cardTitle}>
                    Live Queue #{entry.tokenNumber} · {entry.serviceName || "Service not selected"}
                  </strong>
                  <p className={styles.cardMeta}>
                    {new Date(entry.joinedAt).toLocaleString(undefined, {
                      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                    {" · "}{entry.customerName?.trim() || `Customer #${entry.tokenNumber}`}
                    {entry.assignedStaffName ? ` · ${entry.assignedStaffName}` : ""}
                  </p>
                </div>
                <span className={`${styles.statusBadge} ${
                  entry.status === "COMPLETED"
                    ? styles.statusCompleted
                    : entry.status === "CANCELLED" || entry.status === "EXPIRED"
                      ? styles.statusCancelled
                      : entry.status === "NO_SHOW" ? styles.statusNoShow : styles.statusConfirmed
                }`}>
                  {statusText(entry)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
      {cursor && (
        <div className={styles.loadMoreRow}>
          <button type="button" className={styles.filterChip} onClick={() => void load(cursor, true)} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more Live Queue visits"}
          </button>
        </div>
      )}
    </section>
  );
}
