"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, formatMoney } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button } from "../../../../../../components/ui/Button";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

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
  if (!Number.isFinite(price) || price < 0) return "Enter a price, like 300.";
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

  // Shown next to the price label. Derived from the salon's own currency, so an owner outside
  // India is never told to enter rupees; omitted entirely when the currency is unknown rather
  // than guessing one.
  const salonCurrency = services?.find((s) => s.currency)?.currency ?? null;
  const currencyLabel = salonCurrency ? ` (${salonCurrency})` : "";

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
    <main className={styles.page}>
      <Link href={`/dashboard/salons/${salonId}/settings`} className={styles.backLink}>
        ← Back to shop setup
      </Link>
      <h1 className={styles.pageTitle}>Services</h1>
      <p className={styles.pageSubtitle}>
        What customers can book or queue for. Turning a service off keeps its past bookings but
        stops anyone choosing it again.
      </p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}

      <form onSubmit={handleCreate} className={styles.form}>
        <div style={{ flex: "2 1 200px" }} className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="svc-name">Service</label>
          <input
            id="svc-name"
            placeholder="Haircut"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            required
            maxLength={120}
            className={styles.input}
          />
        </div>
        <div style={{ flex: "1 1 110px" }} className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="svc-price">Price{currencyLabel}</label>
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
            className={styles.input}
          />
        </div>
        <div style={{ flex: "1 1 110px" }} className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="svc-minutes">Minutes</label>
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
            className={styles.input}
          />
        </div>
        <Button type="submit" variant="secondary" fullWidth disabled={submitting}>
          {submitting ? "Adding…" : "Add service"}
        </Button>
      </form>

      {services === null && <p className={styles.loadingText}>Loading…</p>}
      {services?.length === 0 && (
        <p className={styles.emptyState}>No services yet. Add your first one above.</p>
      )}
      {services && services.length > 0 && (
        <ul className={styles.rowList}>
          {services.map((s) =>
            editingId === s.id ? (
              <li key={s.id} className={styles.row} style={{ display: "block" }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "2 1 180px" }} className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-name-${s.id}`}>Service</label>
                    <input
                      id={`edit-name-${s.id}`}
                      value={editDraft.name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                      maxLength={120}
                      className={styles.input}
                    />
                  </div>
                  <div style={{ flex: "1 1 100px" }} className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-price-${s.id}`}>Price{currencyLabel}</label>
                    <input
                      id={`edit-price-${s.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_PRICE}
                      value={editDraft.price}
                      onChange={(e) => setEditDraft((d) => ({ ...d, price: e.target.value }))}
                      className={styles.input}
                    />
                  </div>
                  <div style={{ flex: "1 1 100px" }} className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-minutes-${s.id}`}>Minutes</label>
                    <input
                      id={`edit-minutes-${s.id}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_MINUTES}
                      max={MAX_MINUTES}
                      step={5}
                      value={editDraft.durationMinutes}
                      onChange={(e) => setEditDraft((d) => ({ ...d, durationMinutes: e.target.value }))}
                      className={styles.input}
                    />
                  </div>
                </div>
                <div className={styles.rowActions} style={{ marginTop: 4 }}>
                  <Button type="button" variant="secondary" onClick={() => void saveEdit(s)}>
                    Save
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </li>
            ) : (
              <li key={s.id} className={styles.row}>
                <div style={{ minWidth: 0 }}>
                  <span className={styles.rowTitle} style={{ opacity: s.isActive ? 1 : 0.55 }}>{s.name}</span>
                  <div className={styles.rowMeta}>
                    {formatMoney(s.price, s.currency)} · {s.durationMinutes} min{!s.isActive && " · turned off"}
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <Button type="button" variant="outline" onClick={() => startEdit(s)}>
                    Edit
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void toggleActive(s)}>
                    {s.isActive ? "Turn off" : "Turn on"}
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </main>
  );
}
