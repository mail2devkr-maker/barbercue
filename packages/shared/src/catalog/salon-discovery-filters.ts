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
