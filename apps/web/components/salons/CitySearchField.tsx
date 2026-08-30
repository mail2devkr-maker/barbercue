"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { CitySearchResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import { hintStyle, inputStyle } from "./form-styles";

// Long enough that a stray keystroke never costs a request, short enough that the list still
// feels live while the owner is mid-word.
const SEARCH_DEBOUNCE_MS = 300;
// Mirrors the endpoint's own MIN_SEARCH_QUERY_LENGTH (cities.service.ts short-circuits to [] below
// it) — checked here too so one typed letter is a quiet "keep typing" state rather than a wasted
// round trip that comes back empty and reads like "no such city".
const MIN_QUERY_LENGTH = 2;
// Deliberately small. This is a picker, not a browse page: past a handful of rows it is faster to
// type one more letter than to read the list, and a long dropdown at ~100K-cities-per-country
// scale is exactly the payload problem this flow exists to avoid.
const RESULT_LIMIT = 8;

type SearchState =
  | { kind: "idle" } // nothing typed, or still under MIN_QUERY_LENGTH
  | { kind: "loading" }
  | { kind: "results"; cities: CitySearchResultDto[] }
  | { kind: "failed" }
  | { kind: "creating" } // Issue 7 — submitting the "Use as entered" fallback
  | { kind: "create-failed"; message: string };

interface CitySearchFieldProps {
  /** Empty until a country is chosen — the search endpoint requires it, so we don't call without. */
  countryId: string;
  /** Empty means "all regions in this country", not "a region called empty". */
  regionId: string;
  selectedCity: CitySearchResultDto | null;
  onSelect: (city: CitySearchResultDto | null) => void;
  /** id of the caller's label element — the input is swapped out on select, so it can't own one. */
  labelledBy: string;
}

/** "Karnataka" / "Karnataka (KA)" / null — never a fabricated placeholder for a region-less city. */
function regionLabel(city: CitySearchResultDto): string | null {
  if (!city.region) return null;
  return city.region.code ? `${city.region.name} (${city.region.code})` : city.region.name;
}

/**
 * Type-to-search city picker for shop registration (Phase 6B).
 *
 * Replaces a `<select>` populated from GET cities/all. That endpoint still exists and is
 * unchanged, but it is a full-table read: against the imported global dataset it answers with
 * ~99,800 rows / ~16 MB, which no browser should be asked to download to fill a dropdown. Here
 * the browser only ever fetches the <=8 cities matching what the owner actually typed, scoped to
 * the country (and region) they already picked.
 *
 * What leaves this component is the whole CitySearchResultDto, but only its `slug` reaches the
 * registration payload — the POST salons contract stays {countryCode, citySlug, localitySlug} and
 * is untouched. The id/region fields are for display and for the locality lookup, never submitted.
 */
export function CitySearchField({
  countryId,
  regionId,
  selectedCity,
  onSelect,
  labelledBy,
}: CitySearchFieldProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic request counter. Two searches raced ("ben" then "beng") can resolve out of order,
  // and the slower-but-older one must never repaint the list underneath a newer answer — so a
  // response is applied only while it is still the most recent one issued.
  const requestSeqRef = useRef(0);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => {
    // Nothing to search against, the picker is already satisfied, or the owner hasn't typed
    // enough yet. `tooShort` is handled by hiding the list at render time rather than by
    // resetting state here, so this effect never touches state synchronously.
    if (!countryId || selectedCity || tooShort) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (requestSeqRef.current += 1);
      setState({ kind: "loading" });

      const params = new URLSearchParams({ countryId, q: trimmed, limit: String(RESULT_LIMIT) });
      if (regionId) params.set("regionId", regionId);

      apiFetch<CitySearchResultDto[]>(
        `${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?${params.toString()}`,
      )
        .then((cities) => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setActiveIndex(0);
          setState({ kind: "results", cities });
        })
        .catch(() => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setState({ kind: "failed" });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort, countryId, regionId, selectedCity]);

  function choose(city: CitySearchResultDto) {
    onSelect(city);
    setQuery("");
    setState({ kind: "idle" });
    setActiveIndex(0);
  }

  function clearSelection() {
    onSelect(null);
    // The input only mounts once selectedCity is null, so focus has to wait for that render.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /**
   * Issue 7 — "Use '<name>' as entered". Only reachable after a real search already came back
   * empty (see the render branch below), so this never bypasses search; it's what search hands
   * off to when the ~99,800-row imported master list genuinely has no match for this city.
   */
  async function createAsEntered() {
    const name = trimmed;
    if (!name || !countryId) return;
    setState({ kind: "creating" });
    try {
      const created = await apiFetch<CitySearchResultDto>(DISCOVERY_PATHS.cities, {
        method: "POST",
        body: JSON.stringify({ name, countryId, regionId: regionId || undefined }),
      });
      choose(created);
    } catch (err) {
      setState({
        kind: "create-failed",
        message: err instanceof ApiError ? err.message : "Could not add this city. Please try again.",
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const cities = !tooShort && state.kind === "results" ? state.cities : [];
    if (e.key === "ArrowDown" && cities.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % cities.length);
    } else if (e.key === "ArrowUp" && cities.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + cities.length) % cities.length);
    } else if (e.key === "Enter") {
      // Always swallowed while the picker has focus: this input sits inside the registration
      // <form>, so a bare Enter here would otherwise submit a half-filled shop registration.
      e.preventDefault();
      const city = cities[activeIndex];
      if (city) choose(city);
    } else if (e.key === "Escape" && cities.length > 0) {
      e.preventDefault();
      setState({ kind: "idle" });
    }
  }

  if (selectedCity) {
    const region = regionLabel(selectedCity);
    return (
      <div
        style={{
          ...inputStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 8px 8px 12px",
          background: "var(--bc-gold-soft)",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--bc-ink)" }}>{selectedCity.name}</span>
          {region && <span style={{ ...hintStyle, marginTop: 0, display: "block" }}>{region}</span>}
        </span>
        <div style={{ flexShrink: 0 }}>
          <Button type="button" variant="outline" onClick={clearSelection}>
            Change
          </Button>
        </div>
      </div>
    );
  }

  // Below the minimum length the box reads as "keep typing", so whatever the last completed
  // search returned is hidden rather than left on screen attached to a query that no longer
  // exists. The state itself is left alone — the next search overwrites it.
  const cities = !tooShort && state.kind === "results" ? state.cities : [];
  const expanded = cities.length > 0;

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        aria-labelledby={labelledBy}
        // A city name is not an address line — browsers offering a saved street address here is
        // noise that covers the results list we are drawing ourselves.
        autoComplete="off"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listboxId}-${activeIndex}` : undefined}
        style={inputStyle}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!countryId}
        placeholder={countryId ? "Start typing your city…" : "Choose a country first"}
      />

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "#fff",
            border: "1px solid var(--bc-border)",
            borderRadius: "var(--bc-radius-sm)",
            boxShadow: "var(--bc-shadow-lg)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {cities.map((city, index) => {
            const region = regionLabel(city);
            return (
              <li
                key={city.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // onMouseDown, not onClick: click fires after blur, and blurring the input first
                // would let any future close-on-blur behaviour unmount the row mid-click.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(city);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  padding: "9px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: index === activeIndex ? "var(--bc-gold-soft)" : "transparent",
                }}
              >
                <span style={{ fontSize: 15, color: "var(--bc-ink)" }}>{city.name}</span>
                {region && <span style={{ ...hintStyle, marginTop: 0, display: "block" }}>{region}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {!tooShort && state.kind === "loading" && <p style={hintStyle}>Searching cities…</p>}
      {!tooShort && state.kind === "results" && cities.length === 0 && (
        <div style={{ marginTop: 6 }}>
          <p style={hintStyle}>No matching city found for “{trimmed}”.</p>
          <Button type="button" variant="outline" onClick={() => void createAsEntered()}>
            Use &ldquo;{trimmed}&rdquo; as entered
          </Button>
        </div>
      )}
      {state.kind === "creating" && <p style={hintStyle}>Adding “{trimmed}”…</p>}
      {state.kind === "create-failed" && (
        <div style={{ marginTop: 6 }}>
          <p style={{ ...hintStyle, color: "var(--bc-accent)" }}>{state.message}</p>
          <Button type="button" variant="outline" onClick={() => void createAsEntered()}>
            Try again — use &ldquo;{trimmed}&rdquo; as entered
          </Button>
        </div>
      )}
      {!tooShort && state.kind === "failed" && (
        <p style={{ ...hintStyle, color: "var(--bc-accent)" }}>Could not search cities. Please try again.</p>
      )}
      {tooShort && countryId && (
        <p style={hintStyle}>Type at least {MIN_QUERY_LENGTH} letters of your city&apos;s name.</p>
      )}
    </div>
  );
}
