"use client";

import { useState } from "react";
import { BOOKING_PATHS, type BookingDetailDto, type QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import { QueueStatusPanel } from "./QueueStatusPanel";
import styles from "./queue.module.css";

// Mirrors the backend's EARLY_CHECKIN_WINDOW_MINUTES (queue.service.ts) — a UI convenience only;
// the backend remains authoritative and re-validates on the actual check-in request.
const EARLY_CHECKIN_WINDOW_MINUTES = 15;

export function canCheckIn(booking: BookingDetailDto): boolean {
  if (booking.status !== "CONFIRMED") return false;
  const minutesUntilSlot = (new Date(booking.slotStart).getTime() - Date.now()) / 60_000;
  return minutesUntilSlot <= EARLY_CHECKIN_WINDOW_MINUTES;
}

/** Once checked in, a booking can never be checked in again (the backend keys ALREADY_CHECKED_IN
 * off the booking, not the entry's current status) — so this never reverts to the button, even
 * after the resulting QueueEntry reaches a terminal state. */
export function CheckInPanel({ booking }: { booking: BookingDetailDto }) {
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckIn() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(
        `${BOOKING_PATHS.bookings}/${booking.id}/${BOOKING_PATHS.checkIn}`,
        { method: "POST", headers: { "Idempotency-Key": newIdempotencyKey() } },
      );
      setEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (entry) {
    return <QueueStatusPanel entry={entry} onEntryChange={setEntry} />;
  }

  return (
    <div style={{ marginTop: 12 }}>
      {error && <p className={styles.errorText}>{error}</p>}
      <Button type="button" variant="outline" onClick={() => void handleCheckIn()} disabled={submitting}>
        {submitting ? "Checking in…" : "Check in"}
      </Button>
    </div>
  );
}
