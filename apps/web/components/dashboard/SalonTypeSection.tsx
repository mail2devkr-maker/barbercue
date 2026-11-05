"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, SalonType } from "@barbercue/shared";
import type { SalonTypeResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import styles from "./dashboard.module.css";

/**
 * Who the shop serves, as customers see it in search (Male / Female / Unisex filter). Issue #376 moved
 * this from the Services page to Settings: it is a shop classification, not a service list, and saving
 * it never adds, changes or removes any service.
 */
export const SALON_TYPE_CHOICES = [
  { value: SalonType.GENTS, label: "Gents salon", help: "Shown to customers looking for a gents (male) salon." },
  { value: SalonType.LADIES, label: "Ladies parlour", help: "Shown to customers looking for a ladies (female) parlour." },
  { value: SalonType.UNISEX, label: "Unisex salon", help: "Shown to customers looking for a unisex salon." },
] as const;

export function SalonTypeSection({ salonId }: { salonId: string }) {
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.services}/${DASHBOARD_PATHS.salonType}`;
  const [salonType, setSalonType] = useState<SalonType | null>(null);
  // False while the type is only the UNISEX default (shops created before customers could filter by it).
  const [confirmed, setConfirmed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiFetch<SalonTypeResultDto>(path)
      .then((r) => {
        if (!live) return;
        setSalonType(r.salonType);
        setConfirmed(r.salonTypeConfirmed !== false);
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : "Could not load your shop type.");
      });
    return () => {
      live = false;
    };
  }, [path]);

  async function save(next: SalonType) {
    // Re-choosing the current type is allowed while it is unconfirmed: that click IS the confirmation.
    if ((next === salonType && confirmed) || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiFetch<SalonTypeResultDto>(path, { method: "PATCH", body: JSON.stringify({ salonType: next }) });
      setSalonType(r.salonType);
      setConfirmed(r.salonTypeConfirmed !== false);
      setNotice(`Saved. Customers now find you as a ${SALON_TYPE_CHOICES.find((c) => c.value === r.salonType)?.label.toLowerCase() ?? "salon"}. Your services did not change.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your shop type.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.dividerSection} aria-labelledby="salon-type-heading">
      <h2 id="salon-type-heading" className={styles.sectionHeading}>Who is your shop for?</h2>
      <p style={{ color: "var(--bc-muted)", fontSize: 14, marginBottom: 12 }}>
        Used only in customer search (Male / Female / Unisex filter). It does not add, change or remove any of your services.
      </p>
      {salonType && !confirmed && (
        <p className={`${styles.banner} ${styles.bannerWarning}`} role="status" style={{ marginBottom: 12 }}>
          Not confirmed yet, so customers see “Type not set”. Choose one below (tap the highlighted option to keep it).
        </p>
      )}
      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{notice}</p>}
      {salonType === null && !error && <p className={styles.loadingText}>Loading…</p>}
      {salonType !== null && (
        <div role="radiogroup" aria-labelledby="salon-type-heading" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {SALON_TYPE_CHOICES.map((c) => {
            const active = salonType === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving}
                onClick={() => void save(c.value)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 12,
                  border: active ? "2px solid var(--bc-accent)" : "1px solid var(--bc-border)",
                  background: active ? "var(--bc-accent-soft)" : "var(--bc-surface)",
                  color: "var(--bc-ink)",
                  cursor: saving ? "wait" : "pointer",
                }}
              >
                <strong style={{ display: "block", marginBottom: 2 }}>{c.label}</strong>
                <span style={{ display: "block", fontSize: 12, color: "var(--bc-muted)" }}>{c.help}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
