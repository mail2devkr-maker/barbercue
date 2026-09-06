"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CitySearchResultDto,
  CountryDto,
  PaginatedResult,
  SalonListItemDto,
} from "@barbercue/shared";
import { COUNTRY_PATHS, DISCOVERY_PATHS } from "@barbercue/shared";
import { SERVICE_CATEGORIES } from "../../../lib/editorial/manifest";
import { EditorialImage } from "../../../components/editorial/EditorialImage";
import { SalonCard } from "../../../components/discovery/SalonCard";
import { ShopServiceSearchField } from "../../../components/discovery/ShopServiceSearchField";
import { CitySearchField } from "../../../components/salons/CitySearchField";
import { Button } from "../../../components/ui/Button";
import { apiFetch } from "../../../lib/api";
import styles from "./search.module.css";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";

// Part 8/9 correction — same canonical km values and semantics as apps/mobile's
// SalonSearchScreen.tsx (kept in sync by hand; there's no shared cross-platform UI layer to derive
// this from). `null` = "Any" (clears the filter). Distance is only meaningful alongside lat/lng —
// see salonSearchQuerySchema's own doc comment — so those chips only render when nearMeActive.
const DISTANCE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Any distance" },
  { value: 0.1, label: "100 m" },
  { value: 0.2, label: "200 m" },
  { value: 0.5, label: "500 m" },
  { value: 1, label: "1 km" },
  { value: 2, label: "2 km" },
  { value: 3, label: "3 km" },
  { value: 5, label: "5 km" },
];

const PRICE_OPTIONS: { min: number | null; max: number | null; label: string }[] = [
  { min: null, max: null, label: "Any price" },
  { min: null, max: 300, label: "Under 300" },
  { min: 300, max: 600, label: "300 – 600" },
  { min: 600, max: 1000, label: "600 – 1000" },
  { min: 1000, max: null, label: "1000+" },
];

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  // Issue #13 Mission D: real city autocomplete needs a country to scope the search to (the
  // backend's cities/search endpoint is deliberately country-scoped — see CitySearchField's own
  // doc comment on why an unscoped ~100K-row global search isn't safe to ship). This product's
  // real data is India-only today, so that's the working default; a genuine multi-country
  // catalog would need an actual country selector here, not a silent guess at that point.
  const [defaultCountryId, setDefaultCountryId] = useState("");
  const [selectedCity, setSelectedCity] = useState<CitySearchResultDto | null>(null);
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const styleName = searchParams.get("style") ?? undefined;
  const nearMeActive = searchParams.has("lat") && searchParams.has("lng");

  // Part 8/9 correction — URL params are the source of truth (same pattern as q/city/lat/lng
  // above), so a shared/bookmarked search link reproduces the exact same filtered results.
  const radiusKmParam = searchParams.get("radiusKm");
  const activeRadiusKm = radiusKmParam !== null ? Number(radiusKmParam) : null;
  const priceMinParam = searchParams.get("priceMin");
  const priceMaxParam = searchParams.get("priceMax");
  const activePriceMin = priceMinParam !== null ? Number(priceMinParam) : null;
  const activePriceMax = priceMaxParam !== null ? Number(priceMaxParam) : null;

  function selectRadius(value: number | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete("radiusKm");
    else params.set("radiusKm", String(value));
    router.push(`/search?${params.toString()}`);
  }

  function selectPrice(min: number | null, max: number | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (min === null) params.delete("priceMin");
    else params.set("priceMin", String(min));
    if (max === null) params.delete("priceMax");
    else params.set("priceMax", String(max));
    router.push(`/search?${params.toString()}`);
  }

  useEffect(() => {
    apiFetch<CountryDto[]>(COUNTRY_PATHS.countries)
      .then((countries) => {
        const india = countries.find((c) => c.isoCode2 === "IN");
        if (india) setDefaultCountryId(india.id);
      })
      .catch(() => {
        /* City autocomplete just stays disabled — "Shop or service" search and Near Me still work */
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    // city/countryCode already arrive as real slugs/codes here (from CitySearchField's own
    // selection, or a shared/bookmarked URL) — no client-side normalization needed or safe to do.
    for (const key of ["q", "city", "countryCode", "locality", "service", "lat", "lng", "radiusKm", "priceMin", "priceMax"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }

    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        return fetch(`${API_BASE_URL}/${DISCOVERY_PATHS.salons}?${params.toString()}`);
      })
      .then((response) => {
        if (!response) return undefined;
        if (!response.ok) throw new Error(`Search failed with ${response.status}`);
        return response.json() as Promise<PaginatedResult<SalonListItemDto>>;
      })
      .then((data) => {
        if (!cancelled && data) setResults(data.items);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn’t load shops right now. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryKey, searchParams]);

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (selectedCity) {
      params.set("city", selectedCity.slug);
      params.set("countryCode", selectedCity.countryCode);
    }
    if (styleName) params.set("style", styleName);
    router.push(`/search${params.size ? `?${params.toString()}` : ""}`);
  }

  // "Near Me" (Phase 4) — the browser's own Geolocation API, no paid Maps/geocoding SDK. On
  // denial/unavailability this degrades gracefully to the existing city/text search rather than
  // blocking the page; nothing here claims a location the browser didn't actually provide.
  function handleNearMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("Location isn't available in this browser. Try searching by city instead.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const params = new URLSearchParams(searchParams.toString());
        params.set("lat", String(position.coords.latitude));
        params.set("lng", String(position.coords.longitude));
        router.push(`/search?${params.toString()}`);
      },
      (err) => {
        setLocating(false);
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Try searching by city instead."
            : "Couldn't get your location. Try searching by city instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  function clearNearMe() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("lat");
    params.delete("lng");
    // radiusKm is meaningless without a query point (see salonSearchQuerySchema's own doc
    // comment) — dropped here too so it doesn't linger as a dead param a shared link would carry.
    params.delete("radiusKm");
    router.push(`/search${params.size ? `?${params.toString()}` : ""}`);
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-labelledby="search-heading">
        <p className={styles.eyebrow}>Barbershop discovery</p>
        <h1 id="search-heading">Find the right chair for your next cut.</h1>
        <p className={styles.lead}>
          Browse local barbershops, compare services, then book ahead or join a live queue.
        </p>

        <form className={styles.searchForm} onSubmit={handleSubmit} role="search">
          <div className={styles.field}>
            <span id="search-q-label">Shop or service</span>
            <ShopServiceSearchField value={q} onChange={setQ} onSubmit={() => handleSubmit()} />
          </div>
          <div className={styles.field}>
            <span id="search-city-label">City</span>
            {defaultCountryId ? (
              <CitySearchField
                countryId={defaultCountryId}
                regionId=""
                selectedCity={selectedCity}
                onSelect={setSelectedCity}
                labelledBy="search-city-label"
              />
            ) : (
              <input type="search" placeholder="Loading cities…" disabled />
            )}
          </div>
          <Button type="submit" variant="primary">
            Find shops
          </Button>
          <Button type="button" variant="outline" onClick={handleNearMe} disabled={locating}>
            {locating ? "Locating…" : nearMeActive ? "Near me ✓" : "Near me"}
          </Button>
        </form>
        {locationError && <p className={styles.locationNotice}>{locationError}</p>}
        {nearMeActive && (
          <button type="button" className={styles.textLink} onClick={clearNearMe}>
            Clear &ldquo;Near me&rdquo; and sort by name instead
          </button>
        )}

        {/* Part 8/9 correction — distance filter. Only shown once a query point exists; radiusKm
            is otherwise meaningless server-side (see salonSearchQuerySchema's own doc comment). If
            location is unavailable, this simply doesn't render — the existing "Near me" button's
            own locationError message above already explains why. */}
        {nearMeActive && (
          <div className={styles.filterGroup}>
            <span className={styles.filterGroupLabel}>Distance</span>
            <div className={styles.filterChips}>
              {DISTANCE_OPTIONS.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  className={`${styles.filterChip} ${activeRadiusKm === option.value ? styles.filterChipActive : ""}`}
                  aria-pressed={activeRadiusKm === option.value}
                  onClick={() => selectRadius(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Price filter — always available (unlike distance, price never depends on a query
            point). Independent of the service/q text search only when no `service`/`q` matched a
            specific service — see SalonsService.search's own doc comment on the same-service
            requirement this now enforces when both are present. */}
        <div className={styles.filterGroup}>
          <span className={styles.filterGroupLabel}>Price</span>
          <div className={styles.filterChips}>
            {PRICE_OPTIONS.map((option) => {
              const active = activePriceMin === option.min && activePriceMax === option.max;
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`${styles.filterChip} ${active ? styles.filterChipActive : ""}`}
                  aria-pressed={active}
                  onClick={() => selectPrice(option.min, option.max)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <nav className={styles.categoryChips} aria-label="Browse by category">
          {SERVICE_CATEGORIES.map((category) => (
            <Link
              key={category.id}
              href={`/search?service=${encodeURIComponent(category.query)}`}
              className={styles.categoryChip}
            >
              <span className={styles.categoryChipArt}>
                <EditorialImage id={category.assetId} width={32} height={24} />
              </span>
              {category.label}
            </Link>
          ))}
        </nav>
      </section>

      {styleName && (
        <aside className={styles.styleNotice}>
          <span aria-hidden="true">✦</span>
          <p>
            Your <strong>{styleName}</strong> inspiration is ready. Choose a shop and we’ll carry it
            into booking.
          </p>
        </aside>
      )}

      <section className={styles.results} aria-labelledby="results-heading" aria-live="polite">
        <div className={styles.resultsHeading}>
          <div>
            <p className={styles.eyebrow}>Nearby possibilities</p>
            <h2 id="results-heading">
              {loading
                ? "Finding shops"
                : error
                  ? "Shops unavailable"
                  : `${results.length} ${results.length === 1 ? "shop" : "shops"} shown`}
            </h2>
          </div>
          {!loading && !error && results.length > 0 && <p>Real availability appears when you book.</p>}
        </div>

        {loading && (
          <div className={styles.grid} aria-label="Loading shops" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <div className={styles.skeleton} key={item} aria-hidden="true">
                <span />
                <i />
                <i />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className={styles.stateCard} role="alert">
            <span className={styles.stateIcon} aria-hidden="true">!</span>
            <h2>Search hit a snag</h2>
            <p>{error}</p>
            <Button type="button" variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className={styles.stateCard}>
            <span className={styles.stateIcon} aria-hidden="true">⌖</span>
            <h2>No shops match that search yet</h2>
            <p>Try a nearby city, a broader service, or clear one of your search terms.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQ("");
                setSelectedCity(null);
                router.push("/search");
              }}
            >
              Clear search
            </Button>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <div className={styles.grid}>
            {results.map((salon) => (
              <SalonCard key={salon.id} salon={salon} styleName={styleName} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
