import { Logger } from '@nestjs/common';
import type { ViGeoSource } from '@barbercue/shared';

/**
 * Approximate visitor location (docs/visitor-intelligence/README.md (GEO)). Order of preference:
 *   1. CDN geo headers (Cloudflare `cf-ipcountry`/`cf-ipcity`/`cf-region`, Vercel `x-vercel-ip-*`,
 *      or a generic `x-geo-*` set by any reverse proxy). Free, no IP leaves our infrastructure.
 *   2. An OPTIONAL offline database (DB-IP Lite / GeoLite2 .mmdb) when VI_GEOIP_MMDB_PATH is set and
 *      the open-source `maxmind` reader package is installed. Nothing paid; disabled by default.
 *   3. Nothing ("Unknown"). The visitor's own city choice (USER_SELECTED) or explicit Near Me
 *      permission (BROWSER_PERMISSION) later improves the session's location.
 * The IP address is used only in memory for this lookup and is never stored or logged.
 * City-level results are approximate: they are never shown as an address.
 */
export interface ViGeo {
  country: string | null;
  state: string | null;
  city: string | null;
  source: ViGeoSource;
}

const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  AE: 'United Arab Emirates',
  CA: 'Canada',
  AU: 'Australia',
  SG: 'Singapore',
  NP: 'Nepal',
  BD: 'Bangladesh',
  LK: 'Sri Lanka',
  SA: 'Saudi Arabia',
  DE: 'Germany',
  FR: 'France',
  NZ: 'New Zealand',
  QA: 'Qatar',
  OM: 'Oman',
  KW: 'Kuwait',
  MY: 'Malaysia',
  PK: 'Pakistan',
  IE: 'Ireland',
};

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return null;
  return COUNTRY_NAMES[c] ?? c;
}

const clean = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  try {
    const decoded = decodeURIComponent(s).trim();
    return decoded && decoded.length <= 80 ? decoded : null;
  } catch {
    return null;
  }
};

export function geoFromHeaders(
  h: Record<string, string | string[] | undefined>,
): ViGeo | null {
  const country =
    countryName(clean(h['cf-ipcountry'])) ??
    countryName(clean(h['x-vercel-ip-country'])) ??
    countryName(clean(h['x-geo-country']));
  if (!country) return null;
  const state =
    clean(h['cf-region']) ??
    clean(h['x-vercel-ip-country-region']) ??
    clean(h['x-geo-region']);
  const city =
    clean(h['cf-ipcity']) ??
    clean(h['x-vercel-ip-city']) ??
    clean(h['x-geo-city']);
  return { country, state, city, source: 'CDN_HEADER' };
}

/** Low-confidence country hint from the browser's own IANA timezone (no IP involved). */
export function countryFromTimezone(
  tz: string | null | undefined,
): string | null {
  if (!tz) return null;
  if (/^Asia\/(Kolkata|Calcutta)$/.test(tz)) return 'India';
  if (tz === 'Asia/Dubai') return 'United Arab Emirates';
  if (tz === 'Europe/London') return 'United Kingdom';
  if (tz === 'Asia/Kathmandu') return 'Nepal';
  if (tz === 'Asia/Singapore') return 'Singapore';
  return null;
}

/** Kept in a variable so the optional package is resolved only at runtime, never required at build time. */
const OPTIONAL_GEOIP_MODULE: string = 'maxmind';

type MmdbReader = { get(ip: string): unknown } | null;
let reader: MmdbReader | undefined;
const logger = new Logger('ViGeo');

async function mmdb(): Promise<MmdbReader> {
  if (reader !== undefined) return reader;
  reader = null;
  const path = process.env.VI_GEOIP_MMDB_PATH;
  if (!path) return reader;
  try {
    // Optional dependency: only loaded when an operator installs it and provides a database file.
    const mod = (await import(OPTIONAL_GEOIP_MODULE)) as {
      open(p: string): Promise<{ get(ip: string): unknown }>;
    };
    reader = await mod.open(path);
  } catch (e) {
    logger.warn(
      `VI_GEOIP_MMDB_PATH is set but the reader could not load (${e instanceof Error ? e.message : 'unknown'}); IP database lookups are off.`,
    );
  }
  return reader;
}

export async function geoFromIp(ip: string | null): Promise<ViGeo | null> {
  if (!ip) return null;
  const r = await mmdb();
  if (!r) return null;
  try {
    const rec = r.get(ip) as {
      country?: { iso_code?: string };
      subdivisions?: Array<{ names?: { en?: string } }>;
      city?: { names?: { en?: string } };
    } | null;
    const country = countryName(rec?.country?.iso_code);
    if (!country) return null;
    return {
      country,
      state: rec?.subdivisions?.[0]?.names?.en ?? null,
      city: rec?.city?.names?.en ?? null,
      source: 'OFFLINE_DB',
    };
  } catch {
    return null;
  }
}

/** First hop of X-Forwarded-For, else the socket address. Used transiently only. */
export function clientIp(
  h: Record<string, string | string[] | undefined>,
  socketIp?: string | null,
): string | null {
  const xff = clean(h['x-forwarded-for']);
  const first = xff?.split(',')[0]?.trim();
  return first || socketIp || null;
}

export function geoConfidence(
  source: ViGeoSource,
  hasCity: boolean,
): 'low' | 'medium' | 'high' {
  if (source === 'BROWSER_PERMISSION') return 'high';
  if (source === 'USER_SELECTED') return 'medium';
  // IP geolocation is reasonable at country level but often wrong at city level (mobile carriers route via hubs).
  if (source === 'CDN_HEADER' || source === 'OFFLINE_DB')
    return hasCity ? 'low' : 'medium';
  return 'low';
}
