"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_PATHS, Role, setOperatingHoursSchema } from "@barbercue/shared";
import type { OperatingHoursDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { RequireRole } from "../../../../../../components/auth/RequireRole";
import { Button } from "../../../../../../components/ui/Button";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

// 0 = Sunday .. 6 = Saturday — the convention OperatingHours.dayOfWeek already uses.
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Weekly opening hours. Without these a salon can still take walk-ins through the queue, but
 * AvailabilityService returns zero bookable slots for every day that has no open row — so this
 * page is what actually makes online booking possible for a self-registered shop.
 *
 * The whole week is saved in one PUT (see setOperatingHoursSchema): an owner thinks about their
 * schedule as one thing, and a per-day save could leave the shop half-configured.
 */
export default function DashboardHoursPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const router = useRouter();
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.operatingHours}`;

  const [days, setDays] = useState<OperatingHoursDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<OperatingHoursDto[]>(base)
      .then((list) => {
        if (!cancelled) setDays(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your opening hours.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  function updateDay(dayOfWeek: number, patch: Partial<OperatingHoursDto>) {
    setNotice(null);
    setDays((prev) => (prev ?? []).map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  }

  /** Applies one day's open/close times to every other open day — the common "same hours" case. */
  function copyToAll(from: OperatingHoursDto) {
    setNotice(null);
    setDays((prev) =>
      (prev ?? []).map((d) => ({ ...d, openTime: from.openTime, closeTime: from.closeTime })),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!days) return;
    setError(null);
    setNotice(null);

    // Validate with the same schema the backend uses, so the owner sees the real message here
    // rather than after a round-trip.
    const parsed = setOperatingHoursSchema.safeParse({ days });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const dayIdx = typeof issue.path[1] === "number" ? issue.path[1] : null;
      setError(dayIdx !== null ? `${DAY_NAMES[days[dayIdx]?.dayOfWeek ?? 0]}: ${issue.message}` : issue.message);
      return;
    }

    setSaving(true);
    try {
      const saved = await apiFetch<OperatingHoursDto[]>(base, {
        method: "PUT",
        body: JSON.stringify(parsed.data),
      });
      setDays(saved);
      setNotice("Opening hours saved. Customers can now book during these times.");
      const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter?.value === "next") {
        router.push(`/dashboard/salons/${salonId}/photos`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your opening hours.");
    } finally {
      setSaving(false);
    }
  }

  const openCount = (days ?? []).filter((d) => !d.isClosed).length;

  return (
    <RequireRole roles={[Role.SALON_OWNER, Role.PLATFORM_ADMIN]} redirectTo="/dashboard/salons">
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Opening hours</h1>
      <p className={styles.pageSubtitle}>
        When customers can book an appointment with you. Walk-ins can still join your queue at any
        time — these hours only control online booking.
      </p>
      <SetupNavigation salonId={salonId} currentStep="hours" section="steps" />

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`}>{notice}</p>}
      {days !== null && openCount === 0 && (
        <p className={`${styles.banner} ${styles.bannerWarning}`}>
          Every day is set to closed, so nobody can book an appointment yet. Open at least one day.
        </p>
      )}

      {days === null && !error && <p className={styles.loadingText}>Loading…</p>}

      {days && (
        <form id="opening-hours-form" onSubmit={handleSave}>
          <ul className={styles.rowList} style={{ margin: "20px 0" }}>
            {days.map((d) => (
              <li key={d.dayOfWeek} className={styles.row}>
                <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                  <span className={styles.rowTitle} style={{ opacity: d.isClosed ? 0.55 : 1 }}>{DAY_NAMES[d.dayOfWeek]}</span>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, flex: "0 0 auto" }}>
                  <input
                    type="checkbox"
                    checked={!d.isClosed}
                    onChange={(e) => updateDay(d.dayOfWeek, { isClosed: !e.target.checked })}
                    style={{ width: 18, height: 18 }}
                  />
                  Open
                </label>

                {d.isClosed ? (
                  <span style={{ flex: "1 1 200px", color: "var(--bc-muted)", fontSize: 14 }}>Closed</span>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 200px", flexWrap: "wrap" }}>
                    <input
                      type="time"
                      aria-label={`${DAY_NAMES[d.dayOfWeek]} opening time`}
                      value={d.openTime}
                      onChange={(e) => updateDay(d.dayOfWeek, { openTime: e.target.value })}
                      className={styles.timeInput}
                    />
                    <span style={{ color: "var(--bc-muted)" }}>to</span>
                    <input
                      type="time"
                      aria-label={`${DAY_NAMES[d.dayOfWeek]} closing time`}
                      value={d.closeTime}
                      onChange={(e) => updateDay(d.dayOfWeek, { closeTime: e.target.value })}
                      className={styles.timeInput}
                    />
                    <button
                      type="button"
                      onClick={() => copyToAll(d)}
                      style={{ background: "none", border: "none", color: "var(--bc-muted)", fontSize: 13, textDecoration: "underline", cursor: "pointer", padding: "6px 2px" }}
                    >
                      Use for all days
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Button type="submit" name="setupIntent" value="save" variant="outline" disabled={saving}>
            {saving ? "Saving…" : "Save opening hours"}
          </Button>
        </form>
      )}
      <SetupNavigation
        salonId={salonId}
        currentStep="hours"
        section="actions"
        nextAction={{ kind: "submit", formId: "opening-hours-form", disabled: saving || days === null }}
      />
    </main>
    </RequireRole>
  );
}
