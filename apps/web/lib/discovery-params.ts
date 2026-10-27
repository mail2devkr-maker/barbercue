import {
  SALON_SORT_OPTIONS,
  popularServiceById,
  type SalonSortOption,
  type SalonTypeFilter,
} from "@barbercue/shared";

// URL ⇄ filter state for /search. The URL stays the single source of truth (a shared or bookmarked
// link reproduces the same results); these helpers keep every rule in one testable place.

/** Every query param the search API understands, forwarded as-is. */
export const SEARCH_API_PARAMS = [
  "q", "shopName", "city", "countryCode", "locality", "service", "lat", "lng", "radiusKm",
  "priceMin", "priceMax", "salonType", "popularService", "sort",
] as const;

export const PRICE_SLIDER_MIN = 0;
export const PRICE_SLIDER_MAX = 2000;
export const PRICE_SLIDER_STEP = 50;

export interface DiscoveryState {
  salonType: SalonTypeFilter | null;
  popularService: string | null;
  legacyService: string | null;
  priceMin: number | null;
  priceMax: number | null;
  sort: SalonSortOption;
  nearMe: boolean;
}

export function readDiscoveryState(params: URLSearchParams): DiscoveryState {
  const salonType = params.get("salonType");
  const sort = params.get("sort");
  const num = (key: string) => {
    const value = params.get(key);
    return value === null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  };
  const nearMe = params.has("lat") && params.has("lng");
  return {
    salonType: salonType === "GENTS" || salonType === "LADIES" || salonType === "UNISEX" ? salonType : null,
    popularService: popularServiceById(params.get("popularService"))?.id ?? null,
    legacyService: params.get("service"),
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    sort: (SALON_SORT_OPTIONS as readonly string[]).includes(sort ?? "") ? (sort as SalonSortOption) : nearMe ? "distance" : "relevance",
    nearMe,
  };
}

/** Why a sort option is unavailable right now, or null when it can be used. */
export function sortUnavailableReason(option: SalonSortOption, state: Pick<DiscoveryState, "popularService" | "legacyService">): string | null {
  if (option === "price" && !state.popularService && !state.legacyService) return "Select a service first to sort by price.";
  return null;
}

/** Search API query string for the current URL (only known params, empty values dropped). */
export function searchApiQuery(params: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const key of SEARCH_API_PARAMS) {
    const value = params.get(key);
    if (value) out.set(key, value);
  }
  // The API rejects price sort without a service; drop it rather than show an error page.
  const state = readDiscoveryState(params);
  if (state.sort === "price" && sortUnavailableReason("price", state)) out.delete("sort");
  return out.toString();
}

/** Apply changes to the current URL params; null removes a key. Returns the new query string. */
export function withParams(params: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next.toString();
}

/**
 * Changing the compared service resets its price range (a ₹100–₹300 haircut range means nothing for
 * a facial) and a price sort that no longer has a service.
 */
export function popularServiceChange(params: URLSearchParams, serviceId: string | null): Record<string, string | null> {
  const state = readDiscoveryState(params);
  return {
    popularService: serviceId,
    priceMin: null,
    priceMax: null,
    ...(serviceId === null && state.sort === "price" && !state.legacyService ? { sort: null } : {}),
  };
}

/** Slider values → URL values: the slider ends mean "no limit". */
export function priceRangeChange(min: number, max: number): Record<string, string | null> {
  return {
    priceMin: min <= PRICE_SLIDER_MIN ? null : String(min),
    priceMax: max >= PRICE_SLIDER_MAX ? null : String(max),
  };
}

/** Number of active filters, for the mobile "Filters (n)" button and the Clear-all link. */
export function activeFilterCount(state: DiscoveryState): number {
  return [
    state.salonType,
    state.popularService,
    state.legacyService,
    state.priceMin !== null || state.priceMax !== null ? "price" : null,
  ].filter(Boolean).length;
}
