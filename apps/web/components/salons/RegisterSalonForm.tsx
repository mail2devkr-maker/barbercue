"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  COUNTRY_PATHS,
  DISCOVERY_PATHS,
  isValidPostalCode,
  phonePlaceholderForCountry,
  postalCodeRuleFor,
  registerSalonSchema,
} from "@barbercue/shared";
import type {
  CitySearchResultDto,
  CountryDto,
  LocalityDto,
  RegionDto,
  RegisterSalonResultDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { useAuth } from "../../lib/auth-context";
import { CitySearchField } from "./CitySearchField";
import {
  fieldWrapStyle,
  hintStyle,
  inputStyle,
  labelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./form-styles";

interface FormState {
  countryCode: string;
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  postalCode: string;
  localitySlug: string;
}

const EMPTY: FormState = {
  countryCode: "",
  name: "",
  phone: "",
  email: "",
  addressLine: "",
  postalCode: "",
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
  const [countries, setCountries] = useState<CountryDto[]>([]);
  // The country's database id, kept alongside form.countryCode (its ISO-3166-1 alpha-2). Both are
  // needed and neither replaces the other: the id scopes the regions/city-search lookups, while
  // the ISO code is what the POST salons contract and the postal/phone locale rules take.
  const [countryId, setCountryId] = useState("");
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);
  const [regionId, setRegionId] = useState("");
  const [selectedCity, setSelectedCity] = useState<CitySearchResultDto | null>(null);
  const [localities, setLocalities] = useState<LocalityDto[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationState>({ kind: "idle" });

  // The single source of truth for the city, derived rather than stored: with only one writer
  // (the picker's onSelect) the slug can never drift out of sync with the city shown on screen.
  const citySlug = selectedCity?.slug ?? "";

  useEffect(() => {
    let cancelled = false;
    // ~250 rows, the whole list. Deliberately NOT derived from cities/all any more: that endpoint
    // is a full-table read that now answers with ~99,800 cities / ~16 MB just to populate this
    // one dropdown. It still exists and is unchanged — this form simply no longer calls it.
    apiFetch<CountryDto[]>(COUNTRY_PATHS.countries)
      .then((list) => {
        if (!cancelled) setCountries(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Whether a Region step exists is decided ONLY by whether this call returns rows — never by
  // Country.hasSubdivisions (still at its schema default for every row) and never by inventing a
  // stand-in "National" region for a country that genuinely has no subdivisions.
  useEffect(() => {
    // Clearing the country empties the region list in selectCountry, not here — this effect only
    // ever loads.
    if (!countryId) return;
    let cancelled = false;
    // The loading flag is raised inside this .then(), not as a direct synchronous statement in
    // the effect body — same pattern as lib/auth-context.tsx's mount effect and the search page.
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setRegionsLoading(true);
        return apiFetch<RegionDto[]>(
          `${COUNTRY_PATHS.countries}/${countryId}/${COUNTRY_PATHS.regions}`,
        );
      })
      .then((list) => {
        if (!cancelled && list) setRegions(list);
      })
      .catch(() => {
        if (!cancelled) setRegions([]);
      })
      .finally(() => {
        if (!cancelled) setRegionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  useEffect(() => {
    if (!citySlug || !form.countryCode) return;
    let cancelled = false;
    apiFetch<LocalityDto[]>(
      `${DISCOVERY_PATHS.cities}/${form.countryCode}/${citySlug}/localities`,
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
  }, [form.countryCode, citySlug]);
  // Derived, not stored: avoids a synchronous setState-in-effect for the "city cleared" case —
  // the select below renders [] the instant citySlug is empty, no extra render needed.
  const localityOptions = citySlug ? localities : [];

  const postalRule = postalCodeRuleFor(form.countryCode);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Country is the top of the location chain, so changing it invalidates everything below: the
  // region list belongs to the old country, and the chosen city and its locality both belong to
  // the old region.
  function selectCountry(nextCountryId: string) {
    const country = countries.find((c) => c.id === nextCountryId);
    setCountryId(country ? country.id : "");
    setRegions([]);
    setRegionId("");
    setSelectedCity(null);
    setLocalities([]);
    setForm((prev) => ({ ...prev, countryCode: country?.isoCode2 ?? "", localitySlug: "" }));
  }

  // Region narrows the city search, so a different region invalidates the city under it.
  function selectRegion(nextRegionId: string) {
    setRegionId(nextRegionId);
    setSelectedCity(null);
    setLocalities([]);
    setForm((prev) => ({ ...prev, localitySlug: "" }));
  }

  function selectCity(city: CitySearchResultDto | null) {
    setSelectedCity(city);
    setLocalities([]);
    setForm((prev) => ({ ...prev, localitySlug: "" }));
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
    // The city picker is a combobox, not a <select required> — the browser can't enforce this
    // one for us, so it gets the same plain-language check the country above gets.
    if (!citySlug) {
      setError("Please search for and select your shop's city.");
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
      // Unchanged contract: the picker above only changes how the owner arrives at this slug,
      // never what is sent. POST salons still receives {countryCode, citySlug, localitySlug} —
      // never a countryId/regionId/cityId.
      citySlug,
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
          // Keyed on the country's id, not its ISO code: the id is what the regions and
          // city-search lookups below take, and form.countryCode is set from the same choice.
          value={countryId}
          onChange={(e) => selectCountry(e.target.value)}
          required
        >
          <option value="">Select a country…</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
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

      {/* Region is rendered only when the selected country actually has subdivisions in the
          database. A country that legitimately has none (a city-state, say) shows no Region step
          at all rather than an empty or invented one. */}
      {regionsLoading && countryId && (
        <div style={fieldWrapStyle}>
          <p style={{ ...hintStyle, marginTop: 0 }}>Loading regions…</p>
        </div>
      )}
      {!regionsLoading && regions.length > 0 && (
        <div style={fieldWrapStyle}>
          <label style={labelStyle} htmlFor="shop-region">State / region (optional)</label>
          <select
            id="shop-region"
            style={inputStyle}
            value={regionId}
            onChange={(e) => selectRegion(e.target.value)}
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <p style={hintStyle}>Narrows the city search below — helpful when two cities share a name.</p>
        </div>
      )}

      <div style={fieldWrapStyle}>
        <span id="shop-city-label" style={labelStyle}>City</span>
        <CitySearchField
          // Remounting on a scope change is what clears the picker's query and results — a plain
          // `key` instead of a reset effect reaching into the child's internals.
          key={`${countryId}:${regionId}`}
          countryId={countryId}
          regionId={regionId}
          selectedCity={selectedCity}
          onSelect={selectCity}
          labelledBy="shop-city-label"
        />
      </div>

      <div style={fieldWrapStyle}>
        <label style={labelStyle} htmlFor="shop-locality">Area / locality (optional)</label>
        <select
          id="shop-locality"
          style={inputStyle}
          value={form.localitySlug}
          onChange={(e) => update("localitySlug", e.target.value)}
          disabled={!citySlug}
        >
          <option value="">None</option>
          {localityOptions.map((l) => (
            <option key={l.slug} value={l.slug}>{l.name}</option>
          ))}
        </select>
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
