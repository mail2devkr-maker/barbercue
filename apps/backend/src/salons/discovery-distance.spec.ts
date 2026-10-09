import { haversineDistanceKm } from '@barbercue/shared';
import {
  pageAfterCursor,
  rankByDistance,
  type DistanceCandidate,
} from './discovery-distance';

// Fixtures are realistic multi-city test data, not production selections.
const HAJIPUR_CENTRE = { lat: 25.6863, lng: 85.2095 };
const PATNA_CENTRE = { lat: 25.5941, lng: 85.1376 };

function shop(
  id: string,
  lat: number | null,
  lng: number | null,
): DistanceCandidate {
  return { id, lat, lng };
}

describe('rankByDistance', () => {
  it('orders nearest-first using the same Haversine the rest of the platform uses', () => {
    const far = shop('far', 25.8, 85.4);
    const near = shop('near', 25.69, 85.21);
    const mid = shop('mid', 25.72, 85.25);
    const ranked = rankByDistance([far, near, mid], HAJIPUR_CENTRE);

    expect(ranked.map((r) => r.id)).toEqual(['near', 'mid', 'far']);
    expect(ranked[0].distanceKm).toBeCloseTo(
      haversineDistanceKm(25.6863, 85.2095, 25.69, 85.21),
      9,
    );
    expect(ranked[0].distanceKm).toBeLessThan(1);
  });

  it('keeps shops without coordinates — after every shop that has a distance, never first, never a fake 0', () => {
    const ranked = rankByDistance(
      [
        shop('b-none', null, null),
        shop('a-none', null, null),
        shop('has', 25.7, 85.2),
        shop('half', 25.7, null),
      ],
      HAJIPUR_CENTRE,
    );

    expect(ranked.map((r) => r.id)).toEqual([
      'has',
      'a-none',
      'b-none',
      'half',
    ]);
    expect(ranked[0]).toMatchObject({ id: 'has' });
    expect(ranked.slice(1).every((r) => r.distanceKm === null)).toBe(true);
  });

  it('treats a shop with only one coordinate as having no distance (no guessing the other half)', () => {
    const ranked = rankByDistance(
      [shop('half-lat', 25.7, null), shop('half-lng', null, 85.2)],
      HAJIPUR_CENTRE,
    );
    expect(ranked.map((r) => r.distanceKm)).toEqual([null, null]);
  });

  it('breaks distance ties on id so the whole order is deterministic and therefore pageable', () => {
    const ranked = rankByDistance(
      [shop('zzz', 25.7, 85.2), shop('aaa', 25.7, 85.2)],
      HAJIPUR_CENTRE,
    );
    expect(ranked.map((r) => r.id)).toEqual(['aaa', 'zzz']);
  });

  it('measures from whichever origin it is given — a city centre and a GPS fix give different distances', () => {
    const candidate = shop('x', 25.69, 85.21); // a Hajipur shop
    const fromHajipurCentre = rankByDistance([candidate], HAJIPUR_CENTRE)[0]
      .distanceKm!;
    const fromPatnaCentre = rankByDistance([candidate], PATNA_CENTRE)[0]
      .distanceKm!;
    expect(fromHajipurCentre).toBeLessThan(1);
    expect(fromPatnaCentre).toBeGreaterThan(8);
  });

  describe('hard radius', () => {
    it('excludes anything beyond the radius, judged on the raw (unrounded) distance', () => {
      const inside = shop('inside', 25.69, 85.21); // < 1 km
      const outside = shop('outside', 25.8, 85.4); // > 20 km
      const ranked = rankByDistance([outside, inside], HAJIPUR_CENTRE, {
        radiusKm: 5,
      });
      expect(ranked.map((r) => r.id)).toEqual(['inside']);
    });

    it('excludes shops without coordinates, because they cannot be shown to be inside the radius', () => {
      const ranked = rankByDistance(
        [shop('none', null, null), shop('inside', 25.69, 85.21)],
        HAJIPUR_CENTRE,
        {
          radiusKm: 5,
        },
      );
      expect(ranked.map((r) => r.id)).toEqual(['inside']);
    });

    it('is inclusive at exactly the radius', () => {
      const candidate = shop('edge', 25.7, 85.22);
      const exact = haversineDistanceKm(
        HAJIPUR_CENTRE.lat,
        HAJIPUR_CENTRE.lng,
        25.7,
        85.22,
      );
      expect(
        rankByDistance([candidate], HAJIPUR_CENTRE, { radiusKm: exact }),
      ).toHaveLength(1);
      expect(
        rankByDistance([candidate], HAJIPUR_CENTRE, {
          radiusKm: exact - 0.0001,
        }),
      ).toHaveLength(0);
    });

    it('applies no radius at all when none was selected — a city is never silently narrowed', () => {
      const everything = [
        shop('a', 25.69, 85.21),
        shop('b', 28.6, 77.2) /* Delhi */,
        shop('c', null, null),
      ];
      expect(rankByDistance(everything, HAJIPUR_CENTRE)).toHaveLength(3);
    });
  });
});

describe('pageAfterCursor', () => {
  const ordered = Array.from({ length: 45 }, (_, i) => ({
    id: `s${String(i).padStart(2, '0')}`,
  }));

  it('walks the entire ordered set across pages with no gaps and no duplicates', () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const { page, nextCursor } = pageAfterCursor(ordered, cursor, 20);
      seen.push(...page.map((p) => p.id));
      cursor = nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toEqual(ordered.map((o) => o.id));
    expect(new Set(seen).size).toBe(45);
  });

  it('reports no next cursor when the last page is exactly full', () => {
    const { page, nextCursor } = pageAfterCursor(
      ordered.slice(0, 40),
      's19',
      20,
    );
    expect(page).toHaveLength(20);
    expect(nextCursor).toBeNull();
  });

  it('returns an empty page and no cursor for an empty set', () => {
    expect(pageAfterCursor([], undefined, 20)).toEqual({
      page: [],
      nextCursor: null,
    });
  });

  it('restarts from the top when the cursor shop has since disappeared, instead of returning a truncated empty page', () => {
    const { page, nextCursor } = pageAfterCursor(
      ordered,
      'no-longer-active',
      20,
    );
    expect(page[0].id).toBe('s00');
    expect(nextCursor).toBe('s19');
  });
});
