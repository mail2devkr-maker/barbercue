"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, DISCOVERY_PATHS, SalonStatus } from "@barbercue/shared";
import type { OwnerMultiShopOverviewDto, SalonWorkplaceDto } from "@barbercue/shared";
import { useAuth } from "../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Button, LinkButton } from "../../../../components/ui/Button";
import styles from "../../../../components/dashboard/dashboard.module.css";

// SalonStatus values are database enums ("PENDING"), not language an owner should be shown.
const STATUS_LABEL: Record<SalonStatus, string> = {
  [SalonStatus.PENDING]: "Not open yet",
  [SalonStatus.ACTIVE]: "Open — customers can find you",
  [SalonStatus.SUSPENDED]: "Paused",
};

/**
 * Landing page after an owner or staff login.
 *
 * Reads salons/workplaces rather than the owner-only salons/mine: membership there is resolved
 * from UserRole, the same rule SalonAccessService enforces, so a barber sees the salon they work
 * at instead of an empty list with no way forward. `isOwner` decides which actions are offered —
 * it is presentation only, and every owner-only endpoint re-checks the role server-side.
 */
export default function SalonsDashboardHomePage() {
  const { user, logout } = useAuth();
  const [workplaces, setWorkplaces] = useState<SalonWorkplaceDto[] | null>(null);
  const [overview, setOverview] = useState<OwnerMultiShopOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonWorkplaceDto[]>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.workplaces}`)
      .then((list) => {
        if (!cancelled) setWorkplaces(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your shops.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ownsAny = (workplaces ?? []).some((w) => w.isOwner);

  // Multi-branch aggregate overview (Phase 10) — only worth fetching once we know this user owns
  // more than one shop; a single-shop owner already sees everything on that one shop's own
  // dashboard, and 403s harmlessly for a staff-only account (never rendered in that case).
  useEffect(() => {
    if (!workplaces || workplaces.filter((w) => w.isOwner).length < 2) return;
    let cancelled = false;
    apiFetch<OwnerMultiShopOverviewDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.overview}`)
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch(() => {
        /* non-critical widget — the per-shop cards below still work */
      });
    return () => {
      cancelled = true;
    };
  }, [workplaces]);

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Your dashboard</h1>
      <p className={styles.pageSubtitle}>
        Signed in as <strong>{user?.email}</strong>.
      </p>

      {overview && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 18,
            padding: "14px 18px",
            margin: "16px 0",
            border: "1px solid var(--bc-border)",
            borderRadius: "var(--bc-radius-md)",
          }}
        >
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.1rem" }}>
              {overview.openShops}/{overview.totalShops}
            </div>
            <div style={{ fontSize: 11, color: "var(--bc-muted)", textTransform: "uppercase" }}>Shops open</div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.1rem" }}>
              {overview.todaysBookingsTotal ?? "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--bc-muted)", textTransform: "uppercase" }}>
              Today&apos;s bookings, all shops
              {overview.todaysBookingsTotal === null && " (set a timezone on every shop to see this)"}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.1rem" }}>
              {overview.activeQueueTotal}
            </div>
            <div style={{ fontSize: 11, color: "var(--bc-muted)", textTransform: "uppercase" }}>
              Active queue, all shops
            </div>
          </div>
        </div>
      )}

      <div style={{ margin: "28px 0" }}>
        <h2 className={styles.sectionHeading}>Your shops</h2>
        {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
        {workplaces === null && !error && <p className={styles.loadingText}>Loading…</p>}

        {workplaces?.length === 0 && (
          <div className={styles.emptyState}>
            <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--bc-ink)" }}>
              You&apos;re not part of a shop yet.
            </p>
            <p style={{ margin: 0 }}>
              If you own a shop, register it below. If you work at one, ask the owner to add you as
              a barber — you&apos;ll get an invitation by email, and your shop will appear here once
              you accept it.
            </p>
          </div>
        )}

        {workplaces && workplaces.length > 0 && (
          <ul className={styles.rowList}>
            {workplaces.map((s) => {
              const statusClass =
                s.status === SalonStatus.ACTIVE
                  ? styles.statusActive
                  : s.status === SalonStatus.PENDING
                    ? styles.statusPending
                    : styles.statusMuted;
              return (
                <li key={s.id} className={styles.shopCard}>
                  <div className={styles.shopCardHead}>
                    <span className={styles.shopCardName}>{s.name}</span>
                    <span className={styles.shopCardId}>{s.publicId}</span>
                  </div>
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className={`${styles.statusBadge} ${statusClass}`}>{STATUS_LABEL[s.status]}</span>
                    {!s.isOwner && <span className={styles.rowMeta}>you work here</span>}
                  </div>

                  {s.isOwner && s.status !== SalonStatus.ACTIVE && (
                    <p className={`${styles.banner} ${styles.bannerWarning}`} style={{ margin: "8px 0 0" }}>
                      Customers can&apos;t find this shop or join its queue yet. Open it from Settings
                      when you&apos;re ready.
                    </p>
                  )}

                  <div className={styles.shopCardLinks}>
                    {/* A barber gets the one thing they need — today's queue. Setup links are
                        owner-only here purely so the UI matches what the API will allow; the server
                        is what actually enforces it. */}
                    <Link href={`/dashboard/salons/${s.id}/queue`}>Live queue</Link>
                    {s.isOwner && (
                      <>
                        <Link href={`/dashboard/salons/${s.id}/settings`}>Set up &amp; open</Link>
                        <Link href={`/dashboard/salons/${s.id}/bookings`}>Bookings</Link>
                        <Link href={`/dashboard/salons/${s.id}/customers`}>Customers</Link>
                        <Link href={`/dashboard/salons/${s.id}/analytics`}>Analytics</Link>
                        <Link href={`/dashboard/salons/${s.id}/reviews`}>Reviews</Link>
                        <Link href={`/dashboard/salons/${s.id}/verification`}>Verification</Link>
                        <Link href={`/dashboard/salons/${s.id}/services`}>Services</Link>
                        <Link href={`/dashboard/salons/${s.id}/hours`}>Hours</Link>
                        <Link href={`/dashboard/salons/${s.id}/photos`}>Photos</Link>
                        <Link href={`/dashboard/salons/${s.id}/chairs`}>Chairs</Link>
                        <Link href={`/dashboard/salons/${s.id}/staff`}>Barbers</Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Shown to owners and to anyone with no shop yet — a barber who also opens their own
            place is a normal path, and hiding this from them would be the same dead end this
            page exists to fix. */}
        {(ownsAny || workplaces?.length === 0) && (
          <div style={{ marginTop: 16 }}>
            <LinkButton href="/dashboard/register-shop" variant="outline">
              + Register a new shop
            </LinkButton>
          </div>
        )}
      </div>

      <Button type="button" variant="outline" onClick={() => void logout()}>
        Log out
      </Button>
    </main>
  );
}
