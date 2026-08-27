import type { ServiceDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";
import styles from "./discovery-content.module.css";

export function ServiceList({
  services,
  currency,
  countryCode,
}: {
  services: ServiceDto[];
  // Threaded from the owning salon: ServiceDto carries a bare amount, and the currency it is
  // denominated in belongs to the salon, not the service.
  currency: string | null;
  countryCode?: string | null;
}) {
  if (services.length === 0) {
    return <div className={styles.empty}>This shop has not listed services yet.</div>;
  }
  return (
    <table className={styles.dataTable}>
      <tbody>
        {services.map((s) => (
          <tr key={s.id}>
            <td>
              <div className={styles.serviceName}>{s.name}</div>
              <div className={styles.serviceDuration}>{s.durationMinutes} min</div>
            </td>
            <td>
              {formatMoney(s.price, currency, countryCode)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
