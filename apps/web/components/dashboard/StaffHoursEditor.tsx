"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, setStaffWorkingHoursSchema } from "@barbercue/shared";
import type { StaffWorkingHoursDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Per-barber working hours (Phase 7) — an optional refinement on top of the shop's own opening
 * hours page. Unlike that page, a day left unconfigured here means "this barber works whenever the
 * shop is open," not closed (see StaffWorkingHoursDto's own doc comment) — the "Unrestricted"
 * checkbox reflects that directly instead of defaulting new owners into artificially narrowing
 * every barber's schedule the first time they open this panel.
 */
export function StaffHoursEditor({ salonId, staffId }: { salonId: string; staffId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${staffId}/${DASHBOARD_PATHS.workingHours}`;
  const [days, setDays] = useState<StaffWorkingHoursDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<StaffWorkingHoursDto[]>(base)
      .then((list) => {
        if (!cancelled) setDays(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load working hours.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  function updateDay(dayOfWeek: number, patch: Partial<StaffWorkingHoursDto>) {
    setNotice(null);
    setDays((prev) =>
      (prev ?? []).map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch, configured: true } : d)),
    );
  }

  async function handleSave() {
    if (!days) return;
    setError(null);
    setNotice(null);
    const parsed = setStaffWorkingHoursSchema.safeParse({ days });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const dayIdx = typeof issue.path[1] === "number" ? issue.path[1] : null;
      setError(dayIdx !== null ? `${DAY_NAMES[days[dayIdx]?.dayOfWeek ?? 0]}: ${issue.message}` : issue.message);
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<StaffWorkingHoursDto[]>(base, {
        method: "PUT",
        body: JSON.stringify(parsed.data),
      });
      setDays(saved);
      setNotice("Working hours saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save working hours.");
    } finally {
      setSaving(false);
    }
  }

  if (days === null) return <p className={styles.loadingText}>Loading hours…</p>;

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--bc-border)" }}>
      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`}>{notice}</p>}
      <ul className={styles.rowList}>
        {days.map((d) => (
          <li key={d.dayOfWeek} className={styles.row}>
            <div style={{ flex: "1 1 110px", minWidth: 0 }}>
              <span className={styles.rowTitle} style={{ opacity: d.isClosed ? 0.55 : 1, fontSize: 14 }}>
                {DAY_NAMES[d.dayOfWeek]}
              </span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flex: "0 0 auto" }}>
              <input
                type="checkbox"
                checked={!d.isClosed}
                onChange={(e) => updateDay(d.dayOfWeek, { isClosed: !e.target.checked })}
                style={{ width: 16, height: 16 }}
              />
              Working
            </label>
            {d.isClosed ? (
              <span style={{ flex: "1 1 160px", color: "var(--bc-muted)", fontSize: 13 }}>Off</span>
            ) : (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "1 1 160px", flexWrap: "wrap" }}>
                <input
                  type="time"
                  aria-label={`${DAY_NAMES[d.dayOfWeek]} start time`}
                  value={d.openTime}
                  onChange={(e) => updateDay(d.dayOfWeek, { openTime: e.target.value })}
                  className={styles.timeInput}
                />
                <span style={{ color: "var(--bc-muted)" }}>to</span>
                <input
                  type="time"
                  aria-label={`${DAY_NAMES[d.dayOfWeek]} end time`}
                  value={d.closeTime}
                  onChange={(e) => updateDay(d.dayOfWeek, { closeTime: e.target.value })}
                  className={styles.timeInput}
                />
              </div>
            )}
            {!d.configured && <span style={{ fontSize: 11, color: "var(--bc-muted)" }}>Unrestricted</span>}
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Saving…" : "Save working hours"}
      </Button>
    </div>
  );
}
