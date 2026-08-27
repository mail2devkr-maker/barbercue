"use client";

import { useEffect, useState } from "react";
import {
  QUEUE_ENTRIES_PATH,
  SALON_QUEUE_PATHS,
  type QueueEntryDetailDto,
  type ServiceDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import { QueueStatusPanel } from "./QueueStatusPanel";
import styles from "./queue.module.css";

export function WalkInJoinFlow({ salonId, services }: { salonId: string; services: ServiceDto[] }) {
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);

  // A customer can only hold one active token anywhere (assertNotAlreadyInQueue) — check for one
  // on mount so a repeat visit to this page shows live status instead of a doomed join attempt.
  useEffect(() => {
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((active) => {
        if (!cancelled) setEntry(active);
      })
      .catch(() => {
        /* no active entry, or a transient error — the join button remains available */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleJoin() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.join}`, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify(selectedServiceId ? { serviceId: selectedServiceId } : {}),
      });
      setEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the queue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className={styles.stepLoading}>Loading…</p>;

  if (entry && entry.salonId !== salonId) {
    return (
      <p className={styles.stepLoading}>
        You already have an active queue token at another salon. Finish or cancel it before joining here.
      </p>
    );
  }

  if (entry) {
    return <QueueStatusPanel entry={entry} onEntryChange={setEntry} />;
  }

  return (
    <div className={styles.joinCard}>
      <label className={styles.fieldLabel} htmlFor="walkin-service">
        Service (optional)
      </label>
      <select
        id="walkin-service"
        value={selectedServiceId}
        onChange={(e) => setSelectedServiceId(e.target.value)}
        className={styles.select}
      >
        <option value="">Any service</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.durationMinutes} min)
          </option>
        ))}
      </select>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.joinActions}>
        <Button type="button" variant="primary" onClick={() => void handleJoin()} disabled={submitting}>
          {submitting ? "Joining…" : "Join the queue"}
        </Button>
      </div>
      <p className={styles.reassure}>We&apos;ll keep your place — no need to stay by the counter.</p>
    </div>
  );
}
