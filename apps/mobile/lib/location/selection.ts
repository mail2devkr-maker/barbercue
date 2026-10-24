import {
  formatDistance,
  haversineDistanceKm,
  type CityDto,
  type CitySearchResultDto,
  type SalonListItemDto,
  type UiStrings,
} from '@barbercue/shared';

/**
 * The customer's chosen location, as ONE model for Home, Search and the selector.
 *
 * Two independent modes, never conflated:
 *  - `city`:   the customer searched for and picked a city. No GPS is involved or required. The only
 *              coordinates it can carry are the city's own stored centre (nullable, never invented),
 *              used solely as a reference point for approximate straight-line distances.
 *  - `device`: the customer explicitly tapped "Use my current location" and a real GPS fix succeeded.
 *              These coordinates ARE the customer's position.
 *
 * Provenance matters: a distance shown from a city centre must never be described as the customer's
 * physical distance, and vice versa — see shopDistanceLabel().
 */

export interface SelectableCity {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  /** State / region display name; null when the data has none (never guessed). */
  regionName: string | null;
  countryName: string | null;
  /** Stored city centre; null when the city has none. */
  latitude: number | null;
  longitude: number | null;
}

export interface ManualCitySelection {
  mode: 'city';
  city: SelectableCity;
  selectedAt: number;
}

export interface DeviceLocationSelection {
  mode: 'device';
  coords: { lat: number; lng: number };
  /** City-level label resolved from the fix by on-device reverse geocoding; null when it failed. */
  label: string | null;
  capturedAt: number;
}

export type SelectedLocation = ManualCitySelection | DeviceLocationSelection;

/** The point shop distances are measured from, with its provenance. */
export interface DistanceOrigin {
  kind: 'city' | 'device';
  lat: number;
  lng: number;
  /** Set for kind 'city': the name shown in "x km from <city> centre". */
  cityName?: string;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function coordinatesOrNull(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// ---------- mapping backend DTOs ----------

export function cityFromDto(dto: CityDto): SelectableCity {
  const coords = coordinatesOrNull(dto.latitude, dto.longitude);
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    countryCode: dto.countryCode,
    regionName: dto.state || null,
    countryName: dto.country || null,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  };
}

export function cityFromSearchResult(result: CitySearchResultDto): SelectableCity {
  const coords = coordinatesOrNull(result.latitude, result.longitude);
  return {
    id: result.id,
    name: result.name,
    slug: result.slug,
    countryCode: result.countryCode,
    regionName: result.region?.name ?? result.state ?? null,
    countryName: result.countryName ?? null,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  };
}

/** Stable identity: city slugs are only unique per country (London GB vs London CA). */
export function cityKey(city: Pick<SelectableCity, 'countryCode' | 'slug'>): string {
  return `${city.countryCode.toUpperCase()}:${city.slug}`;
}

/** "Hajipur, Bihar, India" — region/country omitted when unknown, never repeated. */
export function cityDisplayLine(city: SelectableCity): string {
  const parts = [city.name];
  for (const extra of [city.regionName, city.countryName ?? city.countryCode]) {
    if (extra && !parts.some((p) => p.toLowerCase() === extra.toLowerCase())) parts.push(extra);
  }
  return parts.join(', ');
}

/** Region + country only ("Bihar, India"), for the secondary line of a result row. */
export function citySubtitle(city: SelectableCity): string {
  const parts: string[] = [];
  for (const extra of [city.regionName, city.countryName ?? city.countryCode]) {
    if (extra && extra.toLowerCase() !== city.name.toLowerCase() && !parts.includes(extra)) parts.push(extra);
  }
  return parts.join(', ');
}

// ---------- labels ----------

/** Compact label for the Home header pill and the field. */
export function shortLocationLabel(selection: SelectedLocation | null, t: UiStrings): string {
  if (!selection) return t.chooseLocationAction;
  if (selection.mode === 'city') return selection.city.name;
  return selection.label ?? t.myCurrentLocationLabel;
}

/** "My current location — Hajipur" vs "Hajipur, Bihar, India", for the selector's selected card. */
export function fullLocationLabel(selection: SelectedLocation, t: UiStrings): string {
  if (selection.mode === 'city') return cityDisplayLine(selection.city);
  return selection.label ? `${t.myCurrentLocationLabel} — ${selection.label}` : t.myCurrentLocationLabel;
}

// ---------- distance reference ----------

/** The point to measure from, or null when there is no trustworthy one (e.g. a city with no stored centre). */
export function distanceOrigin(selection: SelectedLocation | null): DistanceOrigin | null {
  if (!selection) return null;
  if (selection.mode === 'device') {
    const coords = coordinatesOrNull(selection.coords.lat, selection.coords.lng);
    return coords ? { kind: 'device', ...coords } : null;
  }
  const coords = coordinatesOrNull(selection.city.latitude, selection.city.longitude);
  return coords ? { kind: 'city', ...coords, cityName: selection.city.name } : null;
}

const round1 = (km: number) => Math.round(km * 10) / 10;

/**
 * Distance for one shop: the server's own figure when it supplied one, otherwise (an older server
 * that ignores the origin parameters) the same shared Haversine on the shop's real coordinates.
 * Null — never 0, never a guess — when either end has no coordinates.
 */
export function resolveShopDistanceKm(
  shop: Pick<SalonListItemDto, 'distanceKm' | 'lat' | 'lng'>,
  origin: DistanceOrigin | null,
): number | null {
  if (typeof shop.distanceKm === 'number') return shop.distanceKm;
  if (!origin) return null;
  const point = coordinatesOrNull(shop.lat, shop.lng);
  if (!point) return null;
  return round1(haversineDistanceKm(origin.lat, origin.lng, point.lat, point.lng));
}

/**
 * "2.5 km from Hajipur centre" (city mode) / "450 m from you" (GPS mode) / "Distance unavailable".
 * The wording is chosen by the ORIGIN's provenance, so the two can never be confused.
 */
export function shopDistanceLabel(
  shop: Pick<SalonListItemDto, 'distanceKm' | 'lat' | 'lng' | 'countryCode'>,
  origin: DistanceOrigin | null,
  t: UiStrings,
): string {
  const km = resolveShopDistanceKm(shop, origin);
  if (km === null || origin === null) return t.distanceUnavailable;
  const distance = formatDistance(km, shop.countryCode);
  if (origin.kind === 'device') return t.distanceFromYou.replace('{distance}', distance);
  return t.distanceFromCityCentre.replace('{distance}', distance).replace('{city}', origin.cityName ?? '');
}

// ---------- persistence ----------

const SELECTION_VERSION = 1;
export const RECENT_CITY_LIMIT = 5;

export function serializeSelection(selection: SelectedLocation): string {
  return JSON.stringify({ v: SELECTION_VERSION, selection });
}

function parseCity(raw: unknown): SelectableCity | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.slug !== 'string' || typeof c.countryCode !== 'string') return null;
  const coords = coordinatesOrNull(c.latitude, c.longitude);
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    countryCode: c.countryCode,
    regionName: typeof c.regionName === 'string' ? c.regionName : null,
    countryName: typeof c.countryName === 'string' ? c.countryName : null,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  };
}

/** Never throws: corrupt, hand-edited or future-version storage simply means "no selection". */
export function parseSelection(raw: string | null): SelectedLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; selection?: Record<string, unknown> };
    if (parsed.v !== SELECTION_VERSION || !parsed.selection) return null;
    const s = parsed.selection;
    if (s.mode === 'city') {
      const city = parseCity(s.city);
      return city ? { mode: 'city', city, selectedAt: isFiniteNumber(s.selectedAt) ? s.selectedAt : 0 } : null;
    }
    if (s.mode === 'device') {
      const coords = s.coords as Record<string, unknown> | undefined;
      const valid = coordinatesOrNull(coords?.lat, coords?.lng);
      if (!valid) return null;
      return {
        mode: 'device',
        coords: valid,
        label: typeof s.label === 'string' ? s.label : null,
        capturedAt: isFiniteNumber(s.capturedAt) ? s.capturedAt : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeRecents(recents: readonly SelectableCity[]): string {
  return JSON.stringify({ v: SELECTION_VERSION, recents });
}

export function parseRecents(raw: string | null): SelectableCity[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; recents?: unknown };
    if (parsed.v !== SELECTION_VERSION || !Array.isArray(parsed.recents)) return [];
    const cities = parsed.recents.map(parseCity).filter((c): c is SelectableCity => c !== null);
    return cities.slice(0, RECENT_CITY_LIMIT);
  } catch {
    return [];
  }
}

/** Most-recent-first, de-duplicated by (country, slug), capped. */
export function pushRecentCity(recents: readonly SelectableCity[], city: SelectableCity): SelectableCity[] {
  const key = cityKey(city);
  return [city, ...recents.filter((c) => cityKey(c) !== key)].slice(0, RECENT_CITY_LIMIT);
}

// ---------- local city filtering (instant results + offline fallback) ----------

/** Case-insensitive, accent-tolerant substring match; prefix matches first, then alphabetical. */
export function filterCitiesLocally(cities: readonly SelectableCity[], query: string): SelectableCity[] {
  const needle = normalizeForSearch(query);
  if (!needle) return [...cities];
  return cities
    .filter((c) => normalizeForSearch(c.name).includes(needle))
    .sort((a, b) => {
      const ap = normalizeForSearch(a.name).startsWith(needle) ? 0 : 1;
      const bp = normalizeForSearch(b.name).startsWith(needle) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
}

function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
