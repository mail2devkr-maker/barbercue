"use client";

import type { StaffOptionDto } from "@barbercue/shared";
import styles from "./booking.module.css";

/** selectedStaffId: undefined = nothing chosen yet, null = "Any Staff" explicitly chosen, string = a specific staff id. */
export function StaffStep({
  options,
  selectedStaffId,
  onSelect,
  loading,
}: {
  options: StaffOptionDto[];
  selectedStaffId: string | null | undefined;
  onSelect: (staffId: string | null) => void;
  loading: boolean;
}) {
  if (loading)
    return (
      <section className={styles.stepCard}>
        <p className={styles.stepLoading}>Loading staff…</p>
      </section>
    );

  return (
    <section className={styles.stepCard}>
      <h2 className={styles.stepHeading}>
        <span className={styles.stepNumber}>2</span> Choose a barber
      </h2>
      <p className={styles.stepHint}>
        This is a preference, not a guarantee — the salon assigns the actual barber and chair when you check in.
      </p>
      <div className={styles.chipRow}>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`${styles.chip} ${selectedStaffId === null ? styles.chipSelected : ""}`}
        >
          Any Staff
        </button>
        {options.map((staff) => (
          <button
            key={staff.id}
            type="button"
            onClick={() => onSelect(staff.id)}
            className={`${styles.chip} ${staff.id === selectedStaffId ? styles.chipSelected : ""}`}
          >
            {staff.displayName}
          </button>
        ))}
      </div>
    </section>
  );
}
