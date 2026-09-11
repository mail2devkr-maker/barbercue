"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COUNTRY_PATHS, DISCOVERY_PATHS } from "@barbercue/shared";
import type { CityDto, CitySearchResultDto, CountryDto, PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { LocationIcon, SearchIcon } from "./icons";
import styles from "./landing.module.css";

const SEARCH_DEBOUNCE_MS = 300;
// Mirrors CitySearchField/ShopServiceSearchField's own MIN_QUERY_LENGTH — same reasoning: a
// 1-character query is "still typing", not a query worth two live network requests for.
const MIN_QUERY_LENGTH = 2;
const CITY_RESULT_LIMIT = 5;
const SHOP_RESULT_LIMIT = 5;

type Suggestion =
  | { kind: "city"; city: CitySearchResultDto }
  | { kind: "shop"; salon: SalonListItemDto };

/**
 * The Reference-B hero visually reads as one field searching "city, area or shop name" — but
 * `GET /salons`'s own `q` param only ever matches salon name/description/service (see
 * SalonsService.search), never a city. Submitting free text as `q` for a city name silently
 * returned nothing, which an independent review correctly flagged as the field lying about what
 * it does.
 *
 * This keeps the exact single-pill visual and adds live suggestions from the two existing,
 * already-public endpoints that actually know about locations and shops — GET cities/search
 * (same one CitySearchField uses on the registration flow) and GET salons?q= (same one
 * ShopServiceSearchField already uses on the search page). Picking a city suggestion submits the
 * real `city`/`countryCode` params SalonsService.search expects; picking a shop suggestion goes
 * straight to that salon's real profile; plain free text (Enter/Search with nothing picked) still
 * submits as `q`, which is exactly what it has always correctly done for a shop or service name.
 * No backend contract changed to make this true.
 *
 * Locality-level ("area") resolution is intentionally not wired in here: there is no free-text
 * locality search across a country, only GET cities/:countryCode/:citySlug/localities, which
 * requires already knowing the city. Adding one would be a new backend endpoint, not a fix to an
 * existing one — the placeholder is worded to match (city + shop/service name only).
 *
 * City suggestions are scoped to whichever countries actually have real FastQue cities, derived
 * from `cities` (the same already-fetched, real "cities with an active salon" list the homepage
 * renders its city-browse chips from — see HomePage), never a hard-coded country. `GET /countries`
 * is a ~250-row world reference list used for registration's country picker, not "countries
 * FastQue operates in", and `cities/search` requires a countryId — so this maps the real cities'
 * `countryCode`s onto their matching `Country` row and fans a search out across exactly that small
 * real set. This is honestly worldwide: as real data appears in more countries, this picks them up
 * automatically with no code change, and it never queries countries FastQue has no data in.
 */
export function HeroSearchField({ cities: operatingCities }: { cities: CityDto[] | null }) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  const [value, setValue] = useState("");
  const [countryIds, setCountryIds] = useState<string[]>([]);
  const [cities, setCities] = useState<CitySearchResultDto[]>([]);
  const [shops, setShops] = useState<SalonListItemDto[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmed = value.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  // Real countries only: whichever ISO codes actually appear on a real city, up to a handful (the
  // product operates in very few countries today) so a search keystroke never fans out further
  // than the real footprint — never the full ~250-row world reference list.
  const operatingCountryCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const city of operatingCities ?? []) codes.add(city.countryCode);
    return Array.from(codes).slice(0, 5);
  }, [operatingCities]);

  useEffect(() => {
    if (operatingCountryCodes.length === 0) return;
    apiFetch<CountryDto[]>(COUNTRY_PATHS.countries)
      .then((countries) => {
        const ids = operatingCountryCodes
          .map((code) => countries.find((c) => c.isoCode2 === code)?.id)
          .filter((id): id is string => Boolean(id));
        setCountryIds(ids);
      })
      .catch(() => {
        /* City suggestions just stay empty — shop/service suggestions and plain q search still work */
      });
  }, [operatingCountryCodes]);

  useEffect(() => {
    // tooShort is handled by hiding the list at render time (see `expanded` below) rather than by
    // resetting state here — same reasoning as CitySearchField/ShopServiceSearchField's own
    // effects — so this effect never calls setState synchronously on its own body.
    if (tooShort) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (requestSeqRef.current += 1);

      const cityRequest = countryIds.length
        ? Promise.all(
            countryIds.map((countryId) =>
              apiFetch<CitySearchResultDto[]>(
                `${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?${new URLSearchParams({
                  countryId,
                  q: trimmed,
                  limit: String(CITY_RESULT_LIMIT),
                })}`,
              ).catch(() => [] as CitySearchResultDto[]),
            ),
          ).then((perCountry) =>
            perCountry
              .flat()
              .sort((a, b) => a.name.localeCompare(b.name))
              .slice(0, CITY_RESULT_LIMIT),
          )
        : Promise.resolve<CitySearchResultDto[]>([]);

      const shopRequest = apiFetch<PaginatedResult<SalonListItemDto>>(
        `${DISCOVERY_PATHS.salons}?${new URLSearchParams({ q: trimmed, limit: String(SHOP_RESULT_LIMIT) })}`,
      )
        .then((result) => result.items)
        .catch(() => [] as SalonListItemDto[]);

      Promise.all([cityRequest, shopRequest]).then(([cityResults, shopResults]) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setCities(cityResults);
        setShops(shopResults);
        setActiveIndex(0);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort, countryIds]);

  const suggestions: Suggestion[] = [
    ...cities.map((city): Suggestion => ({ kind: "city", city })),
    ...shops.map((salon): Suggestion => ({ kind: "shop", salon })),
  ];
  const expanded = open && !tooShort && suggestions.length > 0;

  function submitFreeText() {
    setOpen(false);
    const params = new URLSearchParams();
    if (trimmed) params.set("q", trimmed);
    router.push(`/search${params.size ? `?${params.toString()}` : ""}`);
  }

  function chooseCity(city: CitySearchResultDto) {
    setOpen(false);
    setValue(city.name);
    router.push(`/search?${new URLSearchParams({ city: city.slug, countryCode: city.countryCode }).toString()}`);
  }

  function chooseShop(salon: SalonListItemDto) {
    setOpen(false);
    router.push(`/${salon.countryCode}/${salon.citySlug}/${salon.slug}`);
  }

  function choose(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) {
      submitFreeText();
      return;
    }
    if (suggestion.kind === "city") chooseCity(suggestion.city);
    else chooseShop(suggestion.salon);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && expanded) {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (expanded) choose(activeIndex);
    else submitFreeText();
  }

  return (
    <form className={styles.heroSearch} onSubmit={handleSubmit} role="search" aria-label="Find a barbershop">
      <SearchIcon className={styles.heroSearchIcon} />
      <input
        ref={inputRef}
        type="search"
        name="q"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listboxId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder="Search by city or shop name"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      <button type="submit" className={styles.heroSearchButton}>
        <SearchIcon className={styles.ctaIcon} /> Search
      </button>

      {expanded && (
        <ul id={listboxId} role="listbox" className={styles.heroSuggestions}>
          {cities.length > 0 && (
            <li role="presentation" className={styles.heroSuggestionGroup}>
              Cities
            </li>
          )}
          {cities.map((city, index) => (
            <li
              key={`city-${city.id}`}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`${styles.heroSuggestion} ${index === activeIndex ? styles.heroSuggestionActive : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCity(city)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <LocationIcon className={styles.heroSuggestionIcon} />
              <span>
                {city.name}
                {city.region ? `, ${city.region.name}` : ""}
              </span>
            </li>
          ))}
          {shops.length > 0 && (
            <li role="presentation" className={styles.heroSuggestionGroup}>
              Shops &amp; services
            </li>
          )}
          {shops.map((salon, i) => {
            const index = cities.length + i;
            return (
              <li
                key={`shop-${salon.id}`}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.heroSuggestion} ${index === activeIndex ? styles.heroSuggestionActive : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseShop(salon)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <SearchIcon className={styles.heroSuggestionIcon} />
                <span>{salon.name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
