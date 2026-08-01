"use client";

import { useEffect, useState } from "react";
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  computeCancellationCharge,
  type BookingDetailDto,
  type CancelBookingResponseDto,
  type CancellationPolicyDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";

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
      .catch(() => {
        if (!cancelled) setError("Could not load the cancellation policy.");
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,26,23,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 360, width: "90%" }}>
        <h3 style={{ marginTop: 0 }}>Cancel booking?</h3>
        <p style={{ color: "#6B6357" }}>
          {booking.serviceName} at {booking.salonName}, {new Date(booking.slotStart).toLocaleString()}
        </p>
        {loading && <p style={{ color: "#6B6357" }}>Checking the cancellation policy…</p>}
        {!loading && preview !== null && preview > 0 && (
          <p>
            Cancelling now will charge <strong>₹{preview}</strong> (outside the free cancellation window).
          </p>
        )}
        {!loading && preview === 0 && <p>No charge — you&apos;re within the free cancellation window.</p>}
        {error && <p style={{ color: "#E24B4A" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={submitting} style={{ padding: "8px 16px" }}>
            Keep booking
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || loading}
            style={{ padding: "8px 16px", background: "#B0413E", color: "#fff", border: "none", borderRadius: 8 }}
          >
            {submitting ? "Cancelling…" : "Confirm cancellation"}
          </button>
        </div>
      </div>
    </div>
  );
}
