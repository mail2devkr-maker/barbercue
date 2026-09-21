import type { ServiceDto } from "@barbercue/shared";
import {
  computePercentageDiscountPaise,
  formatMoney,
  numberToPaise,
  paiseToRupees,
} from "@barbercue/shared";
import styles from "./discovery-content.module.css";

function discountedPrice(price: number, percent: number): number {
  const originalPaise = numberToPaise(price);
  return paiseToRupees(
    originalPaise - computePercentageDiscountPaise(originalPaise, percent),
  );
}

export function ServiceList({
  services,
  currency,
  countryCode,
  onlineBookingDiscountPercent = 0,
}: {
  services: ServiceDto[];
  // Threaded from the owning salon: ServiceDto carries a bare amount, and the currency it is
  // denominated in belongs to the salon, not the service.
  currency: string | null;
  countryCode?: string | null;
  onlineBookingDiscountPercent?: number;
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
              {onlineBookingDiscountPercent > 0 ? (
                <span>
                  <span style={{ textDecoration: "line-through", opacity: 0.6, marginRight: 8 }}>
                    {formatMoney(s.price, currency, countryCode)}
                  </span>
                  <strong>
                    {formatMoney(
                      discountedPrice(s.price, onlineBookingDiscountPercent),
                      currency,
                      countryCode,
                    )}
                  </strong>{" "}
                  <small>{onlineBookingDiscountPercent}% OFF on FastQue booking</small>
                </span>
              ) : (
                formatMoney(s.price, currency, countryCode)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
