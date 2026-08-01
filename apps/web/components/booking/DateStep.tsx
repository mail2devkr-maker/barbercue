"use client";

import { useMemo } from "react";
import type { OperatingHoursDto } from "@barbercue/shared";

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
    const result: { date: string; label: string; closed: boolean }[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const hours = operatingHours.find((h) => h.dayOfWeek === d.getDay());
      result.push({
        date: iso,
        label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        closed: !hours || hours.isClosed,
      });
    }
    return result;
  }, [operatingHours]);

  return (
    <section>
      <h2 style={{ fontSize: "1.1rem" }}>3. Choose a date</h2>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginTop: 12 }}>
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            disabled={day.closed}
            onClick={() => onSelect(day.date)}
            style={{
              flex: "0 0 auto",
              padding: "10px 14px",
              borderRadius: 10,
              border: day.date === selectedDate ? "2px solid #B0413E" : "1px solid #E7E0D3",
              background: day.closed ? "#F3EFE7" : day.date === selectedDate ? "#FBEFEE" : "#fff",
              color: day.closed ? "#B4AC9C" : "#1C1A17",
              cursor: day.closed ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {day.label}
            {day.closed && <div style={{ fontSize: "0.7rem" }}>Closed</div>}
          </button>
        ))}
      </div>
    </section>
  );
}
