"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChairStatus, DASHBOARD_PATHS } from "@barbercue/shared";
import type { SalonChairDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";

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
    try {
      const updated = await apiFetch<SalonChairDto>(`${base}/${chair.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setChairs((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update that chair.");
    }
  }

  const chairCount = chairs?.length ?? 0;
  const activeCount = (chairs ?? []).filter((c) => c.status === ChairStatus.ACTIVE).length;

  return (
    <main style={{ padding: "2rem 1.25rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <Link href={`/dashboard/salons/${salonId}/settings`} style={{ fontSize: 14 }}>
        ← Back to shop setup
      </Link>
      <h1 style={{ marginTop: 12 }}>Chairs</h1>
      <p style={{ color: "#6B6357" }}>
        How many customers you can serve at once. Add one chair for each seat in your shop — most
        owners just name them Chair 1, Chair 2, Chair 3.
      </p>

      {chairs !== null && activeCount === 0 && chairCount > 0 && (
        <p style={warningStyle}>
          None of your chairs are in use — customers can&apos;t be seated until at least one is.
        </p>
      )}
      {error && <p style={errorStyle}>{error}</p>}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 10, margin: "20px 0 24px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label style={labelStyle} htmlFor="chair-label">Chair name</label>
          <input
            id="chair-label"
            placeholder={`Chair ${chairCount + 1}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={60}
            style={inputStyle}
          />
        </div>
        <button type="submit" disabled={submitting} style={buttonStyle}>
          {submitting ? "Adding…" : "Add chair"}
        </button>
      </form>

      {chairs === null && <p>Loading…</p>}
      {chairs?.length === 0 && <p style={{ color: "#6B6357" }}>No chairs yet. Add your first one above.</p>}
      {chairs && chairs.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {chairs.map((c) => (
            <li key={c.id} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ opacity: c.status === ChairStatus.ACTIVE ? 1 : 0.55 }}>{c.label}</strong>
                <div style={{ fontSize: 13, color: "#6B6357" }}>{STATUS_LABEL[c.status]}</div>
              </div>
              <select
                aria-label={`Status for ${c.label}`}
                value={c.status}
                onChange={(e) => void changeStatus(c, e.target.value as ChairStatus)}
                style={{ ...inputStyle, width: "auto", minWidth: 150 }}
              >
                <option value={ChairStatus.ACTIVE}>{STATUS_LABEL[ChairStatus.ACTIVE]}</option>
                <option value={ChairStatus.INACTIVE}>{STATUS_LABEL[ChairStatus.INACTIVE]}</option>
                <option value={ChairStatus.MAINTENANCE}>{STATUS_LABEL[ChairStatus.MAINTENANCE]}</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: "1px solid #E7E0D3",
  // 16px minimum: anything smaller makes iOS Safari zoom the page on focus.
  fontSize: 16,
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 5,
  fontWeight: 600,
  fontSize: 13,
};
const buttonStyle: React.CSSProperties = {
  padding: "12px 20px",
  minHeight: 46,
  background: "#1C1A17",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};
const rowStyle: React.CSSProperties = {
  border: "1px solid #E5DFD1",
  borderRadius: 10,
  padding: "12px 16px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};
const errorStyle: React.CSSProperties = {
  background: "#FBEAEA",
  color: "#B0413E",
  padding: "10px 14px",
  borderRadius: 8,
};
const warningStyle: React.CSSProperties = {
  background: "#FFF8E7",
  color: "#8A5A00",
  padding: "10px 14px",
  borderRadius: 8,
};
