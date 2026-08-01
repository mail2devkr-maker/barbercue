"use client";

import type { StaffOptionDto } from "@barbercue/shared";

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
  if (loading) return <p style={{ color: "#6B6357" }}>Loading staff…</p>;

  return (
    <section>
      <h2 style={{ fontSize: "1.1rem" }}>2. Choose a barber</h2>
      <p style={{ color: "#6B6357", fontSize: "0.85rem" }}>
        This is a preference, not a guarantee — the salon assigns the actual barber and chair when you check in.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => onSelect(null)}
          style={optionStyle(selectedStaffId === null)}
        >
          Any Staff
        </button>
        {options.map((staff) => (
          <button
            key={staff.id}
            type="button"
            onClick={() => onSelect(staff.id)}
            style={optionStyle(staff.id === selectedStaffId)}
          >
            {staff.displayName}
          </button>
        ))}
      </div>
    </section>
  );
}

function optionStyle(selected: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 20,
    border: selected ? "2px solid #B0413E" : "1px solid #E7E0D3",
    background: selected ? "#FBEFEE" : "#fff",
    cursor: "pointer",
  };
}
