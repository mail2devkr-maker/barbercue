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
      <div className={styles.slotGrid}>
        {slots.map((slot) => {
          const selected = selectedSlot?.slotStart === slot.slotStart;
          return (
            <button
              key={slot.slotStart}
              type="button"
              disabled={!slot.available}
              onClick={() => onSelect(slot)}
              className={`${styles.slotChip} ${selected ? styles.slotChipSelected : ""}`}
            >
              {timeZone ? formatZonedTime(slot.slotStart, timeZone) : new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </button>
          );
        })}
      </div>
    </section>
  );
}
