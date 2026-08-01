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
import { QueueStatusPanel } from "./QueueStatusPanel";

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

  if (loading) return <p style={{ color: "#6B6357", marginTop: 16 }}>Loading…</p>;

  if (entry && entry.salonId !== salonId) {
    return (
      <p style={{ color: "#6B6357", marginTop: 16 }}>
        You already have an active queue token at another salon. Finish or cancel it before joining here.
      </p>
    );
  }

  if (entry) {
    return (
      <div style={{ marginTop: 16 }}>
        <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <label style={{ display: "block", marginBottom: 6, color: "#6B6357" }} htmlFor="walkin-service">
        Service (optional)
      </label>
      <select
        id="walkin-service"
        value={selectedServiceId}
        onChange={(e) => setSelectedServiceId(e.target.value)}
        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #E7E0D3", minWidth: 220 }}
      >
        <option value="">Any service</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.durationMinutes} min)
          </option>
        ))}
      </select>

      {error && <p style={{ color: "#E24B4A" }}>{error}</p>}

      <div>
        <button
          type="button"
          onClick={() => void handleJoin()}
          disabled={submitting}
          style={{
            marginTop: 16,
            padding: "10px 20px",
            background: "#B0413E",
            color: "#fff",
            border: "none",
            borderRadius: 8,
          }}
        >
          {submitting ? "Joining…" : "Join the queue"}
        </button>
      </div>
    </div>
  );
}
