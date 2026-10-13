"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DASHBOARD_PATHS,
  VISIT_HISTORY_FILTERS,
  VISIT_HISTORY_SOURCE_LABELS,
  formatZonedDateTime,
  type OwnerVisitHistoryItemDto,
  type PaginatedResult,
  type VisitHistoryFilter,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./bookings.module.css";

const FILTER_LABEL: Record<VisitHistoryFilter, string> = {
  all: "All visits",
  active: "Active",
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
  no_show: "No-show",
};

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Waiting",
  CALLED: "Called",
  IN_SERVICE: "In service",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  NO_SHOW: "No-show",
  CONFIRMED: "Confirmed",
  PENDING_PAYMENT: "Pending payment",
};

function formatVisitTime(iso: string, timezone: string | null): string {
  return formatZonedDateTime(iso, timezone, undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One chronologically merged history of source Booking and standalone QueueEntry rows. */
export function LiveQueueHistoryPanel({ salonId }: { salonId: string }) {
  const [filter, setFilter] = useState<VisitHistoryFilter>("all");
  const [items, setItems] = useState<OwnerVisitHistoryItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        source: "all",
        filter,
        limit: "20",
      });
      if (cursor) params.set("cursor", cursor);
      try {
        const result = await apiFetch<
          PaginatedResult<OwnerVisitHistoryItemDto>
        >(
          `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}/history?${params}`,
        );
        setItems((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load visit history.",
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [salonId, filter],
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      source: "all",
      filter,
      limit: "20",
    });
    apiFetch<PaginatedResult<OwnerVisitHistoryItemDto>>(
      `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}/history?${params}`,
    )
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load visit history.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, filter]);

  return (
    <section
      aria-labelledby="visit-history-title"
      style={{ marginTop: 28 }}
    >
      <h2 id="visit-history-title">All visit history</h2>
      <p className={styles.emptyState}>
        Online Bookings and Live Queue visits appear together in service-time order.
        Historical statuses are preserved.
      </p>
      <div
        className={styles.filterRow}
        role="group"
        aria-label="Filter all visits"
      >
        {VISIT_HISTORY_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.filterChip} ${filter === value ? styles.filterChipActive : ""}`}
            aria-pressed={filter === value}
            onClick={() => {
              setLoading(true);
              setFilter(value);
            }}
          >
            {FILTER_LABEL[value]}
          </button>
        ))}
      </div>

      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading visit history…</p>
      ) : items.length === 0 ? (
        <p className={styles.emptyState}>No visits in this view.</p>
      ) : (
        <div className={styles.list}>
          {items.map((visit) => (
            <article key={visit.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <span className={styles.cardTitle}>{visit.serviceName}</span>
                  <p className={styles.cardMeta}>
                    {formatVisitTime(visit.serviceDate, visit.salonTimezone)}
                    {visit.customerName ? ` · ${visit.customerName}` : ""}
                    {visit.customerPhone ? ` · ${visit.customerPhone}` : ""}
                  </p>
                </div>
                <span
                  className={`${styles.statusBadge} ${visit.status === "COMPLETED" ? styles.statusCompleted : ""}`}
                >
                  {STATUS_LABEL[visit.status] ?? visit.status}
                </span>
              </div>
              <dl className={styles.detail}>
                <div className={styles.detailItem}>
                  <dt>Source</dt>
                  <dd>{VISIT_HISTORY_SOURCE_LABELS[visit.source]}</dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Joined</dt>
                  <dd>
                    {formatVisitTime(
                      visit.joinedAt ?? visit.serviceDate,
                      visit.salonTimezone,
                    )}
                  </dd>
                </div>
                {visit.completedAt && (
                  <div className={styles.detailItem}>
                    <dt>Completed</dt>
                    <dd>
                      {formatVisitTime(visit.completedAt, visit.salonTimezone)}
                    </dd>
                  </div>
                )}
                {visit.assignedStaffName && (
                  <div className={styles.detailItem}>
                    <dt>Assigned staff</dt>
                    <dd>{visit.assignedStaffName}</dd>
                  </div>
                )}
                <div className={styles.detailItem}>
                  <dt>Price</dt>
                  <dd>
                    {visit.price === null
                      ? "Not recorded"
                      : `${visit.currency ?? ""} ${visit.price}`}
                  </dd>
                </div>
                <div className={styles.detailItem}>
                  <dt>Feedback</dt>
                  <dd>
                    {visit.review
                      ? `Reviewed · ${visit.review.rating}/5`
                      : visit.reviewEligible
                        ? "Eligible customer may rate this visit"
                        : "Not eligible for customer feedback"}
                  </dd>
                </div>
              </dl>
              <p className={styles.cardMeta}>
                Reference: {(visit.bookingId ?? visit.queueEntryId)?.slice(0, 8)}
              </p>
            </article>
          ))}
        </div>
      )}

      {nextCursor && (
        <div className={styles.loadMoreRow}>
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() => void load(nextCursor, true)}
          >
            {loadingMore ? "Loading…" : "Load more visits"}
          </Button>
        </div>
      )}
    </section>
  );
}
