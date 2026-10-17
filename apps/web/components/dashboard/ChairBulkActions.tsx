"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChairStatus, DASHBOARD_PATHS } from "@barbercue/shared";
import type { ChairOptionDto, DashboardQueueDto, SalonChairDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  executeChairRemoval,
  planChairRemoval,
  type ChairRemovalPlan,
  type ChairRemovalSummary,
  type ChairRemovalVerdict,
} from "../../lib/chair-bulk-removal";
import { Button } from "../ui/Button";
import styles from "./chair-bulk.module.css";

const VERDICT_LABEL: Record<ChairRemovalVerdict, string> = {
  REMOVE: "Will be removed",
  REMOVE_WITH_WARNING: "Will be removed (a customer goes back to waiting)",
  BLOCKED: "Cannot be removed now",
  SKIP: "Already removed",
};

type Phase = "idle" | "checking" | "review" | "running" | "done";

/** Selection checkbox for one chair row. A chair that is already removed is not selectable. */
export function ChairSelectBox({ chair, checked, onChange }: { chair: SalonChairDto; checked: boolean; onChange: (next: boolean) => void }) {
  if (chair.status === ChairStatus.INACTIVE) return null;
  return (
    <input
      type="checkbox"
      className={styles.check}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={`Select ${chair.label}`}
    />
  );
}

/**
 * Bulk removal bar for the Chairs page (requirement #27): select all, a reviewed conflict preview, an
 * explicit confirmation and a result summary. Chairs are only ever taken out of ACTIVE capacity (never
 * deleted), and a chair in use is refused (see lib/chair-bulk-removal.ts).
 */
export function ChairBulkActions({
  salonId,
  chairs,
  selected,
  onSelectionChange,
  onChanged,
}: {
  salonId: string;
  chairs: SalonChairDto[];
  selected: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  /** Called after a removal run so the page reloads the real chair list from the server. */
  onChanged: () => Promise<void> | void;
}) {
  const salonBase = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const selectable = useMemo(() => chairs.filter((c) => c.status !== ChairStatus.INACTIVE), [chairs]);
  const chosen = selectable.filter((c) => selected.has(c.id));
  const allChecked = selectable.length > 0 && chosen.length === selectable.length;
  const someChecked = chosen.length > 0 && !allChecked;
  const selectAllRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<ChairRemovalPlan | null>(null);
  const [summary, setSummary] = useState<ChairRemovalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);

  if (selectable.length === 0 && !summary) return null;

  async function review() {
    setError(null);
    setSummary(null);
    setPhase("checking");
    let board: ChairOptionDto[] | null = null;
    try {
      const queue = await apiFetch<DashboardQueueDto>(`${salonBase}/${DASHBOARD_PATHS.queue}`);
      board = queue.chairs;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check which chairs are in use.");
    }
    setPlan(planChairRemoval(chosen.map((c) => c.id), chairs, board));
    setPhase("review");
  }

  async function confirm() {
    setPhase("running");
    const result = await executeChairRemoval({
      selectedIds: chosen.map((c) => c.id),
      chairs,
      fetchBoard: async () => (await apiFetch<DashboardQueueDto>(`${salonBase}/${DASHBOARD_PATHS.queue}`)).chairs,
      removeChair: async (chairId) => {
        await apiFetch<SalonChairDto>(`${salonBase}/${DASHBOARD_PATHS.chairs}/${chairId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: ChairStatus.INACTIVE }),
        });
      },
      describeError: (err) => (err instanceof ApiError ? err.message : "The request failed."),
    });
    setSummary(result);
    setPlan(null);
    setPhase("done");
    onSelectionChange(new Set());
    await onChanged();
  }

  function cancel() {
    setPlan(null);
    setPhase("idle");
    setError(null);
  }

  function finish() {
    setSummary(null);
    setPhase("idle");
  }

  return (
    <section className={styles.bar} aria-label="Bulk chair actions">
      {selectable.length > 0 && (
        <div className={styles.toolbar}>
          <label className={styles.selectAll}>
            <input
              ref={selectAllRef}
              type="checkbox"
              className={styles.check}
              checked={allChecked}
              aria-label="Select all chairs"
              onChange={(e) => onSelectionChange(e.target.checked ? new Set(selectable.map((c) => c.id)) : new Set())}
              disabled={phase === "checking" || phase === "running"}
            />
            <span>Select all ({selectable.length})</span>
          </label>
          <span className={styles.count} aria-live="polite">{chosen.length} selected</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => void review()}
            disabled={chosen.length === 0 || phase === "checking" || phase === "running" || phase === "review"}
          >
            {phase === "checking" ? "Checking…" : `Review removal${chosen.length > 0 ? ` (${chosen.length})` : ""}`}
          </Button>
        </div>
      )}

      {error && <p className={styles.warn} role="alert">{error}</p>}

      {plan && phase === "review" && (
        <div className={styles.panel} role="region" aria-label="Review chair removal">
          <h2 className={styles.panelTitle}>Review removal of {plan.items.length} chair{plan.items.length === 1 ? "" : "s"}</h2>
          <p className={styles.muted}>
            Chairs are taken out of active capacity, not deleted. Past bookings and service history stay intact, and you can restore a chair later.
          </p>
          {plan.leavesNoActiveChairs && (
            <p className={styles.warn} role="alert">
              After this, none of your chairs will be in use. Customers cannot be seated until you restore or add a chair.
            </p>
          )}
          <ul className={styles.items}>
            {plan.items.map((item) => (
              <li key={item.chairId} className={styles.item} data-verdict={item.verdict}>
                <span className={styles.itemName}>{item.label}</span>
                <span className={styles.badge}>{VERDICT_LABEL[item.verdict]}</span>
                {item.conflicts.map((c, i) => (
                  <span key={i} className={styles.reason}>{c.message}</span>
                ))}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => void confirm()} disabled={plan.removableIds.length === 0}>
              {`Remove ${plan.removableIds.length} chair${plan.removableIds.length === 1 ? "" : "s"}`}
            </Button>
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
          </div>
          {plan.removableIds.length === 0 && <p className={styles.muted}>Nothing in this selection can be removed right now.</p>}
        </div>
      )}

      {phase === "running" && <p className={styles.muted} role="status">Removing chairs…</p>}

      {summary && phase === "done" && (
        <div className={styles.panel} role="status" aria-label="Chair removal result">
          <h2 className={styles.panelTitle}>
            {summary.removed} removed{summary.blocked ? `, ${summary.blocked} not removed` : ""}
            {summary.failed ? `, ${summary.failed} failed` : ""}
            {summary.skipped ? `, ${summary.skipped} already removed` : ""}
          </h2>
          <ul className={styles.items}>
            {summary.results.map((r) => (
              <li key={r.chairId} className={styles.item} data-outcome={r.outcome}>
                <span className={styles.itemName}>{r.label}</span>
                <span className={styles.badge}>{r.outcome === "REMOVED" ? "Removed" : r.outcome === "SKIPPED" ? "Already removed" : r.outcome === "BLOCKED" ? "Not removed" : "Failed"}</span>
                <span className={styles.reason}>{r.message}</span>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button type="button" variant="outline" onClick={finish}>Done</Button>
          </div>
        </div>
      )}
    </section>
  );
}
