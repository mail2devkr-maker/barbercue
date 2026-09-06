"use client";

import { useEffect, useState } from "react";
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  addZonedCalendarDays,
  formatBookingArrivalTime,
  formatZonedCalendarDate,
  formatZonedDateTime,
  zonedDateKey,
  type AvailabilitySlotDto,
  type BookingDetailDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import styles from "./booking.module.css";

const DAYS_AHEAD = 14;

// Pre-confirmation timezone fix — same salon-local "today + N days" construction as DateStep,
// seeded from the booking's own salonTimezone (already resolved server-side, no new lookup here).
function nextDays(salonTimezone: string | null): { date: string; weekday: string; dayLabel: string }[] {
  const result: { date: string; weekday: string; dayLabel: string }[] = [];
  const today = zonedDateKey(new Date().toISOString(), salonTimezone);
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = addZonedCalendarDays(today, i);
    result.push({
      date,
      weekday: formatZonedCalendarDate(date, undefined, { weekday: "short" }),
      dayLabel: formatZonedCalendarDate(date, undefined, { month: "short", day: "numeric" }),
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
  const days = nextDays(booking.salonTimezone);

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
      // The slot grid is advisory; the reschedule transaction is authoritative. If another
      // booking took this slot concurrently, drop the stale selection and reload the grid so the
      // now-occupied time shows disabled instead of staying selectable.
      if (err instanceof ApiError && err.code === "SLOT_FULL" && selectedDate) {
        setSelectedSlot(null);
        const params = new URLSearchParams({ serviceId: booking.serviceId, date: selectedDate });
        if (booking.preferredStaffId) params.set("staffId", booking.preferredStaffId);
        void apiFetch<AvailabilitySlotDto[]>(
          `${DISCOVERY_PATHS.salons}/${booking.salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params}`,
        )
          .then(setSlots)
          .catch(() => undefined);
      }
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
          {booking.serviceName} at {booking.salonName} — currently{" "}
          {(() => {
            const current = formatBookingArrivalTime(booking.slotStart, booking.salonTimezone);
            return `${current.date}, ${current.time}${!current.isDeviceLocalTimezone ? " (shop's local time)" : ""}`;
          })()}
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
              <>
                <div className={styles.slotLegend} aria-label="Time availability legend">
                  <span><i className={`${styles.legendSwatch} ${styles.legendAvailable}`} aria-hidden="true" /> Available</span>
                  <span><i className={`${styles.legendSwatch} ${styles.legendSelected}`} aria-hidden="true" /> Your selection</span>
                  <span><i className={`${styles.legendSwatch} ${styles.legendOccupied}`} aria-hidden="true" /> Occupied</span>
                </div>
                <div className={styles.slotGrid}>
                  {slots.map((slot) => {
                    const occupied = slot.state === "OCCUPIED" || !slot.available;
                    return (
                      <button
                        key={slot.slotStart}
                        type="button"
                        disabled={occupied}
                        onClick={() => setSelectedSlot(slot)}
                        className={`${styles.slotChip} ${occupied ? styles.slotChipOccupied : ""} ${selectedSlot?.slotStart === slot.slotStart ? styles.slotChipSelected : ""}`}
                      >
                        {formatZonedDateTime(slot.slotStart, booking.salonTimezone, undefined, { hour: "2-digit", minute: "2-digit" })}
                      </button>
                    );
                  })}
                </div>
              </>
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
