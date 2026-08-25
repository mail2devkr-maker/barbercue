"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DISCOVERY_PATHS, Role, SalonStatus } from "@barbercue/shared";
import type { RegisterSalonResultDto } from "@barbercue/shared";
import { useAuth } from "../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../lib/api";

// SalonStatus values are database enums ("PENDING"), not language an owner should be shown.
const STATUS_LABEL: Record<SalonStatus, string> = {
  [SalonStatus.PENDING]: "Not open yet",
  [SalonStatus.ACTIVE]: "Open — customers can find you",
  [SalonStatus.SUSPENDED]: "Paused",
};

// Landing page after a successful owner/staff login — lists the shops this user owns, each
// linking into its own queue/staff/settings pages. Staff without SALON_OWNER see an empty list
// here (salons/mine is owner-only) but can still be routed straight to a specific salon's queue
// via a link shared by their owner; a staff-facing "which salon am I on" picker is a later phase.
export default function SalonsDashboardHomePage() {
  const { user, logout } = useAuth();
  const [salons, setSalons] = useState<RegisterSalonResultDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = user?.roles.includes(Role.SALON_OWNER) ?? false;

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    apiFetch<RegisterSalonResultDto[]>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.mine}`)
      .then((list) => {
        if (!cancelled) setSalons(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your shops.");
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);
  // Derived, not stored: a non-owner (plain staff or a customer mid-onboarding) simply has no
  // salons to list, without needing a synchronous setState-in-effect to represent that.
  const displaySalons = isOwner ? salons : [];

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 700, margin: "0 auto" }}>
      <h1>Salon dashboard</h1>
      <p>
        Logged in as <strong>{user?.email}</strong> ({user?.roles.join(", ")}).
      </p>

      <div style={{ margin: "28px 0" }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your shops</h2>
        {error && <p style={{ color: "#B0413E" }}>{error}</p>}
        {displaySalons === null && <p>Loading…</p>}
        {displaySalons?.length === 0 && <p style={{ color: "#6B6357" }}>You don&apos;t have any registered shops yet.</p>}
        {displaySalons && displaySalons.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {displaySalons.map((s) => (
              <li key={s.id} style={{ border: "1px solid #E5DFD1", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong>{s.name}</strong>
                  <span style={{ fontSize: 13, color: "#6B6357" }}>{s.publicId}</span>
                </div>
                <div style={{ fontSize: 13, color: "#6B6357", marginTop: 2 }}>
                  {STATUS_LABEL[s.status]}
                </div>
                {s.status !== SalonStatus.ACTIVE && (
                  <div style={{ fontSize: 13, color: "#B36B00", marginTop: 6 }}>
                    Customers can&apos;t find this shop or join its queue yet. Open it from
                    Settings when you&apos;re ready.
                  </div>
                )}
                <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 14, flexWrap: "wrap" }}>
                  <Link href={`/dashboard/salons/${s.id}/settings`}>Set up &amp; open</Link>
                  <Link href={`/dashboard/salons/${s.id}/services`}>Services</Link>
                  <Link href={`/dashboard/salons/${s.id}/hours`}>Hours</Link>
                  <Link href={`/dashboard/salons/${s.id}/chairs`}>Chairs</Link>
                  <Link href={`/dashboard/salons/${s.id}/staff`}>Barbers</Link>
                  <Link href={`/dashboard/salons/${s.id}/queue`}>Live queue</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link href="/dashboard/register-shop" style={{ display: "inline-block", marginTop: 16 }}>
          + Register a new shop
        </Link>
      </div>

      <button onClick={() => void logout()} style={{ marginTop: 16 }}>
        Log out
      </button>
    </main>
  );
}
