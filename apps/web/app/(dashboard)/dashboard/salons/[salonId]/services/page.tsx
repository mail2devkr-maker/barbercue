"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";

// Mirrors createSalonServiceSchema's bounds so the owner is corrected here, in plain language,
// instead of by a Zod message bounced back from the server.
const MAX_PRICE = 1_000_000;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

interface Draft {
  name: string;
  price: string;
  durationMinutes: string;
}

const EMPTY_DRAFT: Draft = { name: "", price: "", durationMinutes: "30" };

// Returns a human-readable problem, or null when the draft is good to send.
function validate(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give the service a name, like “Haircut”.";
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price < 0) return "Enter the price in rupees, like 300.";
  if (price > MAX_PRICE) return "That price looks too high — please check it.";
  const minutes = Number(draft.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return `How long does it take? Enter between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`;
  }
  return null;
}

// Service catalog management (Phase 11). Services are what a customer picks when booking or
// joining the queue, and a salon needs at least one before it is usable.
export default function DashboardServicesPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.services}`;

  const [services, setServices] = useState<SalonServiceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // id of the service currently being edited inline, plus its working copy.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonServiceDto[]>(base)
      .then((list) => {
        if (!cancelled) setServices(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load services.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<SalonServiceDto>(base, {
        method: "POST",
        body: JSON.stringify({
          name: draft.name.trim(),
          price: Number(draft.price),
          durationMinutes: Number(draft.durationMinutes),
        }),
      });
      setServices((prev) => [...(prev ?? []), created]);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that service.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(svc: SalonServiceDto) {
    setError(null);
    setEditingId(svc.id);
    setEditDraft({
      name: svc.name,
      price: String(svc.price),
      durationMinutes: String(svc.durationMinutes),
    });
  }

  async function saveEdit(svc: SalonServiceDto) {
    const problem = validate(editDraft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const updated = await apiFetch<SalonServiceDto>(`${base}/${svc.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editDraft.name.trim(),
          price: Number(editDraft.price),
          durationMinutes: Number(editDraft.durationMinutes),
        }),
      });
      setServices((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that service.");
    }
  }

  async function toggleActive(svc: SalonServiceDto) {
    setError(null);
    try {
      const updated = await apiFetch<SalonServiceDto>(`${base}/${svc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !svc.isActive }),
      });
      setServices((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update that service.");
    }
  }

  return (
    <main style={{ padding: "2rem 1.25rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <Link href={`/dashboard/salons/${salonId}/settings`} style={{ fontSize: 14 }}>
        ← Back to shop setup
      </Link>
      <h1 style={{ marginTop: 12 }}>Services</h1>
      <p style={{ color: "#6B6357" }}>
        What customers can book or queue for. Turning a service off keeps its past bookings but
        stops anyone choosing it again.
      </p>

      {error && <p style={errorStyle}>{error}</p>}

      <form onSubmit={handleCreate} style={formStyle}>
        <div style={{ flex: "2 1 200px" }}>
          <label style={labelStyle} htmlFor="svc-name">Service</label>
          <input
            id="svc-name"
            placeholder="Haircut"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            required
            maxLength={120}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: "1 1 110px" }}>
          <label style={labelStyle} htmlFor="svc-price">Price (₹)</label>
          <input
            id="svc-price"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_PRICE}
            placeholder="300"
            value={draft.price}
            onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
            required
            style={inputStyle}
          />
        </div>
        <div style={{ flex: "1 1 110px" }}>
          <label style={labelStyle} htmlFor="svc-minutes">Minutes</label>
          <input
            id="svc-minutes"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={5}
            value={draft.durationMinutes}
            onChange={(e) => setDraft((d) => ({ ...d, durationMinutes: e.target.value }))}
            required
            style={inputStyle}
          />
        </div>
        <button type="submit" disabled={submitting} style={{ ...buttonStyle, flex: "1 1 100%" }}>
          {submitting ? "Adding…" : "Add service"}
        </button>
      </form>

      {services === null && <p>Loading…</p>}
      {services?.length === 0 && (
        <p style={{ color: "#6B6357" }}>No services yet. Add your first one above.</p>
      )}
      {services && services.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {services.map((s) =>
            editingId === s.id ? (
              <li key={s.id} style={{ ...rowStyle, display: "block" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "2 1 180px" }}>
                    <label style={labelStyle} htmlFor={`edit-name-${s.id}`}>Service</label>
                    <input
                      id={`edit-name-${s.id}`}
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      maxLength={120}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: "1 1 100px" }}>
                    <label style={labelStyle} htmlFor={`edit-price-${s.id}`}>Price (₹)</label>
                    <input
                      id={`edit-price-${s.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_PRICE}
                      value={editDraft.price}
                      onChange={(e) => setEditDraft((d) => ({ ...d, price: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: "1 1 100px" }}>
                    <label style={labelStyle} htmlFor={`edit-minutes-${s.id}`}>Minutes</label>
                    <input
                      id={`edit-minutes-${s.id}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_MINUTES}
                      max={MAX_MINUTES}
                      step={5}
                      value={editDraft.durationMinutes}
                      onChange={(e) => setEditDraft((d) => ({ ...d, durationMinutes: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => void saveEdit(s)} style={buttonStyle}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} style={secondaryButtonStyle}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={s.id} style={rowStyle}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ opacity: s.isActive ? 1 : 0.55 }}>{s.name}</strong>
                  <div style={{ fontSize: 13, color: "#6B6357" }}>
                    ₹{s.price} · {s.durationMinutes} min{!s.isActive && " · turned off"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => startEdit(s)} style={secondaryButtonStyle}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void toggleActive(s)} style={secondaryButtonStyle}>
                    {s.isActive ? "Turn off" : "Turn on"}
                  </button>
                </div>
              </li>
            ),
          )}
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
const formStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "flex-end",
  margin: "20px 0 24px",
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
const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  minHeight: 42,
  background: "#fff",
  border: "1px solid #E7E0D3",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
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
