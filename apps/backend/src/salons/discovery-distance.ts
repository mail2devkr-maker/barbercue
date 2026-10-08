import { haversineDistanceKm } from '@barbercue/shared';

/**
 * Distance ranking and cursor paging for the customer location selector's "reference origin" mode
 * (`originLat`/`originLng` on GET /salons).
 *
 * Why this exists next to the older "Near Me" path in SalonsService.search:
 *  - Near Me (`lat`/`lng`) is a bounded candidate search: a bounding box, a 200-row cap, one
 *    unpaginated page, and every shop without coordinates dropped. That is the right trade-off for
 *    "find me something close", and the wrong one for "list every shop in Hajipur and tell me how
 *    far each is from the city centre" — feeding it a city centre would silently truncate the city.
 *  - The reference-origin mode measures distance from a point WITHOUT using it as a filter. It keeps
 *    every shop the other filters allow (including shops with no coordinates, which simply have no
 *    distance), orders them nearest-first when asked, and pages through the whole ordered set.
 *
 * These functions are pure so the ordering/paging rules are unit-tested without a database.
 */

export interface DistanceCandidate {
  id: string;
  lat: number | null;
  lng: number | null;
}

export interface RankedCandidate {
  id: string;
  /** Raw (unrounded) great-circle distance in km, or null when the shop has no coordinates. */
  distanceKm: number | null;
}

export interface Origin {
  lat: number;
  lng: number;
}

/**
 * Orders candidates nearest-first. Shops without coordinates sort AFTER every shop that has a
 * distance (never first, never fabricated a distance); ties — including all the coordinate-less
 * shops — break on id so the whole order is deterministic and therefore pageable.
 *
 * When `radiusKm` is given it is a HARD cap, measured against the raw (unrounded) distance: a shop
 * outside it is excluded, and so is a shop with no coordinates (it cannot be shown to be inside the
 * radius). Without `radiusKm` nothing is filtered.
 */
export function rankByDistance(
  candidates: readonly DistanceCandidate[],
  origin: Origin,
  options: { radiusKm?: number } = {},
): RankedCandidate[] {
  const ranked: RankedCandidate[] = candidates.map((c) => ({
    id: c.id,
    distanceKm:
      c.lat !== null && c.lng !== null
        ? haversineDistanceKm(origin.lat, origin.lng, c.lat, c.lng)
        : null,
  }));

  const filtered =
    options.radiusKm === undefined
      ? ranked
      : ranked.filter(
          (r) => r.distanceKm !== null && r.distanceKm <= options.radiusKm!,
        );

  return filtered.sort((a, b) => {
    if (a.distanceKm === null && b.distanceKm === null)
      return a.id.localeCompare(b.id);
    if (a.distanceKm === null) return 1;
    if (b.distanceKm === null) return -1;
    return a.distanceKm - b.distanceKm || a.id.localeCompare(b.id);
  });
}

/**
 * Cursor paging over an already-ordered list. The cursor is the id of the last item of the
 * previous page (the same opaque-uuid shape every other cursor in this API uses). A cursor that is
 * no longer in the list — the shop was suspended between two page loads — restarts from the top
 * rather than silently returning an empty (and so truncated) result; clients de-duplicate by id.
 */
export function pageAfterCursor<T extends { id: string }>(
  ordered: readonly T[],
  cursor: string | undefined,
  limit: number,
): { page: T[]; nextCursor: string | null } {
  let start = 0;
  if (cursor !== undefined) {
    const index = ordered.findIndex((item) => item.id === cursor);
    start = index === -1 ? 0 : index + 1;
  }
  const page = ordered.slice(start, start + limit);
  const hasMore = start + limit < ordered.length;
  return {
    page,
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
  };
}
