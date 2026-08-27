import type { OperatingHoursDto } from "@barbercue/shared";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function OperatingHoursTable({ hours }: { hours: OperatingHoursDto[] }) {
  if (hours.length === 0) {
    return <p style={{ color: "var(--bc-muted)" }}>Hours not listed yet.</p>;
  }
  const byDay = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {byDay.map((h) => (
          <tr key={h.dayOfWeek} style={{ borderBottom: "1px solid var(--bc-border)" }}>
            <td style={{ padding: "9px 0", color: "var(--bc-ink)", fontWeight: 500 }}>{DAY_LABELS[h.dayOfWeek]}</td>
            <td style={{ padding: "9px 0", textAlign: "right", color: h.isClosed ? "#E24B4A" : "var(--bc-muted)" }}>
              {h.isClosed ? "Closed" : `${h.openTime} – ${h.closeTime}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
