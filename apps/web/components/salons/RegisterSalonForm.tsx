"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DISCOVERY_PATHS, registerSalonSchema } from "@barbercue/shared";
import type { CityDto, LocalityDto, RegisterSalonResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { useAuth } from "../../lib/auth-context";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #D8D2C4",
  borderRadius: 8,
  fontSize: 15,
};
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 };
const fieldWrapStyle: React.CSSProperties = { marginBottom: 18 };

interface FormState {
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  lat: string;
  lng: string;
  citySlug: string;
  localitySlug: string;
}

const EMPTY: FormState = {
  name: "",
  phone: "",
  email: "",
  addressLine: "",
  lat: "",
  lng: "",
  citySlug: "",
  localitySlug: "",
};

// Self-serve shop registration (major-upgrade phase). Any authenticated user — including a
// customer who signed up seconds ago — can submit this; the backend grants SALON_OWNER for the
// new shop in the same transaction that creates it. citySlug is a required existing City (see
// registerSalonSchema's comment): a brand-new city with zero shops can't self-register a first
// shop until an admin/seed process adds that City row — a known V1 limitation, not a bug.
export function RegisterSalonForm() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const [cities, setCities] = useState<CityDto[]>([]);
  const [localities, setLocalities] = useState<LocalityDto[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CityDto[]>(DISCOVERY_PATHS.cities)
      .then((list) => {
        if (!cancelled) setCities(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!form.citySlug) return;
    let cancelled = false;
    apiFetch<LocalityDto[]>(`${DISCOVERY_PATHS.cities}/${form.citySlug}/localities`)
      .then((list) => {
        if (!cancelled) setLocalities(list);
      })
      .catch(() => {
        if (!cancelled) setLocalities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.citySlug]);
  // Derived, not stored: avoids a synchronous setState-in-effect for the "city cleared" case —
  // the select below renders [] the instant citySlug is empty, no extra render needed.
  const localityOptions = form.citySlug ? localities : [];

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value, ...(key === "citySlug" ? { localitySlug: "" } : {}) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = registerSalonSchema.safeParse({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      addressLine: form.addressLine.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      citySlug: form.citySlug,
      localitySlug: form.localitySlug || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form for errors.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<RegisterSalonResultDto>(DISCOVERY_PATHS.salons, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify(parsed.data),
      });
      // Grants SALON_OWNER server-side, but the access token we're still holding was issued
      // before that — refreshSession() rotates it so /dashboard/salons's role check passes.
      await refreshSession();
      router.push(`/dashboard/salons/${result.id}/settings`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register this shop. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 480 }}>
      {error && (
        <p style={{ background: "#FBEAEA", color: "#B0413E", padding: "10px 14px", borderRadius: 8, marginBottom: 18 }}>
          {error}
        </p>
      )}

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-name">Shop name</label>
        <input
          id="shop-name"
          style={inputStyle}
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          required
          maxLength={200}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-phone">Phone (optional)</label>
        <input id="shop-phone" style={inputStyle} value={form.phone} onChange={(e) => update("phone", e.target.value)} />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-email">Business email (optional)</label>
        <input
          id="shop-email"
          type="email"
          style={inputStyle}
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-address">Address</label>
        <input
          id="shop-address"
          style={inputStyle}
          value={form.addressLine}
          onChange={(e) => update("addressLine", e.target.value)}
          required
          maxLength={300}
        />
      </div>

      <div style={{ display: "flex", gap: 12, ...fieldWrapStyle }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="shop-city">City</label>
          <select id="shop-city" style={inputStyle} value={form.citySlug} onChange={(e) => update("citySlug", e.target.value)} required>
            <option value="">Select a city…</option>
            {cities.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="shop-locality">Locality (optional)</label>
          <select
            id="shop-locality"
            style={inputStyle}
            value={form.localitySlug}
            onChange={(e) => update("localitySlug", e.target.value)}
            disabled={!form.citySlug}
          >
            <option value="">None</option>
            {localityOptions.map((l) => (
              <option key={l.slug} value={l.slug}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, ...fieldWrapStyle }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="shop-lat">Latitude</label>
          <input
            id="shop-lat"
            style={inputStyle}
            value={form.lat}
            onChange={(e) => update("lat", e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 12.9716"
            required
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="shop-lng">Longitude</label>
          <input
            id="shop-lng"
            style={inputStyle}
            value={form.lng}
            onChange={(e) => update("lng", e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 77.6412"
            required
          />
        </div>
      </div>
      <p style={{ fontSize: 13, color: "#6B6357", marginTop: -10, marginBottom: 18 }}>
        Tip: right-click your shop&apos;s location on Google Maps to copy its coordinates.
      </p>

      <button type="submit" disabled={submitting} style={{ padding: "12px 20px", borderRadius: 8, fontWeight: 600 }}>
        {submitting ? "Registering…" : "Register shop"}
      </button>
    </form>
  );
}
