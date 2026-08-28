"use client";

import { useEffect, useState } from "react";
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  type AvailabilitySlotDto,
  type BookingDetailDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import styles from "./booking.module.css";

const DAYS_AHEAD = 14;

function nextDays(): { date: string; weekday: string; dayLabel: string }[] {
  const result: { date: string; weekday: string; dayLabel: string }[] = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    result.push({
      date: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
      dayLabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    });
  }
  return result;
}

// Only the slot moves — same service, same salon, same preferred barber as the original booking
// (a different service/salon is a new booking, not a reschedule). Unlike BookingFlow's full
// service->staff->date->slot wizard, this only needs date+time, so it doesn't reuse DateStep (which
// requires OperatingHoursDto to grey out closed days) — the server's own
// availability/assertWithinOperatingHours checks are authoritative regardless, so an unavailable
// day just comes back with an empty slot list rather than being pre-greyed client-side.
export function RescheduleBookingDialog({
  booking,
  onRescheduled,
  onClose,
}: {
  booking: BookingDetailDto;
  onRescheduled: (updated: BookingDetailDto) => void;
  onClose: () => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlotDto | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = nextDays();

  useEffect(() => {
    if (!selectedDate) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setSlotsLoading(true);
        const params = new URLSearchParams({ serviceId: booking.serviceId, date: selectedDate });
        if (booking.preferredStaffId) params.set("staffId", booking.preferredStaffId);
        return apiFetch<AvailabilitySlotDto[]>(
          `${DISCOVERY_PATHS.salons}/${booking.salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params}`,
        );
      })
      .then((result) => {
        if (!cancelled && result) setSlots(result);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, booking.salonId, booking.serviceId, booking.preferredStaffId]);

  async function handleConfirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<BookingDetailDto>(
        `${BOOKING_PATHS.bookings}/${booking.id}/${BOOKING_PATHS.reschedule}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": newIdempotencyKey() },
          body: JSON.stringify({ slotStart: selectedSlot.slotStart }),
        },
      );
      onRescheduled(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reschedule this booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.dialogOverlay}>
      <div className={styles.dialogCard}>
        <h3 className={styles.dialogTitle}>Reschedule booking</h3>
        <p className={styles.summaryLine}>
          {booking.serviceName} at {booking.salonName} — currently {new Date(booking.slotStart).toLocaleString()}
        </p>

        <div className={styles.chipRowScroll}>
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() => {
                setSelectedDate(day.date);
                setSelectedSlot(null);
              }}
              className={`${styles.dateChip} ${day.date === selectedDate ? styles.dateChipSelected : ""}`}
            >
              <span className={styles.dateChipWeekday}>{day.weekday}</span>
              <span className={styles.dateChipDay}>{day.dayLabel}</span>
            </button>
          ))}
        </div>

        {selectedDate && (
          <>
            {slotsLoading && <p className={styles.stepLoading}>Loading times…</p>}
            {!slotsLoading && slots.length === 0 && <p className={styles.stepLoading}>No slots on this day.</p>}
            {!slotsLoading && slots.length > 0 && (
              <div className={styles.slotGrid}>
                {slots.map((slot) => (
                  <button
                    key={slot.slotStart}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => setSelectedSlot(slot)}
                    className={`${styles.slotChip} ${selectedSlot?.slotStart === slot.slotStart ? styles.slotChipSelected : ""}`}
                  >
                    {new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.dialogActions}>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Keep current time
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleConfirm()} disabled={submitting || !selectedSlot}>
            {submitting ? "Rescheduling…" : "Confirm new time"}
          </Button>
        </div>
      </div>
    </div>
  );
}
