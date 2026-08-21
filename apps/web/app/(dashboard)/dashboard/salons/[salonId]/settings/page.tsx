"use client";

import { use, useEffect, useState } from "react";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { RegisterSalonResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { QueueQrSection } from "../../../../../../components/dashboard/QueueQrSection";

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
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Settings — {salon?.name ?? "…"}</h1>
      {error && <p style={{ color: "#B0413E" }}>{error}</p>}
      {salon && (
        <dl style={{ margin: "18px 0", fontSize: 15 }}>
          <dt style={{ fontWeight: 600 }}>Shop ID</dt>
          <dd style={{ margin: "2px 0 14px", fontFamily: "monospace" }}>{salon.publicId}</dd>
          <dt style={{ fontWeight: 600 }}>Status</dt>
          <dd style={{ margin: "2px 0 14px" }}>{salon.status}</dd>
          <dt style={{ fontWeight: 600 }}>URL slug</dt>
          <dd style={{ margin: "2px 0 14px" }}>{salon.slug}</dd>
        </dl>
      )}
      <p>Payment policy and cancellation policy settings — placeholder, not yet implemented.</p>
      <QueueQrSection salonId={salonId} />
    </main>
  );
}
