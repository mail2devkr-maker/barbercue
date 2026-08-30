"use client";

import { useEffect, useState } from "react";
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  computeCancellationCharge,
  formatMoney,
  type BookingDetailDto,
  type CancelBookingResponseDto,
  type CancellationPolicyDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { formatZonedDateTime } from "../../lib/salon-time";
import { Button } from "../ui/Button";
import styles from "./booking.module.css";

/**
 * Reused by both the post-confirm booking view and the "my bookings" list. Fetches the salon's
 * effective cancellation policy itself (rather than requiring the parent to already have it) and
 * computes a live preview with the shared `computeCancellationCharge` — the exact same function
 * the backend uses authoritatively at actual-cancel time (packages/shared/src/calc).
 */
export function CancelBookingDialog({
  booking,
  onCancelled,
  onClose,
}: {
  booking: BookingDetailDto;
  onCancelled: (result: CancelBookingResponseDto) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` (also used for a failed *confirm* attempt, which should stay retryable)
  // — this specifically blocks Confirm cancellation while the preview never loaded, since without
  // it the button stayed clickable and just reproduced the identical failure a second time on the
  // real cancel call, showing the customer two confusing errors in a row for one root cause.
  const [previewFailed, setPreviewFailed] = useState(false);

  // Date.now() is impure, so it belongs here (an effect, run after render) rather than computed
  // directly in the render body — see React's rules-of-hooks "purity" requirement.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() =>
        apiFetch<CancellationPolicyDto>(
          `${DISCOVERY_PATHS.salons}/${booking.salonId}/booking/${SALON_BOOKING_INFO_PATHS.cancellationPolicy}`,
        ),
      )
      .then((policy) => {
        if (cancelled) return;
        const minutesUntilSlot = (new Date(booking.slotStart).getTime() - Date.now()) / 60_000;
        setPreview(computeCancellationCharge(policy, booking.servicePrice, minutesUntilSlot, false));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewFailed(true);
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not load the cancellation policy. Please check your connection and try again.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [booking.salonId, booking.slotStart, booking.servicePrice]);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<CancelBookingResponseDto>(
        `${BOOKING_PATHS.bookings}/${booking.id}/${BOOKING_PATHS.cancel}`,
        { method: "POST", headers: { "Idempotency-Key": newIdempotencyKey() } },
      );
      onCancelled(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel this booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.dialogOverlay}>
      <div className={styles.dialogCard}>
        <h3 className={styles.dialogTitle}>Cancel booking?</h3>
        <p className={styles.summaryLine}>
          {booking.serviceName} at {booking.salonName},{" "}
          {booking.salonTimeZone
            ? formatZonedDateTime(booking.slotStart, booking.salonTimeZone)
            : new Date(booking.slotStart).toLocaleString()}
        </p>
        {loading && <p className={styles.stepLoading}>Checking the cancellation policy…</p>}
        {!loading && preview !== null && preview > 0 && (
          <p className={styles.summaryLine}>
            Cancelling now will charge <strong>{formatMoney(preview, booking.currency)}</strong> (outside the free cancellation window).
          </p>
        )}
        {!loading && preview === 0 && <p className={styles.summaryLine}>No charge — you&apos;re within the free cancellation window.</p>}
        {error && <p className={styles.errorText}>{error}</p>}
        <div className={styles.dialogActions}>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Keep booking
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={submitting || loading || previewFailed}
          >
            {submitting ? "Cancelling…" : "Confirm cancellation"}
          </Button>
        </div>
      </div>
    </div>
  );
}
