"use client";

import { formatZonedDateTime, type AvailabilitySlotDto } from "@barbercue/shared";
import styles from "./booking.module.css";

export function SlotStep({
  slots,
  selectedSlot,
  onSelect,
  loading,
  salonTimezone,
}: {
  slots: AvailabilitySlotDto[];
  selectedSlot: AvailabilitySlotDto | null;
  onSelect: (slot: AvailabilitySlotDto) => void;
  loading: boolean;
  // Pre-confirmation timezone fix — every slot time renders in the salon's own zone, never the
  // customer device's. Null degrades to the device zone via formatZonedDateTime's own fallback.
  salonTimezone: string | null;
}) {
  if (loading)
    return (
      <section className={styles.stepCard}>
        <p className={styles.stepLoading}>Loading times…</p>
      </section>
    );
  if (slots.length === 0)
    return (
      <section className={styles.stepCard}>
        <p className={styles.stepLoading}>No slots on this day.</p>
      </section>
    );

  return (
    <section className={styles.stepCard}>
      <h2 className={styles.stepHeading}>
        <span className={styles.stepNumber}>4</span> Choose a time
      </h2>
      <div className={styles.slotLegend} aria-label="Time availability legend">
        <span><i className={`${styles.legendSwatch} ${styles.legendAvailable}`} aria-hidden="true" /> Available</span>
        <span><i className={`${styles.legendSwatch} ${styles.legendSelected}`} aria-hidden="true" /> Your selection</span>
        <span><i className={`${styles.legendSwatch} ${styles.legendOccupied}`} aria-hidden="true" /> Occupied</span>
      </div>
      <div className={styles.slotGrid}>
        {slots.map((slot) => {
          const selected = selectedSlot?.slotStart === slot.slotStart;
          const occupied = slot.state === "OCCUPIED" || !slot.available;
          return (
            <button
              key={slot.slotStart}
              type="button"
              disabled={occupied}
              onClick={() => onSelect(slot)}
              className={`${styles.slotChip} ${occupied ? styles.slotChipOccupied : ""} ${selected ? styles.slotChipSelected : ""}`}
              aria-label={`${formatZonedDateTime(slot.slotStart, salonTimezone, undefined, { hour: "2-digit", minute: "2-digit" })}, ${selected ? "your selection" : occupied ? "occupied" : "available"}`}
            >
              {formatZonedDateTime(slot.slotStart, salonTimezone, undefined, { hour: "2-digit", minute: "2-digit" })}
            </button>
          );
        })}
      </div>
    </section>
  );
}
