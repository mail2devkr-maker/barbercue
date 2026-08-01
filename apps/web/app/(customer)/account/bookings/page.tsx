"use client";

import { useEffect, useState } from "react";
import { BOOKING_PATHS } from "@barbercue/shared";
import type { BookingDetailDto, CancelBookingResponseDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { CancelBookingDialog } from "../../../../components/booking/CancelBookingDialog";
import { CheckInPanel, canCheckIn } from "../../../../components/queue/CheckInPanel";

const CANCELLABLE_STATUSES = new Set(["CONFIRMED", "PENDING_PAYMENT"]);

function loadPage(cursor?: string): Promise<PaginatedResult<BookingDetailDto>> {
  const query = cursor ? `?cursor=${cursor}` : "";
  return apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}${query}`);
}

function statusColor(status: string): string {
  if (status === "CONFIRMED") return "#2E7D32";
  if (status === "PENDING_PAYMENT") return "#B36B00";
  if (status === "CANCELLED") return "#8A8377";
  if (status === "COMPLETED") return "#1C1A17";
  return "#6B6357";
}

// Customer account — my bookings. Auth-gated by app/(customer)/account/layout.tsx (Phase 2).
export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<BookingDetailDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingDetailDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        return loadPage();
      })
      .then((result) => {
        if (cancelled || !result) return;
        setBookings(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your bookings. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await loadPage(nextCursor);
      setBookings((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more bookings.");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleCancelled(result: CancelBookingResponseDto) {
    setBookings((prev) => prev.map((b) => (b.id === result.booking.id ? result.booking : b)));
    setCancelTarget(null);
  }

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 700, margin: "0 auto" }}>
      <h1>My bookings</h1>

      {loading && <p style={{ color: "#6B6357" }}>Loading…</p>}
      {error && <p style={{ color: "#E24B4A" }}>{error}</p>}
      {!loading && !error && bookings.length === 0 && (
        <p style={{ color: "#6B6357" }}>You have no bookings yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        {bookings.map((booking) => (
          <div key={booking.id} style={{ border: "1px solid #E7E0D3", borderRadius: 10, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{booking.serviceName}</strong>
              <span style={{ color: statusColor(booking.status), fontWeight: 600 }}>{booking.status}</span>
            </div>
            <p style={{ color: "#6B6357", margin: "4px 0" }}>
              {booking.salonName} — {new Date(booking.slotStart).toLocaleString()}
            </p>
            {booking.preferredStaffName && (
              <p style={{ color: "#6B6357", fontSize: "0.85rem", margin: "4px 0" }}>
                Preferred barber: {booking.preferredStaffName}
              </p>
            )}
            {booking.cancellationChargeAmount !== null && booking.cancellationChargeAmount > 0 && (
              <p style={{ color: "#6B6357", fontSize: "0.85rem", margin: "4px 0" }}>
                Cancellation charge: ₹{booking.cancellationChargeAmount}
              </p>
            )}
            {CANCELLABLE_STATUSES.has(booking.status) && (
              <button
                type="button"
                onClick={() => setCancelTarget(booking)}
                style={{ marginTop: 8, padding: "6px 14px" }}
              >
                Cancel
              </button>
            )}
            {canCheckIn(booking) && <CheckInPanel booking={booking} />}
          </div>
        ))}
      </div>

      {nextCursor && (
        <button type="button" onClick={() => void handleLoadMore()} disabled={loadingMore} style={{ marginTop: 16 }}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}

      {cancelTarget && (
        <CancelBookingDialog
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}
    </main>
  );
}
