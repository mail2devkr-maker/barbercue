"use client";

import type { ServiceDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";
import styles from "./booking.module.css";

export function ServiceStep({
  services,
  selectedServiceId,
  onSelect,
  currency,
  countryCode,
}: {
  services: ServiceDto[];
  selectedServiceId: string | null;
  onSelect: (serviceId: string) => void;
  // Threaded from the owning salon — a service price is denominated in its salon's currency.
  currency: string | null;
  countryCode?: string | null;
}) {
  return (
    <section className={styles.stepCard}>
      <h2 className={styles.stepHeading}>
        <span className={styles.stepNumber}>1</span> Choose a service
      </h2>
      <div className={styles.serviceList}>
        {services.map((service) => {
          const selected = service.id === selectedServiceId;
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => onSelect(service.id)}
              className={`${styles.optionRow} ${selected ? styles.optionRowSelected : ""}`}
            >
              <div className={styles.optionRowHead}>
                <span className={styles.optionName}>{service.name}</span>
                <span className={styles.optionPrice}>{formatMoney(service.price, currency, countryCode)}</span>
              </div>
              <div className={styles.optionMeta}>{service.durationMinutes} min</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
