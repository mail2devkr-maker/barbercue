"use client";

import { useEffect, useState } from "react";
import { QUEUE_ENTRIES_HISTORY_PATH, QUEUE_ENTRIES_PATH, formatZonedDateTime } from "@barbercue/shared";
import type { CustomerQueueHistoryItemDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Waiting",
  CALLED: "Called",
  IN_SERVICE: "In service",
  COMPLETED: "Completed",
  CANCELLED: "Left queue",
  NO_SHOW: "Missed",
  EXPIRED: "Expired",
};

/**
 * Owner report (14 Nov): a signed-in customer had no Live Queue history. Lists the customer's own
 * Live Queue visits (walk-in / remote joins), newest first — appointment check-ins already show
 * under bookings.
 */
export function QueueHistorySection({ className, titleClassName, rowClassName, metaClassName }: {
  className?: string;
  titleClassName?: string;
  rowClassName?: string;
  metaClassName?: string;
}) {
  const [visits, setVisits] = useState<CustomerQueueHistoryItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CustomerQueueHistoryItemDto[]>(`${QUEUE_ENTRIES_PATH}/${QUEUE_ENTRIES_HISTORY_PATH}?limit=50`)
      .then((items) => {
        if (!cancelled) setVisits(Array.isArray(items) ? items : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your Live Queue history.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={className} aria-labelledby="queue-history-heading">
      <h2 id="queue-history-heading" className={titleClassName}>Live Queue history</h2>
      {error ? <p role="alert">{error}</p> : null}
      {!error && visits === null ? <p className={metaClassName}>Loading…</p> : null}
      {visits && visits.length === 0 ? (
        <p className={metaClassName}>No Live Queue visits yet. When you join a shop’s Live Queue, it shows here.</p>
      ) : null}
      {visits?.map((visit) => (
        <article key={visit.id} className={rowClassName} data-testid="queue-history-item">
          <p>
            <strong>Token #{visit.tokenNumber}</strong> · {STATUS_LABEL[visit.status] ?? visit.status}
          </p>
          <p className={metaClassName}>
            {visit.salonName}
            {visit.serviceName ? ` · ${visit.serviceName}` : ""}
          </p>
          <p className={metaClassName}>
            Joined{" "}
            {formatZonedDateTime(visit.joinedAt, visit.salonTimezone ?? "Asia/Kolkata", "en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </article>
      ))}
    </section>
  );
}
