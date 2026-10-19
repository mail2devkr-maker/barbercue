"use client";

import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerCustomerServiceHistoryItemDto } from "@barbercue/shared";
import { Button } from "../ui/Button";
import { useCursorList } from "../../lib/use-cursor-list";
import { serviceAmountText, serviceHistoryErrorText, serviceSourceLabel } from "../../lib/customer-crm";
import styles from "./dashboard.module.css";

const OPTIONS = { mismatchCodes: ["INVALID_FILTER"] as const, errorText: serviceHistoryErrorText };
const NO_PARAMS: Record<string, string> = {};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Completed services for one customer at this shop, one row per completed service (a booking service or a service session of a
 * standalone Live Queue visit). The amount is the line total of the one matching issued invoice; it is billed value, not proof
 * of collection, and it is "No invoice line recorded" when the server found no unambiguous invoice line.
 */
export function CustomerServiceHistory({ salonId, customerId }: { salonId: string; customerId: string }) {
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}/${customerId}/services`;
  const list = useCursorList<OwnerCustomerServiceHistoryItemDto>(path, NO_PARAMS, true, OPTIONS);

  return (
    <section aria-label="Completed services">
      <h2 className={styles.sectionHeading}>Completed services</h2>
      <p className={styles.rowMeta}>
        Each service this customer finished at your shop. An amount is what the shop invoiced for that service, not proof it was
        collected; what was actually recorded as collected is shown in the visit history below.
      </p>
      {list.notice && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{list.notice}</p>}
      {list.error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{list.error}</p>}
      {list.loading && <p className={styles.loadingText}>Loading services…</p>}
      {!list.loading && !list.error && list.items.length === 0 && (
        <p className={styles.emptyState}>No completed services recorded for this customer yet.</p>
      )}
      {list.items.length > 0 && (
        <ul className={styles.rowList}>
          {list.items.map((item) => (
            <li key={item.id} className={styles.row} style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div>
                <span className={styles.rowTitle}>{item.serviceName}</span>
              </div>
              <div className={styles.rowMeta}>
                {formatDate(item.completedAt ?? item.date)} · {serviceSourceLabel(item.source)}
                {item.staffName && ` · With ${item.staffName}`}
                {" · "}
                {serviceAmountText(item)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.hasMore && (
        <Button type="button" variant="outline" onClick={list.loadMore} disabled={list.loadingMore || list.loading}>
          {list.loadingMore ? "Loading…" : "Show more services"}
        </Button>
      )}
    </section>
  );
}
