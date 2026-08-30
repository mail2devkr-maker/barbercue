"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  CitySearchResultDto,
  PaginatedResult,
  SalonListItemDto,
  SearchSuggestResultDto,
} from "@barbercue/shared";
import { DISCOVERY_PATHS, SEARCH_PATHS } from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import { SERVICE_CATEGORIES } from "../../../lib/editorial/manifest";
import { EditorialImage } from "../../../components/editorial/EditorialImage";
import { SalonCard } from "../../../components/discovery/SalonCard";
import { Button } from "../../../components/ui/Button";
import styles from "./search.module.css";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
// Same "still typing" convention as CitySearchField/CitiesService.searchCities.
const SUGGEST_MIN_LENGTH = 2;
const SUGGEST_DEBOUNCE_MS = 250;

function cityNameToSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type SuggestState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "failed" };

/**
 * Debounced, race-safe autosuggest fetch (Issue 3/10) — same monotonic-request-sequence pattern
 * as CitySearchField, generalized so the "shop or service" and "city" fields on this page can
 * share it instead of duplicating the debounce/race-guard logic twice.
 */
function useSuggestions<T>(
  query: string,
  fetcher: (trimmed: string) => Promise<T>,
): SuggestState<T> {
  const [state, setState] = useState<SuggestState<T>>({ kind: "idle" });
  const seqRef = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    // Below the minimum length, nothing is fetched and the state is left exactly as it was —
    // callers must gate rendering on their own `trimmed.length >= SUGGEST_MIN_LENGTH` check (see
    // qExpanded/cityExpanded below), the same "hide stale results rather than reset state
    // synchronously in an effect" convention CitySearchField already uses.
    if (trimmed.length < SUGGEST_MIN_LENGTH) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (seqRef.current += 1);
      setState({ kind: "loading" });
      fetcher(trimmed)
        .then((data) => {
          if (!cancelled && seq === seqRef.current) setState({ kind: "ready", data });
        })
        .catch(() => {
          if (!cancelled && seq === seqRef.current) setState({ kind: "failed" });
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher is expected to be stable per call site
  }, [trimmed]);

  return state;
}

/** "Karnataka" / "Karnataka (KA)" / null — never a fabricated placeholder for a region-less city. */
function regionLabel(city: CitySearchResultDto): string | null {
  if (!city.region) return null;
  return city.region.code ? `${city.region.name} (${city.region.code})` : city.region.name;
}

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const styleName = searchParams.get("style") ?? undefined;
  const nearMeActive = searchParams.has("lat") && searchParams.has("lng");

  // Issue 3/10 — typo-tolerant autosuggest for both search fields. Each field tracks whether its
  // own dropdown should be open (focus + enough text) independently of the other.
  const qListboxId = useId();
  const cityListboxId = useId();
  const [qOpen, setQOpen] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [qActiveIndex, setQActiveIndex] = useState(0);
  const [cityActiveIndex, setCityActiveIndex] = useState(0);
  // A precise selection made by clicking a suggestion — carried into the submitted search as an
  // exact filter (service name / city slug+country) rather than the fuzzy free-text `q`/`city`
  // fields. Cleared the instant the owner edits the text again, since it can no longer be trusted
  // to describe what's now typed.
  const [serviceSelection, setServiceSelection] = useState<string | null>(null);
  const [citySelection, setCitySelection] = useState<CitySearchResultDto | null>(null);

  const qSuggest = useSuggestions(q, (trimmed) =>
    apiFetch<SearchSuggestResultDto>(
      `${SEARCH_PATHS.search}/${SEARCH_PATHS.suggest}?q=${encodeURIComponent(trimmed)}`,
    ),
  );
  const citySuggest = useSuggestions(city, (trimmed) =>
    apiFetch<CitySearchResultDto[]>(
      `${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?q=${encodeURIComponent(trimmed)}`,
    ),
  );
  const qShops = qSuggest.kind === "ready" ? qSuggest.data.shops : [];
  const qServices = qSuggest.kind === "ready" ? qSuggest.data.services : [];
  const qOptionCount = qShops.length + qServices.length;
  const cityOptions = citySuggest.kind === "ready" ? citySuggest.data : [];
  const qExpanded = qOpen && q.trim().length >= SUGGEST_MIN_LENGTH;
  const cityExpanded = cityOpen && city.trim().length >= SUGGEST_MIN_LENGTH;

  function chooseShop(shop: SearchSuggestResultDto["shops"][number]) {
    setQOpen(false);
    router.push(`/${shop.countryCode.toLowerCase()}/${shop.citySlug}/${shop.slug}`);
  }

  function chooseService(service: SearchSuggestResultDto["services"][number]) {
    setQ(service.name);
    setServiceSelection(service.name);
    setQOpen(false);
  }

  function chooseCity(picked: CitySearchResultDto) {
    setCity(picked.name);
    setCitySelection(picked);
    setCityOpen(false);
  }

  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of ["q", "city", "countryCode", "locality", "service", "lat", "lng"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, key === "city" ? cityNameToSlug(value) : value);
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

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setQOpen(false);
    setCityOpen(false);
    const params = new URLSearchParams();
    const trimmedQ = q.trim();
    // A precise pick from the suggestion dropdown, still unedited since — filters by the exact
    // service name (Service.name/category) rather than the fuzzy salon-name/description `q` OR,
    // which is what made "fade" also (correctly, but non-specifically) match a salon literally
    // named "Fade Barbershop".
    if (serviceSelection && trimmedQ === serviceSelection) {
      params.set("service", serviceSelection);
    } else if (trimmedQ) {
      params.set("q", trimmedQ);
    }
    // A precise city pick carries its real slug + countryCode straight through (Issue 10) — no
    // longer round-tripped through cityNameToSlug's lossy guess, and now unambiguous even when two
    // countries share a city name. Free-text entry (no pick, or edited since picking) falls back
    // to the original best-effort slugify, unscoped by country exactly as before.
    if (citySelection && city.trim() === citySelection.name) {
      params.set("city", citySelection.slug);
      params.set("countryCode", citySelection.countryCode);
    } else {
      const normalizedCity = cityNameToSlug(city);
      if (normalizedCity) params.set("city", normalizedCity);
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
          <label className={styles.field}>
            <span>Shop or service</span>
            <input
              type="search"
              placeholder="Fade, beard trim, shop name…"
              value={q}
              role="combobox"
              aria-expanded={qExpanded && qOptionCount > 0}
              aria-controls={qListboxId}
              aria-autocomplete="list"
              aria-activedescendant={qExpanded && qOptionCount > 0 ? `${qListboxId}-${qActiveIndex}` : undefined}
              autoComplete="off"
              onChange={(event) => {
                const value = event.target.value;
                setQ(value);
                if (serviceSelection && value !== serviceSelection) setServiceSelection(null);
                setQActiveIndex(0);
                setQOpen(true);
              }}
              onFocus={() => setQOpen(true)}
              onBlur={() => setQOpen(false)}
              onKeyDown={(event) => {
                if (!qExpanded || qOptionCount === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setQActiveIndex((i) => (i + 1) % qOptionCount);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setQActiveIndex((i) => (i - 1 + qOptionCount) % qOptionCount);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (qActiveIndex < qShops.length) chooseShop(qShops[qActiveIndex]);
                  else chooseService(qServices[qActiveIndex - qShops.length]);
                } else if (event.key === "Escape") {
                  setQOpen(false);
                }
              }}
            />
            {qExpanded && (qOptionCount > 0 || qSuggest.kind === "loading") && (
              <ul id={qListboxId} role="listbox" className={styles.suggestList}>
                {qSuggest.kind === "loading" && qOptionCount === 0 && (
                  <li className={styles.suggestEmpty}>Searching…</li>
                )}
                {qShops.length > 0 && <li className={styles.suggestGroupLabel}>Shops</li>}
                {qShops.map((shop, index) => (
                  <li
                    key={shop.id}
                    id={`${qListboxId}-${index}`}
                    role="option"
                    aria-selected={index === qActiveIndex}
                    className={`${styles.suggestOption} ${index === qActiveIndex ? styles.suggestOptionActive : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      chooseShop(shop);
                    }}
                    onMouseEnter={() => setQActiveIndex(index)}
                  >
                    <span className={styles.suggestOptionName}>{shop.name}</span>
                    <span className={styles.suggestOptionMeta}>{shop.citySlug}</span>
                  </li>
                ))}
                {qServices.length > 0 && <li className={styles.suggestGroupLabel}>Services</li>}
                {qServices.map((service, serviceIndex) => {
                  const index = qShops.length + serviceIndex;
                  return (
                    <li
                      key={service.name}
                      id={`${qListboxId}-${index}`}
                      role="option"
                      aria-selected={index === qActiveIndex}
                      className={`${styles.suggestOption} ${index === qActiveIndex ? styles.suggestOptionActive : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        chooseService(service);
                      }}
                      onMouseEnter={() => setQActiveIndex(index)}
                    >
                      <span className={styles.suggestOptionName}>{service.name}</span>
                      {service.category && <span className={styles.suggestOptionMeta}>{service.category}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </label>
          <label className={styles.field}>
            <span>City</span>
            <input
              type="search"
              placeholder="For example, Bengaluru"
              value={city}
              role="combobox"
              aria-expanded={cityExpanded && cityOptions.length > 0}
              aria-controls={cityListboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                cityExpanded && cityOptions.length > 0 ? `${cityListboxId}-${cityActiveIndex}` : undefined
              }
              autoComplete="off"
              onChange={(event) => {
                const value = event.target.value;
                setCity(value);
                if (citySelection && value !== citySelection.name) setCitySelection(null);
                setCityActiveIndex(0);
                setCityOpen(true);
              }}
              onFocus={() => setCityOpen(true)}
              onBlur={() => setCityOpen(false)}
              onKeyDown={(event) => {
                if (!cityExpanded || cityOptions.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCityActiveIndex((i) => (i + 1) % cityOptions.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCityActiveIndex((i) => (i - 1 + cityOptions.length) % cityOptions.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  chooseCity(cityOptions[cityActiveIndex]);
                } else if (event.key === "Escape") {
                  setCityOpen(false);
                }
              }}
            />
            {cityExpanded && (cityOptions.length > 0 || citySuggest.kind !== "idle") && (
              <ul id={cityListboxId} role="listbox" className={styles.suggestList}>
                {citySuggest.kind === "loading" && <li className={styles.suggestEmpty}>Searching…</li>}
                {citySuggest.kind === "ready" && cityOptions.length === 0 && (
                  <li className={styles.suggestEmpty}>No matching city — you can still search with what you typed.</li>
                )}
                {cityOptions.map((option, index) => {
                  const region = regionLabel(option);
                  return (
                    <li
                      key={option.id}
                      id={`${cityListboxId}-${index}`}
                      role="option"
                      aria-selected={index === cityActiveIndex}
                      className={`${styles.suggestOption} ${index === cityActiveIndex ? styles.suggestOptionActive : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        chooseCity(option);
                      }}
                      onMouseEnter={() => setCityActiveIndex(index)}
                    >
                      <span className={styles.suggestOptionName}>{option.name}</span>
                      <span className={styles.suggestOptionMeta}>
                        {[region, option.countryName].filter(Boolean).join(", ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </label>
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
                setCity("");
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
