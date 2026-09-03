"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CANCELLATION_COURTESY_WAIVER_LIMIT,
  DASHBOARD_PATHS,
  NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT,
  formatMoney,
  type CustomerLedgerEntryDto,
  type LedgerActionResultDto,
  type OwnerCustomerSummaryDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../../lib/api";
import { Button } from "../../../../../../../components/ui/Button";
import styles from "../../../../../../../components/dashboard/dashboard.module.css";

const SEGMENT_LABEL: Record<string, string> = {
  new: "New",
  repeat: "Repeat",
  frequent: "Frequent",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function reasonLabel(reason: string): string {
  return reason === "NO_SHOW_CHARGE" ? "No-show due" : "Cancellation charge";
}

function customerPath(salonId: string, customerId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}/${customerId}`;
}

function ledgerActionPath(
  salonId: string,
  customerId: string,
  entry: CustomerLedgerEntryDto,
  action: "waive" | "restore",
): string {
  const base = `${customerPath(salonId, customerId)}/${DASHBOARD_PATHS.ledger}/${entry.id}`;
  if (entry.reason === "CANCELLATION_CHARGE") {
    return `${base}/cancellation-courtesy/${action}`;
  }
  const verb = action === "waive" ? DASHBOARD_PATHS.waive : DASHBOARD_PATHS.restore;
  return `${base}/${verb}`;
}

/**
 * Owner customer detail — keeps the two retention policies deliberately separate:
 * - New Customer No-Show Grace: fewer than 3 completed visits.
 * - Cancellation Courtesy: up to 5 currently-waived late-cancellation charges per customer/salon.
 * Both are explicit owner actions and both preserve the original ledger row for auditability.
 */
export default function DashboardCustomerDetailPage({
  params,
}: {
  params: Promise<{ salonId: string; customerId: string }>;
}) {
  const { salonId, customerId } = use(params);
  const [summary, setSummary] = useState<OwnerCustomerSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<{
    entry: CustomerLedgerEntryDto;
    action: "waive" | "restore";
  } | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return apiFetch<OwnerCustomerSummaryDto>(customerPath(salonId, customerId))
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load this customer."))
      .finally(() => setLoading(false));
  }, [salonId, customerId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function applyLedgerResult(result: LedgerActionResultDto) {
    setSummary((prev) => {
      if (!prev) return prev;
      const outstandingTotalAmount = prev.ledgerEntries
        .map((e) => (e.id === result.ledgerEntry.id ? result.ledgerEntry : e))
        .filter((e) => e.status === "OUTSTANDING")
        .reduce((sum, e) => sum + e.amount, 0);
      return {
        ...prev,
        outstandingTotalAmount,
        ledgerEntries: prev.ledgerEntries.map((e) => (e.id === result.ledgerEntry.id ? result.ledgerEntry : e)),
      };
    });
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      const result = await apiFetch<LedgerActionResultDto>(
        ledgerActionPath(salonId, customerId, pendingAction.entry, pendingAction.action),
        { method: "POST" },
      );
      applyLedgerResult(result);
      setPendingAction(null);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : `Could not ${pendingAction.action} this due. Please try again.`,
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <p className={styles.loadingText}>Loading…</p>
      </main>
    );
  }
  if (error || !summary) {
    return (
      <main className={styles.page}>
        <Link href={`/${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}`} className={styles.backLink}>
          ← Back to customers
        </Link>
        <p className={`${styles.banner} ${styles.bannerError}`}>{error ?? "Customer not found."}</p>
      </main>
    );
  }

  const currency = summary.currency;
  const graceStatus = summary.newCustomerGraceEligible
    ? `New customer grace · ${summary.completedCount} of ${NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT} completed visits`
    : `New customer grace completed · ${summary.completedCount}+ visits`;
  const cancellationWaiversUsed = summary.ledgerEntries.filter(
    (entry) => entry.reason === "CANCELLATION_CHARGE" && entry.status === "WAIVED",
  ).length;
  const cancellationWaiversRemaining = Math.max(
    0,
    CANCELLATION_COURTESY_WAIVER_LIMIT - cancellationWaiversUsed,
  );

  return (
    <main className={styles.page}>
      <Link href={`/${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}`} className={styles.backLink}>
        ← Back to customers
      </Link>
      <h1 className={styles.pageTitle}>{summary.phone ?? summary.email ?? "No contact on file"}</h1>
      <p className={styles.pageSubtitle}>{graceStatus}</p>
      <p className={styles.pageSubtitle}>
        Cancellation courtesy · {cancellationWaiversUsed} of {CANCELLATION_COURTESY_WAIVER_LIMIT} used · {cancellationWaiversRemaining} remaining
      </p>

      <div className={styles.rowMeta} style={{ margin: "4px 0 20px" }}>
        {summary.completedCount} completed · {summary.cancelledCount} cancelled · {summary.noShowCount} no-show
        {summary.segment && ` · ${SEGMENT_LABEL[summary.segment]} customer`}
      </div>

      {summary.outstandingTotalAmount > 0 && (
        <p className={`${styles.banner} ${styles.bannerWarning}`}>
          {formatMoney(summary.outstandingTotalAmount, currency)} outstanding — new bookings are blocked at this
          shop until this is settled or waived.
        </p>
      )}

      <h2 className={styles.sectionHeading}>Dues</h2>
      {summary.ledgerEntries.length === 0 && <p className={styles.emptyState}>No outstanding or waived dues.</p>}

      {summary.ledgerEntries.length > 0 && (
        <ul className={styles.rowList}>
          {summary.ledgerEntries.map((entry) => {
            const eligibleNoShowWaiver =
              entry.status === "OUTSTANDING" && entry.reason === "NO_SHOW_CHARGE" && summary.newCustomerGraceEligible;
            const eligibleCancellationWaiver =
              entry.status === "OUTSTANDING" &&
              entry.reason === "CANCELLATION_CHARGE" &&
              cancellationWaiversRemaining > 0;
            return (
              <li key={entry.id} className={styles.row}>
                <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                  <span className={styles.rowTitle}>
                    {reasonLabel(entry.reason)} · {formatMoney(entry.amount, currency)}
                  </span>
                  <div className={styles.rowMeta}>
                    {entry.bookingServiceName && `${entry.bookingServiceName} · `}
                    {entry.bookingSlotStart ? formatDate(entry.bookingSlotStart) : "No related booking"}
                  </div>
                  <div className={styles.rowMeta}>Recorded {formatDate(entry.createdAt)}</div>
                  {entry.reason === "CANCELLATION_CHARGE" && (
                    <div className={styles.rowMeta}>
                      Courtesy waiver · {cancellationWaiversRemaining} of {CANCELLATION_COURTESY_WAIVER_LIMIT} remaining
                    </div>
                  )}
                </div>
                <span
                  className={`${styles.statusBadge} ${
                    entry.status === "OUTSTANDING" ? styles.statusPending : styles.statusMuted
                  }`}
                >
                  {entry.status === "OUTSTANDING" ? "Outstanding" : "Waived"}
                </span>
                <div className={styles.rowActions}>
                  {entry.status === "OUTSTANDING" && entry.reason === "NO_SHOW_CHARGE" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!eligibleNoShowWaiver}
                      title={eligibleNoShowWaiver ? undefined : "This customer has completed 3 or more visits."}
                      onClick={() => {
                        setActionError(null);
                        setPendingAction({ entry, action: "waive" });
                      }}
                    >
                      Waive no-show due
                    </Button>
                  )}
                  {entry.status === "OUTSTANDING" && entry.reason === "CANCELLATION_CHARGE" && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!eligibleCancellationWaiver}
                      title={
                        eligibleCancellationWaiver
                          ? undefined
                          : `All ${CANCELLATION_COURTESY_WAIVER_LIMIT} cancellation courtesy waivers are already in use.`
                      }
                      onClick={() => {
                        setActionError(null);
                        setPendingAction({ entry, action: "waive" });
                      }}
                    >
                      Waive cancellation charge
                    </Button>
                  )}
                  {entry.status === "WAIVED" && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setActionError(null);
                        setPendingAction({ entry, action: "restore" });
                      }}
                    >
                      Restore due
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pendingAction && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#fff", borderRadius: "var(--bc-radius-md)", padding: 24, maxWidth: 420, width: "90%", boxShadow: "var(--bc-shadow-lg)" }}>
            <p className={styles.rowTitle} style={{ marginBottom: 12 }}>
              {pendingAction.entry.reason === "CANCELLATION_CHARGE"
                ? pendingAction.action === "waive"
                  ? `Waive ${formatMoney(pendingAction.entry.amount, currency)} cancellation charge as a courtesy? This customer currently has ${cancellationWaiversRemaining} of ${CANCELLATION_COURTESY_WAIVER_LIMIT} courtesy waivers remaining.`
                  : `Restore the ${formatMoney(pendingAction.entry.amount, currency)} cancellation charge? The customer will be blocked from new bookings again if any outstanding due remains.`
                : pendingAction.action === "waive"
                  ? `Waive ${formatMoney(pendingAction.entry.amount, currency)} no-show due for this customer?`
                  : `Restore the ${formatMoney(pendingAction.entry.amount, currency)} no-show due? The customer will be blocked from new bookings again until it is settled or waived.`}
            </p>
            {actionError && <p className={`${styles.banner} ${styles.bannerError}`}>{actionError}</p>}
            <div className={styles.rowActions} style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <Button type="button" variant="outline" onClick={() => setPendingAction(null)} disabled={actionSubmitting}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={() => void confirmPendingAction()} disabled={actionSubmitting}>
                {actionSubmitting ? "Working…" : pendingAction.action === "waive" ? "Waive due" : "Restore due"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
