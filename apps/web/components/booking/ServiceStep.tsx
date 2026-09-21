"use client";

import type { ServiceDto } from "@barbercue/shared";
import {
  computePercentageDiscountPaise,
  formatMoney,
  numberToPaise,
  paiseToRupees,
  summarizeServiceNames,
} from "@barbercue/shared";
import styles from "./booking.module.css";

function discountedPrice(price: number, percent: number): number {
  const originalPaise = numberToPaise(price);
  return paiseToRupees(
    originalPaise - computePercentageDiscountPaise(originalPaise, percent),
  );
}

// Multi-service booking core mission — a customer may select multiple services for one
// appointment. The combined duration/price shown here is a display-only preview (the backend
// independently re-derives both from serviceIds — see BookingFlow's own comment on this), but it
// must never silently disagree with what the server will actually charge/schedule.
export function ServiceStep({
  services,
  selectedServiceIds,
  onToggle,
  currency,
  countryCode,
  onlineBookingDiscountPercent = 0,
}: {
  services: ServiceDto[];
  selectedServiceIds: string[];
  onToggle: (serviceId: string) => void;
  // Threaded from the owning salon — a service price is denominated in its salon's currency.
  currency: string | null;
  countryCode?: string | null;
  onlineBookingDiscountPercent?: number;
}) {
  const selected = services.filter((s) => selectedServiceIds.includes(s.id));
  const combinedDurationMinutes = selected.reduce((sum, s) => sum + s.durationMinutes, 0);
  const combinedPrice = selected.reduce(
    (sum, s) => sum + discountedPrice(s.price, onlineBookingDiscountPercent),
    0,
  );

  return (
    <section className={styles.stepCard}>
      <h2 className={styles.stepHeading}>
        <span className={styles.stepNumber}>1</span> Choose one or more services
      </h2>
      <div className={styles.serviceList}>
        {services.map((service) => {
          const isSelected = selectedServiceIds.includes(service.id);
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => onToggle(service.id)}
              aria-pressed={isSelected}
              className={`${styles.optionRow} ${isSelected ? styles.optionRowSelected : ""}`}
            >
              <div className={styles.optionRowHead}>
                <span className={styles.optionRowHeadWithCheck}>
                  <span className={styles.optionCheck} aria-hidden="true">
                    {isSelected ? "✓" : ""}
                  </span>
                  <span className={styles.optionName}>{service.name}</span>
                </span>
                <span className={styles.optionPrice}>
                  {onlineBookingDiscountPercent > 0 ? (
                    <>
                      <span style={{ textDecoration: "line-through", opacity: 0.6, marginRight: 6 }}>
                        {formatMoney(service.price, currency, countryCode)}
                      </span>
                      <strong>
                        {formatMoney(
                          discountedPrice(service.price, onlineBookingDiscountPercent),
                          currency,
                          countryCode,
                        )}
                      </strong>
                    </>
                  ) : (
                    formatMoney(service.price, currency, countryCode)
                  )}
                </span>
              </div>
              <div className={styles.optionMeta}>{service.durationMinutes} min</div>
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className={styles.selectionSummary}>
          <span className={styles.selectionSummaryNames}>
            {summarizeServiceNames(selected.map((s) => s.name))}
          </span>
          <span className={styles.selectionSummaryTotals}>
            {combinedDurationMinutes} min · {formatMoney(combinedPrice, currency, countryCode)}
            {onlineBookingDiscountPercent > 0 ? ` · ${onlineBookingDiscountPercent}% FastQue offer` : ""}
          </span>
        </div>
      )}
    </section>
  );
}
