"use client";

import type { AvailabilitySlotDto } from "@barbercue/shared";

export function SlotStep({
  slots,
  selectedSlot,
  onSelect,
  loading,
}: {
  slots: AvailabilitySlotDto[];
  selectedSlot: AvailabilitySlotDto | null;
  onSelect: (slot: AvailabilitySlotDto) => void;
  loading: boolean;
}) {
  if (loading) return <p style={{ color: "#6B6357" }}>Loading times…</p>;
  if (slots.length === 0) return <p style={{ color: "#6B6357" }}>No slots on this day.</p>;

  return (
    <section>
      <h2 style={{ fontSize: "1.1rem" }}>4. Choose a time</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8, marginTop: 12 }}>
        {slots.map((slot) => {
          const selected = selectedSlot?.slotStart === slot.slotStart;
          return (
            <button
              key={slot.slotStart}
              type="button"
              disabled={!slot.available}
              onClick={() => onSelect(slot)}
              style={{
                padding: "8px 4px",
                borderRadius: 8,
                border: selected ? "2px solid #B0413E" : "1px solid #E7E0D3",
                background: !slot.available ? "#F3EFE7" : selected ? "#FBEFEE" : "#fff",
                color: !slot.available ? "#B4AC9C" : "#1C1A17",
                cursor: slot.available ? "pointer" : "not-allowed",
              }}
            >
              {new Date(slot.slotStart).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </button>
          );
        })}
      </div>
    </section>
  );
}
