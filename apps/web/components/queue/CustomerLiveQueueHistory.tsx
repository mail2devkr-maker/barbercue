"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BOOKING_PATHS,
  VISIT_HISTORY_SOURCE_LABELS,
  formatZonedDateTime,
  type CustomerVisitHistoryItemDto,
  type PaginatedResult,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { ReviewPanel } from "../booking/ReviewPanel";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import styles from "../../app/(customer)/account/bookings/bookings.module.css";

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTime(item: CustomerVisitHistoryItemDto): string {
  return formatZonedDateTime(item.serviceDate, item.salonTimezone, undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CustomerLiveQueueHistory() {
  const [items, setItems] = useState<CustomerVisitHistoryItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    const params = new URLSearchParams({ source: "all", limit: "20" });
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await apiFetch<
        PaginatedResult<CustomerVisitHistoryItemDto>
      >(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mineHistory}?${params}`);
      setItems((current) =>
        append ? [...current, ...result.items] : result.items,
      );
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load your visit history.",
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ source: "all", limit: "20" });
    apiFetch<PaginatedResult<CustomerVisitHistoryItemDto>>(
      `${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mineHistory}?${params}`,
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
            : "Could not load your visit history.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className={styles.section}
      aria-labelledby="visit-history-title"
    >
      <h2 id="visit-history-title" className={styles.sectionTitle}>
        All visit history
      </h2>
      {error && (
        <p className={styles.errorPanel} role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <Card className={styles.loadingCard}>
          <p role="status">Loading visit history…</p>
        </Card>
      ) : items.length === 0 ? (
        <p className={styles.emptyListNote}>No linked visits yet.</p>
      ) : (
        items.map((item) => (
          <Card key={item.id} className={styles.bookingRow}>
            <div className={styles.bookingRowHead}>
              <strong>{item.serviceName}</strong>
              <span className={styles.statusBadge}>
                {formatStatus(item.status)}
              </span>
            </div>
            <p className={styles.bookingRowSalon}>
              {item.salonName} — {formatTime(item)}
            </p>
            <p className={styles.bookingRowMeta}>
              Source: {VISIT_HISTORY_SOURCE_LABELS[item.source]}
              {item.joinedAt &&
                ` · Joined ${formatZonedDateTime(item.joinedAt, item.salonTimezone, undefined, { hour: "numeric", minute: "2-digit" })}`}
            </p>
            {item.assignedStaffName && (
              <p className={styles.bookingRowMeta}>
                Staff: {item.assignedStaffName}
              </p>
            )}
            {item.completedAt && (
              <p className={styles.bookingRowMeta}>
                Completed:{" "}
                {formatZonedDateTime(
                  item.completedAt,
                  item.salonTimezone,
                  undefined,
                  {
                    hour: "numeric",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  },
                )}
              </p>
            )}
            {item.services.length > 1 && (
              <ul className={styles.bookingRowMeta}>
                {item.services.map((service, index) => (
                  <li key={`${service.serviceId ?? service.name}-${index}`}>
                    {service.name}
                  </li>
                ))}
              </ul>
            )}
            {item.reviewEligible || item.myReview ? (
              <ReviewPanel
                bookingId={item.bookingId ?? undefined}
                queueEntryId={item.queueEntryId ?? undefined}
                status={item.status}
                hasReview={Boolean(item.myReview)}
                initialReview={item.myReview}
                title="Rate your service"
                onReviewed={() => void load()}
              />
            ) : item.status === "COMPLETED" ? (
              <p className={styles.bookingRowMeta}>
                This visit is not linked to a verified customer account, so
                feedback is unavailable.
              </p>
            ) : null}
          </Card>
        ))
      )}
      {nextCursor && (
        <div className={styles.loadMoreWrap}>
          <Button
            type="button"
            variant="outline"
            onClick={() => void load(nextCursor, true)}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more visits"}
          </Button>
        </div>
      )}
    </section>
  );
}
