import { applyLoadedDistanceFallback, buildSalonSearchParams, DEFAULT_SEARCH_FILTERS, locationKey, mergePage, serverSuppliedDistances, sortLoadedByDistance } from '../search-params';
import { distanceOrigin, type DeviceLocationSelection, type ManualCitySelection } from '../selection';
import { HAJIPUR, NO_CENTRE_CITY, PATNA, shop } from '../__fixtures__/cities';

const manual = (city = HAJIPUR): ManualCitySelection => ({ mode: 'city', city, selectedAt: 1 });
const device: DeviceLocationSelection = { mode: 'device', coords: { lat: 25.5941, lng: 85.1376 }, label: 'Patna', capturedAt: 2 };

const build = (selection: ManualCitySelection | DeviceLocationSelection | null, extra: Partial<typeof DEFAULT_SEARCH_FILTERS> = {}, queryText = '', cursor?: string) =>
  Object.fromEntries(buildSalonSearchParams({ selection, filters: { ...DEFAULT_SEARCH_FILTERS, ...extra }, queryText, cursor }).entries());

describe('buildSalonSearchParams', () => {
  it('city mode filters by city and sends the centre ONLY as originLat/originLng — never lat/lng (Near Me)', () => {
    const params = build(manual());
    expect(params).toMatchObject({ city: 'hajipur', countryCode: 'IN', originLat: '25.6853', originLng: '85.209', sort: 'nearest' });
    expect(params).not.toHaveProperty('lat');
    expect(params).not.toHaveProperty('lng');
  });

  it('picking a city NEVER applies a radius', () => {
    expect(build(manual())).not.toHaveProperty('radiusKm');
  });

  it('city mode with no stored centre still filters by city but sends no origin and no sort', () => {
    const params = build(manual(NO_CENTRE_CITY));
    expect(params).toMatchObject({ city: 'smallville', countryCode: 'IN' });
    expect(params).not.toHaveProperty('originLat');
    expect(params).not.toHaveProperty('sort');
  });

  it('device mode has no city filter, sends the GPS fix as origin, and no automatic radius', () => {
    const params = build(device);
    expect(params).toMatchObject({ originLat: '25.5941', originLng: '85.1376', sort: 'nearest' });
    expect(params).not.toHaveProperty('city');
    expect(params).not.toHaveProperty('radiusKm');
    expect(params).not.toHaveProperty('lat');
  });

  it('sends an explicit radius only when the customer chose one, and only with an origin', () => {
    expect(build(device, { radiusKm: 5 })).toMatchObject({ radiusKm: '5' });
    expect(build(manual(), { radiusKm: 10 })).toMatchObject({ radiusKm: '10', city: 'hajipur' });
    expect(build(manual(NO_CENTRE_CITY), { radiusKm: 10 })).not.toHaveProperty('radiusKm');
    expect(build(null, { radiusKm: 10 })).not.toHaveProperty('radiusKm');
  });

  it('name sort omits sort=nearest but keeps the origin so distances still display', () => {
    const params = build(manual(), { sort: 'name' });
    expect(params).not.toHaveProperty('sort');
    expect(params).toHaveProperty('originLat');
  });

  it('preserves service, text, price filters and the cursor', () => {
    const params = build(manual(), { service: 'haircut', priceMin: 100, priceMax: 500 }, '', 'cursor-1');
    expect(params).toMatchObject({ service: 'haircut', priceMin: '100', priceMax: '500', cursor: 'cursor-1' });
    expect(build(manual(), { service: 'haircut' }, '  facial  ')).toMatchObject({ service: 'facial' });
  });

  it('no selection: no location params at all', () => {
    expect(build(null)).toEqual({});
  });
});

describe('locationKey', () => {
  it('differs between cities, including same-name cities in different countries', () => {
    expect(locationKey(manual(HAJIPUR))).not.toBe(locationKey(manual(PATNA)));
    expect(locationKey(manual({ ...HAJIPUR, countryCode: 'GB' }))).not.toBe(locationKey(manual(HAJIPUR)));
  });

  it('ignores GPS wobble below ~110 m but notices a real move', () => {
    const near = { ...device, coords: { lat: 25.59411, lng: 85.13761 } };
    const far = { ...device, coords: { lat: 25.62, lng: 85.13761 } };
    expect(locationKey(near)).toBe(locationKey(device));
    expect(locationKey(far)).not.toBe(locationKey(device));
    expect(locationKey(null)).toBe('none');
  });
});

describe('older-backend fallback helpers', () => {
  const origin = distanceOrigin(manual())!;
  const near = shop({ id: 'near', name: 'Near', lat: 25.69, lng: 85.21 });
  const far = shop({ id: 'far', name: 'Far', lat: 25.59, lng: 85.13 });
  const noCoords = shop({ id: 'none', name: 'AAA No coords' });

  it('detects a server that ignored the origin (shops have coordinates but no distance)', () => {
    expect(serverSuppliedDistances([near, far])).toBe(false);
    expect(serverSuppliedDistances([{ ...near, distanceKm: 0.5 }, far])).toBe(true);
    expect(serverSuppliedDistances([noCoords])).toBe(true);
    expect(serverSuppliedDistances([])).toBe(true);
  });

  it('sorts nearest first, keeps coordinate-less shops visible at the end, drops nothing', () => {
    const sorted = sortLoadedByDistance([noCoords, far, near], origin);
    expect(sorted.map((s) => s.id)).toEqual(['near', 'far', 'none']);
  });

  it('does not mutate its input', () => {
    const input = [noCoords, far, near];
    sortLoadedByDistance(input, origin);
    expect(input.map((s) => s.id)).toEqual(['none', 'far', 'near']);
  });
});

describe('mergePage', () => {
  it('appends new shops and ignores repeats after a cursor restart', () => {
    const a = shop({ id: 'a', name: 'A' });
    const b = shop({ id: 'b', name: 'B' });
    const c = shop({ id: 'c', name: 'C' });
    expect(mergePage([a, b], [b, c]).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyLoadedDistanceFallback (older backend)', () => {
  const origin = distanceOrigin(manual())!;
  const near = shop({ id: 'near', name: 'Near', lat: 25.69, lng: 85.21 });
  const far = shop({ id: 'far', name: 'Far', lat: 25.5941, lng: 85.1376 });
  const noCoords = shop({ id: 'none', name: 'None' });

  it('leaves a server-measured list exactly as the server returned it (no re-sorting, no flag)', () => {
    const served = [{ ...far, distanceKm: 1 }, { ...near, distanceKm: 2 }];
    expect(applyLoadedDistanceFallback(served, origin, { sort: 'nearest', radiusKm: 1 })).toEqual({ items: served, approximate: false });
  });

  it('with no origin there is nothing to measure and nothing is changed or flagged', () => {
    expect(applyLoadedDistanceFallback([far, near], null, { sort: 'nearest', radiusKm: null })).toEqual({ items: [far, near], approximate: false });
  });

  it('flags the order as approximate and sorts only what was loaded', () => {
    const result = applyLoadedDistanceFallback([noCoords, far, near], origin, { sort: 'nearest', radiusKm: null });
    expect(result.approximate).toBe(true);
    expect(result.items.map((s) => s.id)).toEqual(['near', 'far', 'none']);
  });

  it('name sort keeps the server order but is still flagged (distances are computed locally)', () => {
    const result = applyLoadedDistanceFallback([noCoords, far, near], origin, { sort: 'name', radiusKm: null });
    expect(result.items.map((s) => s.id)).toEqual(['none', 'far', 'near']);
    expect(result.approximate).toBe(true);
  });

  it('applies an explicit radius itself, because the older server ignored it', () => {
    const result = applyLoadedDistanceFallback([noCoords, far, near], origin, { sort: 'nearest', radiusKm: 5 });
    expect(result.items.map((s) => s.id)).toEqual(['near']);
    expect(result.approximate).toBe(true);
  });
});
