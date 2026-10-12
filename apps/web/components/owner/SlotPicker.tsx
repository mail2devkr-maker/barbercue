"use client";

import { useEffect, useMemo, useState } from "react";
import type { AvailabilitySlotDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { formatShopTime } from "./format";
import { Banner, Field } from "./parts";
import ui from "./owner.module.css";

export function todayIn(timeZone: string | null | undefined, offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? undefined }).format(base);
  } catch {
    return base.toISOString().slice(0, 10);
  }
}

/**
 * Pick a date, then one of the REAL bookable times for the chosen services (and barber). The list
 * comes from the same availability engine online customers use, so a slot shown here is one the
 * booking transaction will accept - the form never invites a conflict it could have prevented
 * (the server still re-checks under its per-shop lock).
 */
export function SlotPicker({
  salonId,
  serviceIds,
  staffId,
  timeZone,
  value,
  onChange,
  idPrefix = "slot",
}: {
  salonId: string;
  serviceIds: string[];
  staffId?: string;
  timeZone: string | null;
  value: string | null;
  onChange: (slotStartIso: string | null) => void;
  idPrefix?: string;
}) {
  const [date, setDate] = useState(() => todayIn(timeZone));
  const [slots, setSlots] = useState<AvailabilitySlotDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = serviceIds.join(",");

  useEffect(() => {
    if (!key) {
      setSlots(null);
      return;
    }
    let cancelled = false;
    setSlots(null);
    setError(null);
    const params = new URLSearchParams({ serviceIds: key, date, ...(staffId ? { staffId } : {}) });
    apiFetch<AvailabilitySlotDto[]>(`salons/${salonId}/booking/availability?${params.toString()}`)
      .then((list) => !cancelled && setSlots(list))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load available times."));
    return () => {
      cancelled = true;
    };
  }, [salonId, key, date, staffId]);

  // A previously chosen time that is no longer offered for the new date/barber must not linger.
  useEffect(() => {
    if (value && slots && !slots.some((s) => s.slotStart === value && s.available)) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the offered slots
  }, [slots]);

  const open = useMemo(() => (slots ?? []).filter((s) => s.available), [slots]);

  return (
    <div className={ui.stackSm}>
      <Field label="Date" htmlFor={`${idPrefix}-date`}>
        <input id={`${idPrefix}-date`} type="date" className={ui.input} min={todayIn(timeZone)} value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} />
      </Field>
      <div>
        <div className={ui.label} id={`${idPrefix}-label`}>
          Available times
        </div>
        {!key && <div className={ui.hint}>Choose at least one service to see times.</div>}
        {error && <Banner tone="error">{error}</Banner>}
        {key && !error && slots === null && <div className={ui.hint}>Loading times…</div>}
        {slots && open.length === 0 && <div className={ui.hint}>No free times on this date for the chosen services{staffId ? " and barber" : ""}. Try another date.</div>}
        {open.length > 0 && (
          <div className={ui.rowWrap} role="radiogroup" aria-labelledby={`${idPrefix}-label`} style={{ marginTop: 8 }}>
            {open.map((slot) => (
              <button
                key={slot.slotStart}
                type="button"
                role="radio"
                aria-checked={slot.slotStart === value}
                className={`${ui.btn} ${ui.btnSm} ${slot.slotStart === value ? ui.btnPrimary : ui.btnSecondary}`}
                onClick={() => onChange(slot.slotStart)}
              >
                {formatShopTime(slot.slotStart, timeZone)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
