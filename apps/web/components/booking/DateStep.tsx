"use client";

import { useMemo } from "react";
import type { OperatingHoursDto } from "@barbercue/shared";
import { addZonedDays, todayInZone, zonedDayLabel, zonedDayOfWeek, zonedWeekdayLabel } from "../../lib/salon-time";
import styles from "./booking.module.css";

const DAYS_AHEAD = 30;

export function DateStep({
  operatingHours,
  selectedDate,
  onSelect,
  timeZone,
}: {
  operatingHours: OperatingHoursDto[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  // The salon's own IANA zone — every generated date/label below is derived entirely from this
  // (never the viewer's browser clock/timezone), so the value actually sent to the availability
  // API always matches the label the customer clicked. Falls back to UTC-anchored generation only
  // when the salon has no resolvable timezone (matches the backend's own honest-unknown handling).
  timeZone: string | null;
}) {
  // The DATE VALUE (sent to the API) and its LABEL must come from the exact same zoned source —
  // previously the value was UTC-sliced (`toISOString()`) while the label was browser-local
  // (`toLocaleDateString(undefined, ...)`), which could silently disagree by a day depending on
  // the viewer's own clock, making the button say one date while booking a different one.
  const days = useMemo(() => {
    const zone = timeZone ?? "UTC";
    const result: { date: string; weekday: string; dayLabel: string; closed: boolean }[] = [];
    const start = todayInZone(zone);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = addZonedDays(start, i);
      const hours = operatingHours.find((h) => h.dayOfWeek === zonedDayOfWeek(date));
      result.push({
        date,
        weekday: zonedWeekdayLabel(date),
        dayLabel: zonedDayLabel(date),
        closed: !hours || hours.isClosed,
      });
    }
    return result;
  }, [operatingHours, timeZone]);

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
