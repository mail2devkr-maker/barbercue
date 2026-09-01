"use client";

import type { AvailabilitySlotDto } from "@barbercue/shared";
import { formatZonedTime } from "../../lib/salon-time";
import styles from "./booking.module.css";

export function SlotStep({
  slots,
  selectedSlot,
  onSelect,
  loading,
  timeZone,
}: {
  slots: AvailabilitySlotDto[];
  selectedSlot: AvailabilitySlotDto | null;
  onSelect: (slot: AvailabilitySlotDto) => void;
  loading: boolean;
  timeZone: string | null;
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
              aria-label={`${new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}, ${selected ? "your selection" : occupied ? "occupied" : "available"}`}
            >
              {timeZone ? formatZonedTime(slot.slotStart, timeZone) : new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </button>
          );
        })}
      </div>
    </section>
  );
}
