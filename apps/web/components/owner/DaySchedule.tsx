"use client";

import { useEffect, useMemo, useRef } from "react";
import type { OwnerScheduleItemDto } from "@barbercue/shared";
import { formatShopTime } from "./format";
import { buildScheduleLayout, CATEGORY_PALETTE, localMinutes, paletteIndex, PX_PER_HOUR } from "./schedule-layout";
import ui from "./owner.module.css";

const STATUS_NOTE: Record<string, string> = { COMPLETED: "Done", NO_SHOW: "No-show", CANCELLED: "Cancelled" };
const VIEW_HEIGHT = 420;

/**
 * Today's appointments as a timeline: the hours down the side, one column per barber, and each
 * appointment drawn at its real time and length, coloured by service category. It shows only what is
 * booked - times, people and services come straight from the bookings; nothing is filled in. A long
 * day scrolls inside the card, opening at the next appointment, with a marker for the current time.
 */
export function DaySchedule({ items, timeZone, staffNames }: { items: OwnerScheduleItemDto[]; timeZone: string; staffNames: string[] }) {
  const layout = useMemo(() => buildScheduleLayout(items, timeZone, staffNames), [items, timeZone, staffNames]);
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of items) {
      const name = item.category?.trim() || "Other";
      if (!seen.has(name)) seen.set(name, paletteIndex(item.category));
    }
    return [...seen.entries()];
  }, [items]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const height = layout.hours.length * PX_PER_HOUR;
  const cols = Math.max(layout.columns.length, 1);
  const template = `52px repeat(${cols}, minmax(110px, 1fr))`;
  const nowMinutes = localMinutes(new Date().toISOString(), timeZone) - layout.startHour * 60;
  const nowTop = nowMinutes >= 0 && nowMinutes <= layout.hours.length * 60 ? (nowMinutes / 60) * PX_PER_HOUR : null;

  // Open on the next appointment that has not finished yet (or the last one of the day).
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || layout.blocks.length === 0) return;
    const upcoming = layout.blocks.filter((b) => b.top + b.height >= nowMinutes).sort((a, b) => a.top - b.top)[0];
    const target = upcoming ?? [...layout.blocks].sort((a, b) => b.top - a.top)[0];
    node.scrollTop = Math.max(0, (target.top / 60) * PX_PER_HOUR - 28);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position once per data set, never fight the user's scrolling
  }, [layout]);

  return (
    <div className={ui.daySchedule}>
      <div className={ui.dayLegend} aria-label="Service categories">
        {categories.map(([name, index]) => (
          <span key={name} className={ui.dayLegendItem}>
            <span className={ui.dayLegendDot} style={{ background: CATEGORY_PALETTE[index].dot }} />
            {name}
          </span>
        ))}
      </div>
      <div className={ui.dayScroll} ref={scrollRef} style={{ maxHeight: VIEW_HEIGHT }} tabIndex={0} role="region" aria-label="Today's appointments by barber (scrollable)">
        <div className={ui.dayGrid} style={{ gridTemplateColumns: template }} role="table">
          <div className={ui.dayHours} style={{ height }} role="rowgroup">
            {layout.hours.map((h) => (
              <div key={h} className={ui.dayHour} style={{ height: PX_PER_HOUR }} role="row">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {layout.columns.map((name) => (
            <div key={name} className={ui.dayColumn} style={{ height }} role="rowgroup" aria-label={name}>
              {layout.hours.map((h) => (
                <div key={h} className={ui.dayCell} style={{ height: PX_PER_HOUR }} aria-hidden="true" />
              ))}
              {layout.blocks
                .filter((b) => b.column === name)
                .map((b) => {
                  const color = CATEGORY_PALETTE[paletteIndex(b.item.category)];
                  const note = STATUS_NOTE[b.item.status];
                  return (
                    <div
                      key={b.id}
                      role="row"
                      className={ui.dayBlock}
                      style={{ top: (b.top / 60) * PX_PER_HOUR + 2, height: (b.height / 60) * PX_PER_HOUR - 4, background: color.bg, color: color.ink }}
                      title={`${formatShopTime(b.item.slotStart, timeZone)} - ${formatShopTime(b.item.slotEnd, timeZone)} · ${b.item.customerLabel} · ${b.item.serviceNames.join(" + ")}`}
                    >
                      <strong className={ui.dayBlockName}>{b.item.customerLabel}</strong>
                      <span className={ui.dayBlockSub}>
                        {`${formatShopTime(b.item.slotStart, timeZone)} · ${b.item.serviceNames.join(" + ")}${b.item.source === "IN_SHOP" ? " · In-shop" : ""}${note ? ` · ${note}` : ""}`}
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
          {nowTop !== null && (
            <div className={ui.dayNow} style={{ top: nowTop }} aria-hidden="true">
              <span className={ui.dayNowDot} />
            </div>
          )}
        </div>
        <div className={ui.dayNames} style={{ gridTemplateColumns: template }}>
          <div aria-hidden="true" />
          {layout.columns.map((name) => (
            <div key={name} className={ui.dayColumnName}>
              {name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
