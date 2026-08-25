"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DISCOVERY_PATHS,
  isValidPostalCode,
  phonePlaceholderForCountry,
  postalCodeRuleFor,
  registerSalonSchema,
} from "@barbercue/shared";
import type { CityDto, LocalityDto, RegisterSalonResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { useAuth } from "../../lib/auth-context";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  border: "1px solid #D8D2C4",
  borderRadius: 8,
  // 16px minimum: anything smaller makes iOS Safari zoom the page on focus.
  fontSize: 16,
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 };
const fieldWrapStyle: React.CSSProperties = { marginBottom: 18 };
const hintStyle: React.CSSProperties = { fontSize: 13, color: "#6B6357", marginTop: 6 };

const primaryButtonStyle: React.CSSProperties = {
  padding: "13px 20px",
  minHeight: 46, // comfortable thumb target on a phone
  borderRadius: 8,
  border: "none",
  background: "#1C1A17",
  color: "#fff",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};
const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  minHeight: 42,
  borderRadius: 8,
  border: "1px solid #D8D2C4",
  background: "#fff",
  fontSize: 14,
  cursor: "pointer",
};

interface FormState {
  countryCode: string;
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  postalCode: string;
  citySlug: string;
  localitySlug: string;
}

const EMPTY: FormState = {
  countryCode: "",
  name: "",
  phone: "",
  email: "",
  addressLine: "",
  postalCode: "",
  citySlug: "",
  localitySlug: "",
};

// Coordinates never enter FormState — they are not something the owner edits, so they live in
// their own state, written only by the browser's Geolocation API and read only at submit.
type LocationState =
  | { kind: "idle" }
  | { kind: "detecting" }
  | { kind: "detected"; lat: number; lng: number; accuracyMetres: number | null }
  | { kind: "failed" };

// Rounded to 5 decimals (~1 m) before storing: a shop is a building, not a GPS fix, and the extra
// digits only record how precisely the owner's device happened to locate them.
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/**
 * Self-serve shop registration (major-upgrade phase; location + PIN-code UX reworked in Phase 11).
 *
 * Any authenticated user — including a customer who signed up seconds ago — can submit this; the
 * backend grants SALON_OWNER for the new shop in the same transaction that creates it. citySlug is
 * a required existing City (see registerSalonSchema's comment): a brand-new city with zero shops
 * can't self-register a first shop until an admin/seed process adds that City row — a known V1
 * limitation, not a bug.
 *
 * There is deliberately NO way to type a coordinate here. A salon owner should never have to know
 * what latitude means, so GPS is offered as one tap and is entirely optional: what actually
 * identifies the shop is address + area + city + PIN code, all of which the owner already knows by
 * heart. When GPS is unavailable or refused, registration proceeds without it and the shop is
 * fully functional — coordinates' only consumer is the schema.org `geo` block on the public salon
 * page, which omits itself when they're absent. The project has no geocoding service (deliberately
 * — that's an external dependency and a product decision), so an address is never turned into
 * coordinates behind the owner's back.
 */
export function RegisterSalonForm() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const [cities, setCities] = useState<CityDto[]>([]);
  const [localities, setLocalities] = useState<LocalityDto[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    // cities/all, not cities: the plain endpoint lists only cities that already contain an ACTIVE
    // salon, which would make the first shop in any city impossible to register.
    apiFetch<CityDto[]>(`${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.allCities}`)
      .then((list) => {
        if (!cancelled) setCities(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!form.citySlug || !form.countryCode) return;
    let cancelled = false;
    apiFetch<LocalityDto[]>(
      `${DISCOVERY_PATHS.cities}/${form.countryCode}/${form.citySlug}/localities`,
    )
      .then((list) => {
        if (!cancelled) setLocalities(list);
      })
      .catch(() => {
        if (!cancelled) setLocalities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.countryCode, form.citySlug]);
  // Derived, not stored: avoids a synchronous setState-in-effect for the "city cleared" case —
  // the select below renders [] the instant citySlug is empty, no extra render needed.
  const localityOptions = form.citySlug ? localities : [];

  // Countries come from the cities that actually exist, never from a hardcoded list: offering a
  // country with no city behind it would be a dead end, and inventing City rows to populate a
  // menu would be fabricated data.
  const countries = Array.from(
    new Map(cities.map((c) => [c.countryCode, c.country])).entries(),
  )
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const cityOptions = form.countryCode
    ? cities.filter((c) => c.countryCode === form.countryCode)
    : [];
  const postalRule = postalCodeRuleFor(form.countryCode);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      // Changing country invalidates the city, which invalidates the locality.
      ...(key === "countryCode" ? { citySlug: "", localitySlug: "" } : {}),
      ...(key === "citySlug" ? { localitySlug: "" } : {}),
    }));
  }

  // Only ever called from the button's onClick, never on mount. Browsers raise the permission
  // prompt the instant getCurrentPosition runs, and a prompt the owner didn't ask for is the
  // fastest way to earn a permanent "block" on the origin.
  function detectLocation() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocation({ kind: "failed" });
      return;
    }
    setLocation({ kind: "detecting" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          kind: "detected",
          lat: round5(position.coords.latitude),
          lng: round5(position.coords.longitude),
          accuracyMetres: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
        });
      },
      // Every failure reason collapses to one state on purpose: the owner's next move is the
      // same either way ("try again, or just carry on"), and explaining browser permission
      // internals to a barber helps nobody.
      () => setLocation({ kind: "failed" }),
      // enableHighAccuracy: a shop's pin needs building-level precision, not city-level.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.countryCode) {
      setError("Please choose the country your shop is in.");
      return;
    }
    // Checked ahead of the schema parse so a bad postal code reads as advice, not a regex failure.
    if (!isValidPostalCode(form.countryCode, form.postalCode)) {
      setError(
        postalRule.example
          ? `Please enter a valid ${postalRule.label}, for example ${postalRule.example}.`
          : `Please enter a valid ${postalRule.label}.`,
      );
      return;
    }

    const parsed = registerSalonSchema.safeParse({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      addressLine: form.addressLine.trim(),
      countryCode: form.countryCode,
      postalCode: form.postalCode.trim() || undefined,
      citySlug: form.citySlug,
      localitySlug: form.localitySlug || undefined,
      ...(location.kind === "detected" ? { lat: location.lat, lng: location.lng } : {}),
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
        <label style={labelStyle} htmlFor="shop-country">Country</label>
        <select
          id="shop-country"
          style={inputStyle}
          value={form.countryCode}
          onChange={(e) => update("countryCode", e.target.value)}
          required
        >
          <option value="">Select a country…</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        {countries.length === 0 && (
          <p style={hintStyle}>Loading countries…</p>
        )}
      </div>

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
        <input
          id="shop-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={phonePlaceholderForCountry(form.countryCode)}
          style={inputStyle}
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-email">Business email (optional)</label>
        <input
          id="shop-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          style={inputStyle}
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-address">Shop address</label>
        <input
          id="shop-address"
          style={inputStyle}
          value={form.addressLine}
          onChange={(e) => update("addressLine", e.target.value)}
          required
          maxLength={300}
          placeholder="Shop no., building, street"
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-pin">{postalRule.label}</label>
        <input
          id="shop-pin"
          // type="text" + inputMode="numeric", not type="number": a PIN code is an identifier,
          // and a number input brings spinner arrows, accepts "1e5", and silently strips a
          // leading zero the owner typed.
          type="text"
          // Numeric keypad only where the country's codes are digits-only (India). Elsewhere
          // postal codes contain letters, so forcing a numeric keypad would block valid input.
          inputMode={postalRule.regex.source.includes('[A-Za-z]') ? "text" : "numeric"}
          autoComplete="postal-code"
          maxLength={12}
          required={postalRule.required}
          placeholder={postalRule.example}
          style={{ ...inputStyle, maxWidth: 180, letterSpacing: "0.06em" }}
          value={form.postalCode}
          onChange={(e) => update("postalCode", e.target.value.slice(0, 12))}
        />
        <p style={hintStyle}>
          {postalRule.required
            ? `The ${postalRule.label.toLowerCase()} of your shop's area.`
            : `The ${postalRule.label.toLowerCase()} of your shop's area, if your country uses one.`}
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", ...fieldWrapStyle }}>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle} htmlFor="shop-city">City</label>
          <select
            id="shop-city"
            style={inputStyle}
            value={form.citySlug}
            onChange={(e) => update("citySlug", e.target.value)}
            disabled={!form.countryCode}
            required
          >
            <option value="">
              {form.countryCode ? "Select a city…" : "Choose a country first"}
            </option>
            {cityOptions.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle} htmlFor="shop-locality">Area / locality (optional)</label>
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

      <div style={{ ...fieldWrapStyle, border: "1px solid #E7E0D3", borderRadius: 10, padding: 14 }}>
        <span style={labelStyle}>Pin your shop on the map (optional)</span>
        <p style={{ ...hintStyle, marginTop: 0, marginBottom: 10 }}>
          Helps customers navigate straight to your door. Stand at your shop and tap the button.
        </p>

        {location.kind === "detected" && (
          <div>
            <p style={{ color: "#2E7D32", fontWeight: 600, fontSize: 14, margin: "0 0 2px" }}>
              📍 Location detected
            </p>
            <p style={{ ...hintStyle, marginTop: 0 }}>
              {location.accuracyMetres !== null ? `Accurate to about ${location.accuracyMetres} m. ` : ""}
              Saved with your shop so customers can navigate to you.
            </p>
            <button type="button" onClick={detectLocation} style={{ ...secondaryButtonStyle, marginTop: 4 }}>
              Update location
            </button>
          </div>
        )}

        {location.kind === "failed" && (
          <div>
            <p style={{ color: "#B36B00", fontWeight: 600, fontSize: 14, margin: "0 0 2px" }}>
              📍 We couldn&apos;t detect your location
            </p>
            <p style={{ ...hintStyle, marginTop: 0 }}>
              No problem — your address, area, city and PIN code above are enough to register. You
              can add your map pin later from your shop settings.
            </p>
            <button type="button" onClick={detectLocation} style={{ ...secondaryButtonStyle, marginTop: 4 }}>
              Try again
            </button>
          </div>
        )}

        {(location.kind === "idle" || location.kind === "detecting") && (
          <button
            type="button"
            onClick={detectLocation}
            disabled={location.kind === "detecting"}
            style={{ ...primaryButtonStyle, width: "100%" }}
          >
            {location.kind === "detecting" ? "Finding your location…" : "📍 Use my current location"}
          </button>
        )}
      </div>

      <button type="submit" disabled={submitting} style={{ ...primaryButtonStyle, width: "100%" }}>
        {submitting ? "Registering…" : "Register shop"}
      </button>
    </form>
  );
}
