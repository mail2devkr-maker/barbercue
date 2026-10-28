/**
 * Canonical customer-discovery search filters — the compact "Distance / Price / Service" dropdown
 * data shared by the website search page and the mobile Find a Salon/Barber screen, so the two
 * clients can never drift onto two different category lists or price-bucket schemes.
 *
 * This is deliberately separate from `SERVICE_CATALOG`/`SERVICE_CATALOG_CATEGORIES` in
 * `./service-catalog` — that file is the owner-facing menu-setup preset list (granular named
 * services like "Skin Fade" grouped under 11 setup categories). This file is the customer-facing
 * *search* category list: a handful of broad keywords chosen because each one is a safe
 * case-insensitive substring match against real Service `name`/`category` text (see
 * SalonsService.search's `serviceRelevance()`), not a menu-editing taxonomy.
 */

/** One customer-facing discovery category tag. `query` is sent as the `service` search param
 * exactly as `SalonsService.search`'s `serviceRelevance()` expects (case-insensitive substring
 * match against a Service's name or category). */
export interface DiscoveryCategory {
  id: string;
  label: string;
  query: string;
}

export const SALON_DISCOVERY_CATEGORIES: readonly DiscoveryCategory[] = [
  { id: 'hair', label: 'Hair', query: 'hair' },
  { id: 'barber', label: 'Barber', query: 'haircut' },
  { id: 'beard', label: 'Beard', query: 'beard' },
  { id: 'nails', label: 'Nails', query: 'nail' },
  { id: 'facial', label: 'Facial', query: 'facial' },
  { id: 'makeup', label: 'Makeup', query: 'makeup' },
  { id: 'waxing-threading', label: 'Waxing & Threading', query: 'waxing' },
  { id: 'spa-massage', label: 'Spa & Massage', query: 'massage' },
  { id: 'bridal-event', label: 'Bridal & Event', query: 'bridal' },
];

/** One selectable price-filter row. `min`/`max` map directly onto the existing
 * `priceMin`/`priceMax` search query params (see `salonSearchQuerySchema`) — never a new pricing
 * model, just finer-grained presets over the same two numbers. */
export interface PricePreset {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
}

/** Owner requirement: presets start at ₹30 and step by ₹20 up through ₹990, then a final ₹1000+
 * open-ended bucket. 49 "Up to ₹X" rows — far too many to render as on-screen pills, which is
 * exactly why these live inside a scrollable dropdown/bottom-sheet menu instead. */
export const PRICE_FILTER_STEP = 20;
export const PRICE_FILTER_FLOOR = 30;
export const PRICE_FILTER_CEILING = 990;

function buildPriceFilterPresets(): PricePreset[] {
  const presets: PricePreset[] = [{ id: 'any', label: 'Any price', min: null, max: null }];
  for (let max = PRICE_FILTER_FLOOR; max <= PRICE_FILTER_CEILING; max += PRICE_FILTER_STEP) {
    presets.push({ id: `upto-${max}`, label: `Up to ₹${max}`, min: null, max });
  }
  presets.push({ id: 'over-1000', label: '₹1000+', min: 1000, max: null });
  return presets;
}

export const PRICE_FILTER_PRESETS: readonly PricePreset[] = buildPriceFilterPresets();

/** Trigger-label formatter shared by both clients so "what does the dropdown say right now" never
 * has two different implementations. Falls back to a readable custom-range label (rather than
 * "Any price") whenever the active min/max doesn't exactly match a preset — e.g. a value the
 * owner/customer typed into the Custom modal. */
export function formatPriceFilterLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'Any price';
  if (min === 1000 && max === null) return '₹1000+';
  if (min === null && max !== null) return `Up to ₹${max}`;
  if (min !== null && max === null) return `From ₹${min}`;
  return `₹${min} – ₹${max}`;
}

/** Mirrors `salonSearchQuerySchema`'s own constraints (both bounds non-negative, min <= max when
 * both are supplied) so the Custom price modal can reject bad input before it ever reaches the
 * network. Returns an error code rather than a message — each client renders its own (translated)
 * copy for it. */
export type PriceRangeValidationError = 'negative-min' | 'negative-max' | 'min-exceeds-max';

export function validatePriceRange(min: number | null, max: number | null): PriceRangeValidationError | null {
  if (min !== null && min < 0) return 'negative-min';
  if (max !== null && max < 0) return 'negative-max';
  if (min !== null && max !== null && min > max) return 'min-exceeds-max';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Discovery upgrade (docs/discovery-upgrade/PLAN.md): salon type filter, popular services for
// same-service price comparison, and sort options. Shared by the API and every client.

/** Customer-facing names for SalonType values (stored as GENTS / LADIES / UNISEX). */
export const SALON_TYPE_LABELS = { GENTS: 'Male', LADIES: 'Female', UNISEX: 'Unisex' } as const;
export type SalonTypeFilter = keyof typeof SALON_TYPE_LABELS;

/**
 * Which stored salon types a customer's salon-type choice shows. The business rule lives here only:
 * - Male   → Male (Gents) + Unisex salons
 * - Female → Female (Ladies) + Unisex salons
 * - Unisex → Unisex salons the owner CONFIRMED (see `requiresConfirmed`)
 * - All    → no filter (the parameter is simply omitted)
 * A salon whose type was never confirmed keeps the column default UNISEX, so it still appears for
 * Male / Female (inclusive) but never as a confirmed "Unisex only" match.
 */
export const SALON_TYPE_FILTER_MATCHES: Readonly<
  Record<SalonTypeFilter, { types: readonly SalonTypeFilter[]; requiresConfirmed: boolean }>
> = {
  GENTS: { types: ['GENTS', 'UNISEX'], requiresConfirmed: false },
  LADIES: { types: ['LADIES', 'UNISEX'], requiresConfirmed: false },
  UNISEX: { types: ['UNISEX'], requiresConfirmed: true },
};

/**
 * A popular service customers compare across salons. Salons name their own services, so matching is
 * a case-insensitive substring test on the service's own name (or category): any `match` term, and
 * none of the `exclude` terms. The compared price is the cheapest active matching service at each
 * salon, returned together with that service's own name so the comparison is never ambiguous.
 */
export interface PopularService {
  id: string;
  label: string;
  match: readonly string[];
  exclude?: readonly string[];
}

export const POPULAR_SERVICES: readonly PopularService[] = [
  { id: 'haircut', label: 'Haircut', match: ['haircut', 'hair cut'], exclude: ['kid', 'child', 'baby'] },
  { id: 'beard-styling', label: 'Beard Styling', match: ['beard'] },
  { id: 'shaving', label: 'Shaving', match: ['shave', 'shaving'] },
  { id: 'facial', label: 'Facial', match: ['facial'] },
  { id: 'hair-spa', label: 'Hair Spa', match: ['hair spa'] },
  { id: 'hair-color', label: 'Hair Color', match: ['hair colour', 'hair color', 'global colour', 'global color', 'root touch'] },
  { id: 'massage', label: 'Massage', match: ['massage'] },
  { id: 'cleanup', label: 'Cleanup', match: ['cleanup', 'clean up', 'clean-up'] },
  { id: 'bleach', label: 'Bleach', match: ['bleach'] },
  { id: 'detan', label: 'Detan', match: ['detan', 'de-tan', 'de tan'] },
];

export const popularServiceById = (id: string | null | undefined): PopularService | undefined =>
  id ? POPULAR_SERVICES.find((service) => service.id === id) : undefined;

/** Pure version of the server's matching rule (used by tests and client-side highlighting). */
export function matchesPopularService(service: PopularService, text: string): boolean {
  const value = text.toLowerCase();
  return service.match.some((term) => value.includes(term)) && !(service.exclude ?? []).some((term) => value.includes(term));
}

/**
 * Result ordering. `relevance` keeps the existing name order with cursor pagination; the others
 * return one bounded page (same documented limit as "Near me"):
 * - distance: nearest first — needs lat/lng
 * - price: lowest price of the SELECTED service first — needs a selected service (never a mix of
 *   unrelated services); clients disable it otherwise ("Select a service first to sort by price")
 * - rating: highest average first, salons without reviews last, then by review count
 */
export const SALON_SORT_OPTIONS = ['relevance', 'distance', 'price', 'rating'] as const;
export type SalonSortOption = (typeof SALON_SORT_OPTIONS)[number];
export const SALON_SORT_LABELS: Record<SalonSortOption, string> = {
  relevance: 'Recommended',
  distance: 'Distance',
  price: 'Price (selected service)',
  rating: 'Reviews',
};

/** Minimum review score choices offered by the discovery filters ("4+ stars" etc.). */
export const MIN_RATING_OPTIONS = [3, 3.5, 4, 4.5] as const;

/** Most salon IDs one "favorites only" search may send (matches the bounded candidate cap). */
export const SALON_SEARCH_MAX_IDS = 200;
