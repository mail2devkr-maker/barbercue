"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, DISCOVERY_PATHS, SalonSetupErrorCode, SalonStatus } from "@barbercue/shared";
import type {
  RegisterSalonResultDto,
  SalonSetupReadinessDto,
  SalonStatusResultDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { QueueQrSection } from "../../../../../../components/dashboard/QueueQrSection";
import { SetupChecklist } from "../../../../../../components/dashboard/SetupChecklist";

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
    <li style={{ color: done ? "#2E7D32" : "#8A5A00" }}>
      <span aria-hidden="true">{done ? "✓" : "✗"}</span>{" "}
      {done ? doneLabel : label}
    </li>
  );
}

// Payment policy and cancellation policy configuration — placeholder, not yet implemented.
// publicId display (major-upgrade phase) is real: it's the shop's permanent, shareable identity.
export default function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const [salon, setSalon] = useState<RegisterSalonResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
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
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <Link href="/dashboard/salons" style={{ fontSize: 14 }}>← Back to shops</Link>
      <h1 style={{ marginTop: 12 }}>Settings — {salon?.name ?? "…"}</h1>
      {/* This page is where RegisterSalonForm lands a brand-new owner, so it has to be a hub:
          without these the only route to services/chairs/staff is back out to the shop list. */}
      <nav style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14, margin: "8px 0 4px" }}>
        <Link href={`/dashboard/salons/${salonId}/services`}>Services</Link>
        <Link href={`/dashboard/salons/${salonId}/chairs`}>Chairs</Link>
        <Link href={`/dashboard/salons/${salonId}/staff`}>Barbers</Link>
        <Link href={`/dashboard/salons/${salonId}/queue`}>Live queue</Link>
      </nav>
      {error && <p style={{ color: "#B0413E" }}>{error}</p>}
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
        <section style={{ marginTop: 8, paddingTop: 20, borderTop: "1px solid #E7E0D3" }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>Shop status</h2>
          {salon.status === SalonStatus.ACTIVE ? (
            <>
              <p style={{ color: "#2E7D32", fontSize: 14 }}>
                Your shop is open — customers can find it and join the queue.
              </p>
              <button
                type="button"
                onClick={() => void changeStatus(SalonStatus.SUSPENDED)}
                disabled={updatingStatus}
                style={{ padding: "11px 16px", minHeight: 44, borderRadius: 8, border: "1px solid #E7E0D3", background: "#fff", fontSize: 15, cursor: "pointer" }}
              >
                {updatingStatus ? "Updating…" : "Close my shop"}
              </button>
            </>
          ) : (
            <>
              <p style={{ color: "#B36B00", fontSize: 14 }}>
                Your shop is <strong>{STATUS_LABEL[salon.status].toLowerCase()}</strong> — customers
                can&apos;t find it in search, and its queue QR shows as unavailable, until you open
                it. You can close it again at any time.
              </p>
              {/* The server is what actually enforces this (SALON_SETUP_INCOMPLETE); showing it
                  here just means the owner learns what's missing before clicking, not after. */}
              {salon.status === SalonStatus.PENDING && readiness && !isReady(readiness) && (
                <div style={{ color: "#8A5A00", fontSize: 14, background: "#FFF8E7", padding: "12px 14px", borderRadius: 8 }}>
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
              <button
                type="button"
                onClick={() => void changeStatus(SalonStatus.ACTIVE)}
                disabled={updatingStatus}
                style={{ padding: "12px 20px", minHeight: 46, borderRadius: 8, border: "none", background: "#1C1A17", color: "#fff", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
              >
                {updatingStatus ? "Opening…" : "Open my shop"}
              </button>
            </>
          )}
        </section>
      )}

      <p style={{ marginTop: 24 }}>Payment policy and cancellation policy settings — placeholder, not yet implemented.</p>
      <QueueQrSection salonId={salonId} />
    </main>
  );
}
