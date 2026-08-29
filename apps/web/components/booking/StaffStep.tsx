"use client";

import type { StaffOptionDto } from "@barbercue/shared";
import { SalonImage } from "../ui/SalonImage";
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

  // Phase 17 (Barber Professional Profile): once at least one barber has a photo or bio, the
  // richer card layout earns its extra space — with none set yet, plain chips (identical to
  // before this phase) stay the honest, uncluttered choice.
  const hasProfiles = options.some((s) => s.photoUrl || s.bio);

  return (
    <section className={styles.stepCard}>
      <h2 className={styles.stepHeading}>
        <span className={styles.stepNumber}>2</span> Choose a barber
      </h2>
      <p className={styles.stepHint}>
        This is a preference, not a guarantee — the salon assigns the actual barber and chair when you check in.
      </p>
      {hasProfiles ? (
        <div className={styles.staffCardRow}>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`${styles.staffCard} ${selectedStaffId === null ? styles.staffCardSelected : ""}`}
          >
            <span className={styles.staffCardName}>Any Staff</span>
          </button>
          {options.map((staff) => (
            <button
              key={staff.id}
              type="button"
              onClick={() => onSelect(staff.id)}
              className={`${styles.staffCard} ${staff.id === selectedStaffId ? styles.staffCardSelected : ""}`}
            >
              <span className={styles.staffCardPhoto}>
                <SalonImage url={staff.photoUrl} alt={staff.displayName} aspectRatio="1 / 1" rounded={10} />
              </span>
              <span className={styles.staffCardName}>{staff.displayName}</span>
              {staff.yearsExperience !== null && (
                <span className={styles.staffCardMeta}>
                  {staff.yearsExperience} yr{staff.yearsExperience === 1 ? "" : "s"} experience
                </span>
              )}
              {staff.bio && <span className={styles.staffCardBio}>{staff.bio}</span>}
            </button>
          ))}
        </div>
      ) : (
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
      )}
    </section>
  );
}
