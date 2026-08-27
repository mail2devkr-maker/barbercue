import type { OperatingHoursDto } from "@barbercue/shared";
import styles from "./discovery-content.module.css";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function OperatingHoursTable({ hours }: { hours: OperatingHoursDto[] }) {
  if (hours.length === 0) {
    return <div className={styles.empty}>This shop has not listed opening hours yet.</div>;
  }
  const byDay = [...hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return (
    <table className={styles.dataTable}>
      <tbody>
        {byDay.map((h) => (
          <tr key={h.dayOfWeek}>
            <td className={styles.hoursDay}>{DAY_LABELS[h.dayOfWeek]}</td>
            <td className={h.isClosed ? styles.closed : undefined}>
              {h.isClosed ? "Closed" : `${h.openTime} – ${h.closeTime}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
