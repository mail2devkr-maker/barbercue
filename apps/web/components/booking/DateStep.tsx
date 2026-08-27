"use client";

import { useMemo } from "react";
import type { OperatingHoursDto } from "@barbercue/shared";
import styles from "./booking.module.css";

const DAYS_AHEAD = 30;

export function DateStep({
  operatingHours,
  selectedDate,
  onSelect,
}: {
  operatingHours: OperatingHoursDto[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  // Client-side convenience only (which days to grey out) — the server's availability endpoint
  // is the sole authority on what's actually bookable, so day-boundary fuzziness here is cosmetic.
  const days = useMemo(() => {
    const result: { date: string; weekday: string; dayLabel: string; closed: boolean }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const hours = operatingHours.find((h) => h.dayOfWeek === d.getDay());
      result.push({
        date: iso,
        weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
        dayLabel: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        closed: !hours || hours.isClosed,
      });
    }
    return result;
  }, [operatingHours]);

  return (
    <section className={styles.stepCard}>
      <h2 className={styles.stepHeading}>
        <span className={styles.stepNumber}>3</span> Choose a date
      </h2>
      <div className={styles.chipRowScroll}>
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            disabled={day.closed}
            onClick={() => onSelect(day.date)}
            className={`${styles.dateChip} ${day.date === selectedDate ? styles.dateChipSelected : ""}`}
          >
            <span className={styles.dateChipWeekday}>{day.weekday}</span>
            <span className={styles.dateChipDay}>{day.dayLabel}</span>
            {day.closed && <span className={styles.dateChipClosed}>Closed</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
