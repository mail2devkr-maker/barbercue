"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { SalonWorkplaceDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { BrandLockup } from "../ui/BrandLockup";
import { NotificationBell } from "./NotificationBell";
import styles from "./dashboard-shell.module.css";

// Matches /dashboard/salons/:salonId(/rest...) — captures the salonId and everything after it, so
// switching shops can land the owner on the *same* page (e.g. .../queue) for the new shop instead
// of always bouncing back to its settings page.
const SALON_SCOPED_PATH = /^\/dashboard\/salons\/([^/]+)(\/.*)?$/;

/**
 * Role-neutral navigation for every authenticated dashboard surface, plus a cross-shop switcher
 * (Phase 10 — multi-branch experience) shown only when the current page is scoped to a specific
 * salon AND the owner operates more than one. Switching preserves the current sub-path so an owner
 * checking today's queue at Shop A can jump straight to Shop B's queue, not back to a shop list.
 */
export function DashboardHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [workplaces, setWorkplaces] = useState<SalonWorkplaceDto[] | null>(null);

  const match = pathname.match(SALON_SCOPED_PATH);
  const currentSalonId = match?.[1] ?? null;
  const restOfPath = match?.[2] ?? "";
  // Admin/#2/#7 dark-UI parity -- dark only on the routes already reskinned to the FastQue dark
  // identity (salon-scoped management pages, admin, register-shop), never on the still-legacy
  // salon list, which would create the opposite (dark header over a light page) seam instead.
  const isDarkSurface =
    pathname === "/dashboard/salons" ||
    currentSalonId !== null ||
    pathname.startsWith("/dashboard/admin") ||
    pathname.startsWith("/dashboard/register-shop");

  useEffect(() => {
    if (!currentSalonId) return;
    let cancelled = false;
    apiFetch<SalonWorkplaceDto[]>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.workplaces}`)
      .then((list) => {
        if (!cancelled) setWorkplaces(list);
      })
      .catch(() => {
        /* non-critical widget — the rest of the header still works */
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch on navigation between shops too, in case membership changed since last load.
  }, [currentSalonId]);

  const ownedShops = (workplaces ?? []).filter((w) => w.isOwner);
  const showSwitcher = currentSalonId !== null && ownedShops.length > 1;

  return (
    <>
      <header className={`${styles.header} ${isDarkSurface ? styles.headerDark : ""}`}>
        <div className={styles.inner}>
        <Link href="/" className={styles.wordmark} aria-label="FastQue home">
          <BrandLockup compact canonicalArtwork />
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {showSwitcher && (
            <select
              aria-label="Switch shop"
              value={currentSalonId ?? ""}
              onChange={(e) => router.push(`/dashboard/salons/${e.target.value}${restOfPath}`)}
              style={{
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255, 255, 255, 0.14)",
                background: "rgba(255, 255, 255, 0.05)",
                color: "#f7f5f4",
                maxWidth: 220,
              }}
            >
              {ownedShops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <NotificationBell />
          <Link href="/" className={styles.publicLink}>
            <span aria-hidden="true">←</span> Visit public site
          </Link>
        </div>
        </div>
      </header>
      <div className={styles.headerSpacer} aria-hidden="true" />
    </>
  );
}
