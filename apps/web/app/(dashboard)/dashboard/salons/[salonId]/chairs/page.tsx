"use client";

import { use, useEffect, useState } from "react";
import { ChairStatus, DASHBOARD_PATHS, Role } from "@barbercue/shared";
import type { SalonChairDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { RequireRole } from "../../../../../../components/auth/RequireRole";
import { Button } from "../../../../../../components/ui/Button";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

// ChairStatus values are database enums, not language an owner should be shown.
const STATUS_LABEL: Record<ChairStatus, string> = {
  [ChairStatus.ACTIVE]: "In use",
  [ChairStatus.INACTIVE]: "Not in use",
  [ChairStatus.MAINTENANCE]: "Under repair",
};

// Chair management (Phase 11) — replaces the previous placeholder. Chairs are not cosmetic:
// bookable capacity is min(active staff, active chairs), so a salon with zero active chairs can
// never seat anyone regardless of how many barbers are on the roster.
export default function DashboardChairsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairs}`;

  const [chairs, setChairs] = useState<SalonChairDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonChairDto[]>(base)
      .then((list) => {
        if (!cancelled) setChairs(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load chairs.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<SalonChairDto>(base, {
        method: "POST",
        body: JSON.stringify({ label: label.trim() }),
      });
      setChairs((prev) => [...(prev ?? []), created]);
      setLabel("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that chair.");
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(chair: SalonChairDto, status: ChairStatus) {
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<SalonChairDto>(`${base}/${chair.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setChairs((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
      setNotice(
        status === ChairStatus.INACTIVE
          ? `${chair.label} removed from active capacity. Historical visits are unchanged.`
          : status === ChairStatus.ACTIVE
            ? `${chair.label} restored to active capacity.`
            : `${chair.label} marked under repair.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update that chair.");
    }
  }

  function removeChair(chair: SalonChairDto) {
    if (!window.confirm(`Remove ${chair.label} from active capacity? Past bookings and service history will remain intact.`)) return;
    void changeStatus(chair, ChairStatus.INACTIVE);
  }

  const chairCount = chairs?.length ?? 0;
  const activeCount = (chairs ?? []).filter((c) => c.status === ChairStatus.ACTIVE).length;

  return (
    <RequireRole roles={[Role.SALON_OWNER, Role.PLATFORM_ADMIN]} redirectTo="/dashboard/salons">
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Chairs</h1>
      <p className={styles.pageSubtitle}>
        How many customers you can serve at once. Add one chair for each seat in your shop — most
        owners just name them Chair 1, Chair 2, Chair 3.
      </p>
      <SetupNavigation salonId={salonId} currentStep="chairs" section="steps" />

      {chairs !== null && activeCount === 0 && chairCount > 0 && (
        <p className={`${styles.banner} ${styles.bannerWarning}`}>
          None of your chairs are in use — customers can&apos;t be seated until at least one is.
        </p>
      )}
      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{notice}</p>}

      <form onSubmit={handleCreate} className={styles.form}>
        <div style={{ flex: "1 1 200px" }} className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="chair-label">Chair name</label>
          <input
            id="chair-label"
            placeholder={`Chair ${chairCount + 1}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={60}
            className={styles.input}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={submitting}>
          {submitting ? "Adding…" : "Add chair"}
        </Button>
      </form>

      {chairs === null && !error && <p className={styles.loadingText}>Loading…</p>}
      {chairs?.length === 0 && <p className={styles.emptyState}>No chairs yet. Add your first one above.</p>}
      {chairs && chairs.length > 0 && (
        <ul className={styles.rowList}>
          {chairs.map((c) => (
            <li key={c.id} className={styles.row}>
              <div style={{ minWidth: 0 }}>
                <span className={styles.rowTitle} style={{ opacity: c.status === ChairStatus.ACTIVE ? 1 : 0.55 }}>{c.label}</span>
                <div className={styles.rowMeta}>{STATUS_LABEL[c.status]}</div>
              </div>
              <div className={styles.rowActions}>
                {c.status === ChairStatus.INACTIVE ? (
                  <Button type="button" variant="outline" onClick={() => void changeStatus(c, ChairStatus.ACTIVE)}>
                    Restore chair
                  </Button>
                ) : (
                  <>
                    <select
                      aria-label={`Operational status for ${c.label}`}
                      value={c.status}
                      onChange={(e) => void changeStatus(c, e.target.value as ChairStatus)}
                      className={styles.select}
                      style={{ width: "auto", minWidth: 150 }}
                    >
                      <option value={ChairStatus.ACTIVE}>{STATUS_LABEL[ChairStatus.ACTIVE]}</option>
                      <option value={ChairStatus.MAINTENANCE}>{STATUS_LABEL[ChairStatus.MAINTENANCE]}</option>
                    </select>
                    <Button type="button" variant="outline" onClick={() => removeChair(c)}>
                      Remove chair
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <SetupNavigation salonId={salonId} currentStep="chairs" section="actions" />
    </main>
    </RequireRole>
  );
}
