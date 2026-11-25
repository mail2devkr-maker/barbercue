import { Injectable, Logger } from '@nestjs/common';
import {
  conservativeTravelMinutes,
  type HomeTravelMode,
} from '@barbercue/shared';

export interface HomePoint {
  lat: number | null;
  lng: number | null;
  postalCode?: string | null;
}
export interface TravelEstimate {
  minutes: number;
  /** Real road distance from a routing provider; null when none answered (never a straight line). */
  roadKm: number | null;
  source: 'ROAD' | 'ROAD_TRAFFIC' | 'ESTIMATE' | 'UNKNOWN';
}
type LatLng = { lat: number; lng: number };

/** Provider-independent routing adapter. Null means "no reliable answer". */
export interface RoutingProvider {
  readonly name: string;
  route(
    from: LatLng,
    to: LatLng,
    mode: HomeTravelMode,
  ): Promise<{ minutes: number; km: number; traffic: boolean } | null>;
}

/** Self-hosted OSRM. Nothing is called unless an operator configures their own base URL. */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  constructor(private readonly baseUrl: string) {}

  async route(from: LatLng, to: LatLng, mode: HomeTravelMode) {
    if (mode === 'PUBLIC_TRANSPORT') return null;
    const profile =
      mode === 'WALK' ? 'foot' : mode === 'BICYCLE' ? 'bike' : 'driving';
    const url = `${this.baseUrl.replace(/\/+$/, '')}/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      routes?: { duration: number; distance: number }[];
    };
    const r = body.routes?.[0];
    if (!r || !Number.isFinite(r.duration)) return null;
    return {
      minutes: Math.ceil(r.duration / 60),
      km: r.distance / 1000,
      traffic: false,
    };
  }
}

const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 5000;

/** Travel time with a transparent conservative fallback when routing is missing, slow or failing. */
@Injectable()
export class HomeRoutingService {
  private readonly logger = new Logger(HomeRoutingService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: TravelEstimate }
  >();
  private override: RoutingProvider | null | undefined;

  /** Test seam. */
  useProvider(provider: RoutingProvider | null | undefined): void {
    this.override = provider;
    this.cache.clear();
  }

  private provider(): RoutingProvider | null {
    if (this.override !== undefined) return this.override;
    const base = process.env.HOME_OSRM_BASE_URL?.trim();
    return process.env.HOME_ROUTING_PROVIDER === 'osrm' && base
      ? new OsrmRoutingProvider(base)
      : null;
  }

  get configured(): boolean {
    return this.provider() !== null;
  }

  private key(a: HomePoint, b: HomePoint, m: string): string {
    const r = (v: number | null) => (v == null ? 'x' : v.toFixed(3));
    return `${r(a.lat)},${r(a.lng)},${a.postalCode ?? ''}>${r(b.lat)},${r(b.lng)},${b.postalCode ?? ''}|${m}`;
  }

  /** Synchronous: a cached road answer if there is one, else the conservative estimate. */
  estimate(
    from: HomePoint,
    to: HomePoint,
    mode: HomeTravelMode,
  ): TravelEstimate {
    const hit = this.cache.get(this.key(from, to, mode));
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    return { ...conservativeTravelMinutes(from, to, mode), roadKm: null };
  }

  async travel(
    from: HomePoint,
    to: HomePoint,
    mode: HomeTravelMode,
  ): Promise<TravelEstimate> {
    const key = this.key(from, to, mode);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const provider = this.provider();
    if (
      provider &&
      from.lat != null &&
      from.lng != null &&
      to.lat != null &&
      to.lng != null
    ) {
      try {
        const r = await provider.route(
          { lat: from.lat, lng: from.lng },
          { lat: to.lat, lng: to.lng },
          mode,
        );
        if (r) {
          const value: TravelEstimate = {
            minutes: Math.max(3, r.minutes),
            roadKm: r.km,
            source: r.traffic ? 'ROAD_TRAFFIC' : 'ROAD',
          };
          if (this.cache.size > CACHE_MAX) this.cache.clear();
          this.cache.set(key, { at: Date.now(), value });
          return value;
        }
      } catch (err) {
        this.logger.warn(
          `Routing provider failed, using the conservative estimate: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }
    return { ...conservativeTravelMinutes(from, to, mode), roadKm: null };
  }
}
