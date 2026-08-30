"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, DISCOVERY_PATHS, SalonSetupErrorCode, SalonStatus } from "@barbercue/shared";
import type {
  RegisterSalonResultDto,
  SalonSetupReadinessDto,
  SalonStatusResultDto,
  SalonTimezoneResultDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { QueueQrSection } from "../../../../../../components/dashboard/QueueQrSection";
import { SetupChecklist } from "../../../../../../components/dashboard/SetupChecklist";
import { Button } from "../../../../../../components/ui/Button";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

// SalonStatus values are database enums ("PENDING"), not language an owner should be shown.
const STATUS_LABEL: Record<SalonStatus, string> = {
  [SalonStatus.PENDING]: "Not open yet",
  [SalonStatus.ACTIVE]: "Open",
  [SalonStatus.SUSPENDED]: "Paused",
};

function isReady(r: SalonSetupReadinessDto): boolean {
  return r.hasActiveService && r.hasActiveChair && r.hasActiveStaff;
}

// The server sends readiness as the `details` of a SALON_SETUP_INCOMPLETE error. It arrives as
// `unknown`, so it is narrowed rather than cast — a malformed payload must leave the locally
// computed readiness alone instead of blanking the list.
function readinessFromDetails(details: unknown): SalonSetupReadinessDto | null {
  if (typeof details !== "object" || details === null) return null;
  const d = details as Record<string, unknown>;
  if (
    typeof d.hasActiveService !== "boolean" ||
    typeof d.hasActiveChair !== "boolean" ||
    typeof d.hasActiveStaff !== "boolean"
  ) {
    return null;
  }
  return {
    hasActiveService: d.hasActiveService,
    hasActiveChair: d.hasActiveChair,
    hasActiveStaff: d.hasActiveStaff,
  };
}

function ReadinessItem({
  done,
  label,
  doneLabel,
}: {
  done: boolean;
  label: string;
  doneLabel: string;
}) {
  return (
    <li style={{ color: done ? "var(--bc-success)" : "#8A5A00" }}>
      <span aria-hidden="true">{done ? "✓" : "✗"}</span>{" "}
      {done ? doneLabel : label}
    </li>
  );
}

// Every modern browser and Node 18+ implements this (it's how the browser itself knows what zones
// exist), so it's a live, always-current IANA list rather than a hand-maintained array that goes
// stale as the tz database adds/renames zones. The `in` check is only for a runtime old enough not
// to have it — this app's own browserslist target already assumes evergreen browsers, so that path
// is a safety net, not an expected case.
//
// "Asia/Kolkata" is deliberately forced into the list even though it's missing from it: ICU's
// canonical-name table lists the *older* "Asia/Calcutta" identifier instead (both are the same,
// real IANA zone — Kolkata is a link/alias to Calcutta in the tz database, and `supportedValuesOf`
// only returns canonical names). This codebase's own INDIA_TIME_ZONE constant, everywhere a
// salon's timezone is set or compared, uses "Asia/Kolkata" specifically — without forcing it in
// here, the single most common value a new Indian shop would want is simply never selectable, and
// an existing salon already storing exactly that string (as every seeded/legacy one does) couldn't
// have its own current value re-selected in the dropdown, only shown as text above it.
function supportedTimeZones(current: string | null): string[] {
  const zones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];
  const withKolkata = zones.includes("Asia/Kolkata") ? zones : ["Asia/Kolkata", ...zones];
  // Whatever the salon already has stored (even a legacy/unusual value not in ICU's canonical
  // list) must stay selectable — otherwise loading the page with such a value pre-selects nothing.
  if (current && !withKolkata.includes(current)) return [current, ...withKolkata];
  return withKolkata;
}

// Owner-facing counterpart to Global timezone correctness (booking/analytics/isOpenNow all need a
// real IANA zone, and throw SALON_TIMEZONE_REQUIRED for a booking-critical path when none is set).
// India shops keep working unchanged with no zone set at all (resolveSalonTimeZone's own
// country-code fallback) — this control exists for every OTHER country, and for an India shop that
// wants to set one explicitly anyway.
function TimezoneSection({ salonId }: { salonId: string }) {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const zones = useMemo(
    () => supportedTimeZones(current === undefined ? null : current),
    [current],
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonTimezoneResultDto>(
      `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.timezone}`,
    )
      .then((result) => {
        if (cancelled) return;
        setCurrent(result.timezone);
        setSelected(result.timezone ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your time zone.");
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiFetch<SalonTimezoneResultDto>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.timezone}`,
        { method: "PATCH", body: JSON.stringify({ timezone: selected }) },
      );
      setCurrent(result.timezone);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your time zone.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.dividerSection}>
      <h2 className={styles.sectionHeading}>Time zone</h2>
      <p style={{ color: "var(--bc-muted)", fontSize: 14, marginBottom: 12 }}>
        Used for your opening hours, booking availability, and analytics day boundaries. Without
        one set, an India shop still works (assumed Asia/Kolkata); a shop anywhere else can&apos;t
        take bookings until this is set.
      </p>
      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {current === undefined && !error && <p className={styles.loadingText}>Loading…</p>}
      {current !== undefined && (
        <>
          <p style={{ fontSize: 14, marginBottom: 8 }}>
            Current: <strong>{current ?? "Not set"}</strong>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setSaved(false);
              }}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)", minWidth: 260 }}
            >
              <option value="" disabled>
                Choose a time zone…
              </option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void save()}
              disabled={saving || !selected || selected === current}
            >
              {saving ? "Saving…" : "Save time zone"}
            </Button>
          </div>
          {saved && (
            <p role="status" style={{ color: "var(--bc-success)", fontSize: 13, marginTop: 8 }}>
              Saved.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// Payment policy and cancellation policy configuration — placeholder, not yet implemented.
// publicId display (major-upgrade phase) is real: it's the shop's permanent, shareable identity.
export default function DashboardSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ salonId: string }>;
  searchParams: Promise<{ setup?: string | string[] }>;
}) {
  const { salonId } = use(params);
  const query = use(searchParams);
  const [salon, setSalon] = useState<RegisterSalonResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const walkthroughComplete = query.setup === "complete";
  // Reported by SetupChecklist, which already counts services/chairs/barbers, and overwritten by
  // the server's own answer if an activation attempt is rejected. `setState` is a stable identity,
  // so passing it straight down can't loop the child's effect. Null until the counts load —
  // "unknown", which must not render as "nothing is set up".
  const [readiness, setReadiness] = useState<SalonSetupReadinessDto | null>(null);

  // Owner self-activation (Phase 11). A self-registered salon starts PENDING, and a PENDING salon
  // is invisible in search and its QR reports "queue unavailable" — so this control is what
  // actually opens the shop for business.
  async function changeStatus(status: SalonStatus) {
    setError(null);
    setUpdatingStatus(true);
    try {
      const result = await apiFetch<SalonStatusResultDto>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.status}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      setSalon((prev) => (prev ? { ...prev, status: result.status } : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update your shop's status.");
      // The server refused to open the shop and said exactly what's missing. Trust that over the
      // locally-derived counts, which may be stale if a service was deactivated in another tab.
      if (err instanceof ApiError && err.code === SalonSetupErrorCode.SALON_SETUP_INCOMPLETE) {
        const fromServer = readinessFromDetails(err.details);
        if (fromServer) setReadiness(fromServer);
      }
    } finally {
      setUpdatingStatus(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<RegisterSalonResultDto>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.mine}/${salonId}`)
      .then((s) => {
        if (!cancelled) setSalon(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load this shop.");
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  return (
    <main className={styles.page}>
      <Link href="/dashboard/salons" className={styles.backLink}>← Back to shops</Link>
      <h1 className={styles.pageTitle}>Settings — {salon?.name ?? "…"}</h1>
      {walkthroughComplete && (
        <div className={`${styles.banner} ${styles.bannerNotice}`} role="status">
          <strong>Setup walkthrough complete.</strong> Review the readiness below. Your shop is not
          opened automatically.
        </div>
      )}
      {/* This page is where RegisterSalonForm lands a brand-new owner, so it has to be a hub:
          without these the only route to services/chairs/staff is back out to the shop list. */}
      <nav className={styles.shopCardLinks} style={{ margin: "8px 0 4px" }}>
        <Link href={`/dashboard/salons/${salonId}/services`}>Services</Link>
        <Link href={`/dashboard/salons/${salonId}/hours`}>Opening hours</Link>
        <Link href={`/dashboard/salons/${salonId}/photos`}>Photos</Link>
        <Link href={`/dashboard/salons/${salonId}/chairs`}>Chairs</Link>
        <Link href={`/dashboard/salons/${salonId}/staff`}>Barbers</Link>
        <Link href={`/dashboard/salons/${salonId}/queue`}>Live queue</Link>
        <Link href={`/dashboard/salons/${salonId}/bookings`}>Bookings</Link>
        <Link href={`/dashboard/salons/${salonId}/customers`}>Customers</Link>
        <Link href={`/dashboard/salons/${salonId}/analytics`}>Analytics</Link>
      </nav>
      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {salon && (
        <dl style={{ margin: "18px 0", fontSize: 15 }}>
          <dt style={{ fontWeight: 600 }}>Shop ID</dt>
          <dd style={{ margin: "2px 0 14px", fontFamily: "monospace" }}>{salon.publicId}</dd>
          <dt style={{ fontWeight: 600 }}>Status</dt>
          <dd style={{ margin: "2px 0 14px" }}>{STATUS_LABEL[salon.status]}</dd>
          <dt style={{ fontWeight: 600 }}>Your page address</dt>
          <dd style={{ margin: "2px 0 14px", wordBreak: "break-all" }}>/book/{salon.slug}</dd>
        </dl>
      )}

      {salon && (
        <SetupChecklist salonId={salonId} status={salon.status} onReadyChange={setReadiness} />
      )}
      {salon && (
        <section className={styles.dividerSection}>
          <h2 className={styles.sectionHeading}>Shop status</h2>
          {salon.status === SalonStatus.ACTIVE ? (
            <>
              <p style={{ color: "var(--bc-success)", fontSize: 14, marginBottom: 12 }}>
                Your shop is open — customers can find it and join the queue.
              </p>
              <Button type="button" variant="outline" onClick={() => void changeStatus(SalonStatus.SUSPENDED)} disabled={updatingStatus}>
                {updatingStatus ? "Updating…" : "Close my shop"}
              </Button>
            </>
          ) : (
            <>
              <p style={{ color: "#B36B00", fontSize: 14, marginBottom: 12 }}>
                Your shop is <strong>{STATUS_LABEL[salon.status].toLowerCase()}</strong> — customers
                can&apos;t find it in search, and its queue QR shows as unavailable, until you open
                it. You can close it again at any time.
              </p>
              {/* The server is what actually enforces this (SALON_SETUP_INCOMPLETE); showing it
                  here just means the owner learns what's missing before clicking, not after. */}
              {salon.status === SalonStatus.PENDING && readiness && !isReady(readiness) && (
                <div className={`${styles.banner} ${styles.bannerWarning}`}>
                  <p style={{ margin: "0 0 8px" }}>
                    Your shop can&apos;t open yet — finish these first:
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <ReadinessItem done={readiness.hasActiveService} label="Add at least one service" doneLabel="Service added" />
                    <ReadinessItem done={readiness.hasActiveChair} label="Add at least one chair" doneLabel="Chair added" />
                    <ReadinessItem done={readiness.hasActiveStaff} label="Add at least one barber" doneLabel="Barber added" />
                  </ul>
                </div>
              )}
              {readiness && isReady(readiness) ? (
                <Button type="button" variant="secondary" onClick={() => void changeStatus(SalonStatus.ACTIVE)} disabled={updatingStatus}>
                  {updatingStatus ? "Opening…" : "Open my shop"}
                </Button>
              ) : (
                <Link href={`/dashboard/salons/${salonId}/services`} className={styles.setupOverviewLink}>
                  Continue setup →
                </Link>
              )}
            </>
          )}
        </section>
      )}

      {salon && <TimezoneSection salonId={salonId} />}

      <p className={styles.pageSubtitle} style={{ marginTop: 24 }}>
        Payment policy and cancellation policy settings — placeholder, not yet implemented.
      </p>
      {salon && <QueueQrSection salonId={salonId} salonName={salon.name} />}
    </main>
  );
}
