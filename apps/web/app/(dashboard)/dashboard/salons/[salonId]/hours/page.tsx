"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, setOperatingHoursSchema } from "@barbercue/shared";
import type { OperatingHoursDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your opening hours.");
    } finally {
      setSaving(false);
    }
  }

  const openCount = (days ?? []).filter((d) => !d.isClosed).length;

  return (
    <main style={{ padding: "2rem 1.25rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <Link href={`/dashboard/salons/${salonId}/settings`} style={{ fontSize: 14 }}>
        ← Back to shop setup
      </Link>
      <h1 style={{ marginTop: 12 }}>Opening hours</h1>
      <p style={{ color: "#6B6357" }}>
        When customers can book an appointment with you. Walk-ins can still join your queue at any
        time — these hours only control online booking.
      </p>

      {error && <p style={errorStyle}>{error}</p>}
      {notice && <p style={noticeStyle}>{notice}</p>}
      {days !== null && openCount === 0 && (
        <p style={warningStyle}>
          Every day is set to closed, so nobody can book an appointment yet. Open at least one day.
        </p>
      )}

      {days === null && <p>Loading…</p>}

      {days && (
        <form onSubmit={handleSave}>
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {days.map((d) => (
              <li key={d.dayOfWeek} style={rowStyle}>
                <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                  <strong style={{ opacity: d.isClosed ? 0.55 : 1 }}>{DAY_NAMES[d.dayOfWeek]}</strong>
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
                  <span style={{ flex: "1 1 200px", color: "#6B6357", fontSize: 14 }}>Closed</span>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 200px", flexWrap: "wrap" }}>
                    <input
                      type="time"
                      aria-label={`${DAY_NAMES[d.dayOfWeek]} opening time`}
                      value={d.openTime}
                      onChange={(e) => updateDay(d.dayOfWeek, { openTime: e.target.value })}
                      style={timeStyle}
                    />
                    <span style={{ color: "#6B6357" }}>to</span>
                    <input
                      type="time"
                      aria-label={`${DAY_NAMES[d.dayOfWeek]} closing time`}
                      value={d.closeTime}
                      onChange={(e) => updateDay(d.dayOfWeek, { closeTime: e.target.value })}
                      style={timeStyle}
                    />
                    <button type="button" onClick={() => copyToAll(d)} style={linkButtonStyle}>
                      Use for all days
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <button type="submit" disabled={saving} style={buttonStyle}>
            {saving ? "Saving…" : "Save opening hours"}
          </button>
        </form>
      )}
    </main>
  );
}

const timeStyle: React.CSSProperties = {
  padding: "9px 10px",
  borderRadius: 8,
  border: "1px solid #E7E0D3",
  // 16px minimum: anything smaller makes iOS Safari zoom the page on focus.
  fontSize: 16,
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
const linkButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#6B6357",
  fontSize: 13,
  textDecoration: "underline",
  cursor: "pointer",
  padding: "6px 2px",
};
const rowStyle: React.CSSProperties = {
  border: "1px solid #E5DFD1",
  borderRadius: 10,
  padding: "12px 16px",
  display: "flex",
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
const noticeStyle: React.CSSProperties = {
  background: "#EAF6EC",
  color: "#2E7D32",
  padding: "10px 14px",
  borderRadius: 8,
};
const warningStyle: React.CSSProperties = {
  background: "#FFF8E7",
  color: "#8A5A00",
  padding: "10px 14px",
  borderRadius: 8,
};
