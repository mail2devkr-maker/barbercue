"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, updateSalonProfileSchema } from "@barbercue/shared";
import type { SalonProfileDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

type FormState = {
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  postalCode: string;
  description: string;
};

function toForm(dto: SalonProfileDetailDto): FormState {
  return {
    name: dto.name,
    phone: dto.phone ?? "",
    email: dto.email ?? "",
    addressLine: dto.addressLine,
    postalCode: dto.postalCode ?? "",
    description: dto.description ?? "",
  };
}

/**
 * Shop profile (Part 2, admin delegated shop management) — the one place either the real owner or
 * a PLATFORM_ADMIN acting on their behalf can correct the shop's basic identity/contact details
 * after registration. No such control existed anywhere before this; same SalonProfileService,
 * same schema, same endpoint for both callers — there is no separate admin-only editor.
 *
 * Deliberately does not expose slug, city/locality, publicId, owner, or status — those are either
 * immutable in practice or already have their own dedicated, more carefully-gated control
 * elsewhere (timezone via TimezoneSection, status via the "Shop status" section on this same page).
 */
export function ProfileSection({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.profile}`;
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonProfileDetailDto>(base)
      .then((result) => {
        if (!cancelled) setForm(toForm(result));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load the shop profile.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId]);

  function update(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    const parsed = updateSalonProfileSchema.safeParse({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      addressLine: form.addressLine.trim(),
      postalCode: form.postalCode.trim(),
      description: form.description.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form for errors.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await apiFetch<SalonProfileDetailDto>(base, {
        method: "PATCH",
        body: JSON.stringify(parsed.data),
      });
      setForm(toForm(result));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the shop profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.dividerSection}>
      <h2 className={styles.sectionHeading}>Shop profile</h2>
      <p style={{ color: "var(--bc-muted)", fontSize: 14, marginBottom: 12 }}>
        Basic identity and contact details shown to customers. Your shop&apos;s web address, city
        and shop ID never change here — those stay fixed once registered.
      </p>
      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {!form && !error && <p className={styles.loadingText}>Loading…</p>}
      {form && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480 }}>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Shop name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)" }}
            />
          </label>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Phone</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update({ phone: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)" }}
            />
          </label>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update({ email: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)" }}
            />
          </label>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Address line</span>
            <input
              type="text"
              value={form.addressLine}
              onChange={(e) => update({ addressLine: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)" }}
            />
          </label>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Postal code</span>
            <input
              type="text"
              value={form.postalCode}
              onChange={(e) => update({ postalCode: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)" }}
            />
          </label>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Description</span>
            <textarea
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              rows={3}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)", font: "inherit" }}
            />
          </label>
          <div>
            <Button type="button" variant="secondary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
          {saved && (
            <p role="status" style={{ color: "var(--bc-success)", fontSize: 13 }}>
              Saved.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
