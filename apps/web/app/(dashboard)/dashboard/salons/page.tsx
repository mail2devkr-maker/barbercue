"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DISCOVERY_PATHS, SalonStatus } from "@barbercue/shared";
import type { SalonWorkplaceDto } from "@barbercue/shared";
import { useAuth } from "../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../lib/api";

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

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 700, margin: "0 auto" }}>
      <h1>Your dashboard</h1>
      <p>
        Signed in as <strong>{user?.email}</strong>.
      </p>

      <div style={{ margin: "28px 0" }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your shops</h2>
        {error && <p style={{ color: "#B0413E" }}>{error}</p>}
        {workplaces === null && !error && <p>Loading…</p>}

        {workplaces?.length === 0 && (
          <div style={{ border: "1px solid #E5DFD1", borderRadius: 10, padding: "18px 20px" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>You&apos;re not part of a shop yet.</p>
            <p style={{ margin: 0, color: "#6B6357", fontSize: 14 }}>
              If you own a shop, register it below. If you work at one, ask the owner to add you as
              a barber — you&apos;ll get an invitation by email, and your shop will appear here once
              you accept it.
            </p>
          </div>
        )}

        {workplaces && workplaces.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {workplaces.map((s) => (
              <li key={s.id} style={{ border: "1px solid #E5DFD1", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <strong>{s.name}</strong>
                  <span style={{ fontSize: 13, color: "#6B6357" }}>{s.publicId}</span>
                </div>
                <div style={{ fontSize: 13, color: "#6B6357", marginTop: 2 }}>
                  {STATUS_LABEL[s.status]}
                  {!s.isOwner && " · you work here"}
                </div>

                {s.isOwner && s.status !== SalonStatus.ACTIVE && (
                  <div style={{ fontSize: 13, color: "#B36B00", marginTop: 6 }}>
                    Customers can&apos;t find this shop or join its queue yet. Open it from Settings
                    when you&apos;re ready.
                  </div>
                )}

                <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 14, flexWrap: "wrap" }}>
                  {/* A barber gets the one thing they need — today's queue. Setup links are
                      owner-only here purely so the UI matches what the API will allow; the server
                      is what actually enforces it. */}
                  <Link href={`/dashboard/salons/${s.id}/queue`}>Live queue</Link>
                  {s.isOwner && (
                    <>
                      <Link href={`/dashboard/salons/${s.id}/settings`}>Set up &amp; open</Link>
                      <Link href={`/dashboard/salons/${s.id}/services`}>Services</Link>
                      <Link href={`/dashboard/salons/${s.id}/hours`}>Hours</Link>
                      <Link href={`/dashboard/salons/${s.id}/chairs`}>Chairs</Link>
                      <Link href={`/dashboard/salons/${s.id}/staff`}>Barbers</Link>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Shown to owners and to anyone with no shop yet — a barber who also opens their own
            place is a normal path, and hiding this from them would be the same dead end this
            page exists to fix. */}
        {(ownsAny || workplaces?.length === 0) && (
          <Link href="/dashboard/register-shop" style={{ display: "inline-block", marginTop: 16 }}>
            + Register a new shop
          </Link>
        )}
      </div>

      <button onClick={() => void logout()} style={{ marginTop: 16 }}>
        Log out
      </button>
    </main>
  );
}
