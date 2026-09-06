import { find as findTimeZonesAtCoordinate } from 'geo-tz';
import { INDIA_TIME_ZONE, isValidTimeZone } from './timezone';

export type TimezoneResolutionConfidence = 'EXACT' | 'HIGH' | 'AMBIGUOUS';
export type TimezoneResolutionSource = 'coordinates' | 'city' | 'country';

export interface TimezoneResolutionInput {
  latitude?: number | null;
  longitude?: number | null;
  // City.timezone -- already-known IANA zone for the resolved city, when the global-location
  // import has enriched that row. Absent for most cities until the separate, explicitly-approved
  // backfill runs (see prisma/backfill-city-timezones.ts).
  cityTimezone?: string | null;
  countryCode?: string | null;
}

export interface TimezoneResolutionResult {
  timezone: string;
  confidence: TimezoneResolutionConfidence;
  source: TimezoneResolutionSource;
}

/**
 * Deterministic, non-guessing timezone auto-detection (Part 4). Tries the strongest available
 * signal first and falls through rather than ever fabricating a zone:
 *
 *   A. Exact coordinates -- geo-tz's timezone-boundary lookup (offline, bundled with the
 *      package, no network call). Only trusted when it resolves to a single unambiguous zone;
 *      a coordinate sitting on a timezone-boundary line legitimately returns more than one zone
 *      (see geo-tz's own docs), and picking one of those arbitrarily is exactly the kind of guess
 *      this function must never make -- it falls through to the next signal instead.
 *   B. The resolved City's own known timezone (imported from the same source dataset that
 *      supplies latitude/longitude), when coordinates are unavailable or ambiguous.
 *   C. Region+city combination -- deliberately NOT implemented. The source dataset's per-region
 *      timezone field is unreliable for genuinely multi-zone regions (e.g. it would map all of
 *      Texas to a single zone, exactly the wrong-guess failure mode this feature must avoid), so
 *      there is no region-level fallback: city-level data is trusted, region-level is not.
 *   D. Country-level fallback -- restricted to India (single-zone in practice for this product's
 *      existing data), matching the country fallback resolveSalonTimeZone already trusted for
 *      runtime resolution. No other country is assumed single-zone.
 *
 * Returns null when no signal clears its confidence bar -- callers must keep (or show) a manual
 * selector in that case, never invent a value.
 */
export function resolveAutoTimezone(
  input: TimezoneResolutionInput,
): TimezoneResolutionResult | null {
  const { latitude, longitude, cityTimezone, countryCode } = input;

  if (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  ) {
    const candidates = findTimeZonesAtCoordinate(latitude, longitude);
    if (candidates.length === 1 && isValidTimeZone(candidates[0])) {
      return { timezone: candidates[0], confidence: 'EXACT', source: 'coordinates' };
    }
    // candidates.length !== 1: either open ocean (0 results) or a boundary straddle (>1) -- both
    // are genuine ambiguity, not a bug, so fall through to the next signal rather than guessing.
  }

  if (isValidTimeZone(cityTimezone)) {
    return { timezone: cityTimezone, confidence: 'HIGH', source: 'city' };
  }

  if (countryCode?.toUpperCase() === 'IN') {
    return { timezone: INDIA_TIME_ZONE, confidence: 'HIGH', source: 'country' };
  }

  return null;
}
