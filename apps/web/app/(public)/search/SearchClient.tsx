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
    for (const key of ["q", "city", "countryCode", "locality", "service", "lat", "lng"]) {
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
