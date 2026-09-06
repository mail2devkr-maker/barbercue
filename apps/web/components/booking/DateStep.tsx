"use client";

import { useMemo } from "react";
import {
  addZonedCalendarDays,
  formatZonedCalendarDate,
  zonedDateKey,
  zonedDateToDayOfWeek,
  type OperatingHoursDto,
} from "@barbercue/shared";
import styles from "./booking.module.css";

const DAYS_AHEAD = 30;

export function DateStep({
  operatingHours,
  selectedDate,
  onSelect,
  salonTimezone,
}: {
  operatingHours: OperatingHoursDto[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
  // Pre-confirmation timezone fix — "today" and every subsequent chip are the salon's own
  // calendar dates, never the customer device's (which can genuinely differ near a day boundary
  // when the two are in different zones). Null degrades to the device's own zone via
  // zonedDateKey's own documented fallback, same "incomplete beats wrong" convention as elsewhere.
  salonTimezone: string | null;
}) {
  // Client-side convenience only (which days to grey out) — the server's availability endpoint
  // is the sole authority on what's actually bookable, so day-boundary fuzziness here is cosmetic.
  // The date STRING itself, though, is authoritative input to that endpoint (its `date` query
  // param is interpreted in the salon's own zone server-side) — so unlike the "cosmetic" closed
  // flag, getting the right calendar date here isn't optional.
  const days = useMemo(() => {
    const result: { date: string; weekday: string; dayLabel: string; closed: boolean }[] = [];
    const today = zonedDateKey(new Date().toISOString(), salonTimezone);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = addZonedCalendarDays(today, i);
      const hours = operatingHours.find((h) => h.dayOfWeek === zonedDateToDayOfWeek(date));
      result.push({
        date,
        weekday: formatZonedCalendarDate(date, undefined, { weekday: "short" }),
        dayLabel: formatZonedCalendarDate(date, undefined, { month: "short", day: "numeric" }),
        closed: !hours || hours.isClosed,
      });
    }
    return result;
  }, [operatingHours, salonTimezone]);

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
