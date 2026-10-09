import { uiStringsFor } from '@barbercue/shared';

const enUi = uiStringsFor('EN');
const hiUi = uiStringsFor('HI');
import {
  cityDisplayLine,
  cityFromDto,
  cityFromSearchResult,
  cityKey,
  citySubtitle,
  distanceOrigin,
  filterCitiesLocally,
  fullLocationLabel,
  parseRecents,
  parseSelection,
  pushRecentCity,
  resolveShopDistanceKm,
  serializeRecents,
  serializeSelection,
  shopDistanceLabel,
  shortLocationLabel,
  type DeviceLocationSelection,
  type ManualCitySelection,
} from '../selection';
import { DELHI, HAJIPUR, LONDON_CA, LONDON_GB, NO_CENTRE_CITY, PATNA, shop } from '../__fixtures__/cities';

const manual = (city = HAJIPUR): ManualCitySelection => ({ mode: 'city', city, selectedAt: 1 });
const device = (label: string | null = 'Patna'): DeviceLocationSelection => ({
  mode: 'device',
  coords: { lat: 25.5941, lng: 85.1376 },
  label,
  capturedAt: 2,
});

describe('DTO mapping', () => {
  it('keeps backend city centre coordinates and region/country for a search result', () => {
    const city = cityFromSearchResult({
      id: 'c1',
      name: 'Hajipur',
      slug: 'hajipur',
      countryCode: 'IN',
      countryName: 'India',
      state: 'Bihar',
      latitude: 25.6853,
      longitude: 85.209,
    } as never);
    expect(city).toMatchObject({ regionName: 'Bihar', countryName: 'India', latitude: 25.6853, longitude: 85.209 });
  });

  it('treats missing, non-finite or out-of-range coordinates as null — never invents a centre', () => {
    expect(cityFromDto({ id: 'a', name: 'A', slug: 'a', countryCode: 'IN', country: 'India' } as never)).toMatchObject({ latitude: null, longitude: null });
    expect(cityFromDto({ id: 'a', name: 'A', slug: 'a', countryCode: 'IN', country: 'India', latitude: 95, longitude: 10 } as never).latitude).toBeNull();
    expect(cityFromDto({ id: 'a', name: 'A', slug: 'a', countryCode: 'IN', country: 'India', latitude: NaN, longitude: 10 } as never).latitude).toBeNull();
  });
});

describe('duplicate city names across countries', () => {
  it('uses (country, slug) as the identity so London GB and London CA are different cities', () => {
    expect(cityKey(LONDON_GB)).not.toBe(cityKey(LONDON_CA));
    expect(cityKey({ countryCode: 'in', slug: 'hajipur' })).toBe(cityKey(HAJIPUR));
  });

  it('labels each with region and country so the customer can tell them apart', () => {
    expect(cityDisplayLine(LONDON_GB)).toBe('London, England, United Kingdom');
    expect(cityDisplayLine(LONDON_CA)).toBe('London, Ontario, Canada');
    expect(citySubtitle(LONDON_CA)).toBe('Ontario, Canada');
  });

  it('does not repeat a name that equals its region (Delhi, Delhi)', () => {
    expect(cityDisplayLine(DELHI)).toBe('Delhi, India');
  });
});

describe('labels', () => {
  it('shows the city name for a manual selection and a prompt when nothing is chosen', () => {
    expect(shortLocationLabel(manual(), enUi)).toBe('Hajipur');
    expect(shortLocationLabel(null, enUi)).toBe(enUi.chooseLocationAction);
  });

  it('labels a device selection by the resolved city, or a generic label when geocoding failed', () => {
    expect(shortLocationLabel(device('Patna'), enUi)).toBe('Patna');
    expect(shortLocationLabel(device(null), enUi)).toBe(enUi.myCurrentLocationLabel);
    expect(fullLocationLabel(device('Patna'), enUi)).toContain('Patna');
  });

  it('is localised in Hindi and English', () => {
    expect(shortLocationLabel(null, hiUi)).toBe(hiUi.chooseLocationAction);
    expect(shortLocationLabel(null, hiUi)).not.toBe(shortLocationLabel(null, enUi));
  });
});

describe('distanceOrigin', () => {
  it('is null with no selection', () => {
    expect(distanceOrigin(null)).toBeNull();
  });

  it('city mode uses the stored city centre as a reference point, labelled as a city', () => {
    expect(distanceOrigin(manual())).toEqual({ kind: 'city', lat: 25.6853, lng: 85.209, cityName: 'Hajipur' });
  });

  it('city mode with no stored centre has NO origin (distance stays unavailable, nothing fabricated)', () => {
    expect(distanceOrigin(manual(NO_CENTRE_CITY))).toBeNull();
  });

  it('device mode uses the real coordinates and is labelled as the device', () => {
    expect(distanceOrigin(device())).toEqual({ kind: 'device', lat: 25.5941, lng: 85.1376 });
  });
});

describe('resolveShopDistanceKm / shopDistanceLabel', () => {
  const hajipurOrigin = distanceOrigin(manual())!;
  const deviceOrigin = distanceOrigin(device())!;

  it('prefers the distance the server supplied', () => {
    const s = shop({ id: 's', name: 'S', distanceKm: 2.5, lat: 25.7, lng: 85.2 });
    expect(resolveShopDistanceKm(s, hajipurOrigin)).toBe(2.5);
    expect(shopDistanceLabel(s, hajipurOrigin, enUi)).toBe('2.5 km from Hajipur centre');
  });

  it('city-mode wording never claims the customer is that far away', () => {
    const label = shopDistanceLabel(shop({ id: 's', name: 'S', distanceKm: 2.5 }), hajipurOrigin, enUi);
    expect(label).toContain('Hajipur centre');
    expect(label).not.toMatch(/from you/i);
  });

  it('device-mode wording says "from you"; sub-km distances show metres', () => {
    expect(shopDistanceLabel(shop({ id: 's', name: 'S', distanceKm: 0.45 }), deviceOrigin, enUi)).toBe('450 m from you');
    expect(shopDistanceLabel(shop({ id: 's', name: 'S', distanceKm: 1.2 }), deviceOrigin, enUi)).toBe('1.2 km from you');
  });

  it('computes a Haversine distance itself when the server (older backend) supplied none', () => {
    const km = resolveShopDistanceKm(shop({ id: 's', name: 'S', lat: 25.5941, lng: 85.1376 }), hajipurOrigin);
    expect(km).not.toBeNull();
    // Hajipur centre -> Patna is roughly 12–13 km in a straight line.
    expect(km!).toBeGreaterThan(10);
    expect(km!).toBeLessThan(16);
  });

  it('is "Distance unavailable" — not 0 — when the shop has no coordinates', () => {
    const s = shop({ id: 's', name: 'S' });
    expect(resolveShopDistanceKm(s, hajipurOrigin)).toBeNull();
    expect(shopDistanceLabel(s, hajipurOrigin, enUi)).toBe(enUi.distanceUnavailable);
  });

  it('is "Distance unavailable" when the origin is missing (city with no centre)', () => {
    expect(shopDistanceLabel(shop({ id: 's', name: 'S', lat: 25.7, lng: 85.2 }), null, enUi)).toBe(enUi.distanceUnavailable);
  });

  it('has Hindi wording for both origins', () => {
    const s = shop({ id: 's', name: 'S', distanceKm: 3 });
    expect(shopDistanceLabel(s, hajipurOrigin, hiUi)).toBe('Hajipur केंद्र से 3 km');
    expect(shopDistanceLabel(s, deviceOrigin, hiUi)).toBe('आपसे 3 km');
  });

  it('uses miles for imperial countries without changing the origin wording', () => {
    const s = shop({ id: 's', name: 'S', countryCode: 'US', distanceKm: 1.609344 });
    expect(shopDistanceLabel(s, deviceOrigin, enUi)).toBe('1 mi from you');
  });
});

describe('persistence', () => {
  it('round-trips a manual city selection including its centre', () => {
    const restored = parseSelection(serializeSelection(manual(PATNA)));
    expect(restored).toMatchObject({ mode: 'city', city: { slug: 'patna', latitude: 25.5941 } });
  });

  it('round-trips a device selection with provenance', () => {
    expect(parseSelection(serializeSelection(device('Patna')))).toMatchObject({
      mode: 'device',
      label: 'Patna',
      coords: { lat: 25.5941, lng: 85.1376 },
    });
  });

  it.each([null, '', 'not json', '{}', '{"v":99,"selection":{}}', '{"v":1,"selection":{"mode":"city"}}', '{"v":1,"selection":{"mode":"device","coords":{"lat":999,"lng":0}}}', '{"v":1,"selection":{"mode":"alien"}}'])(
    'never throws on corrupt storage (%p) — it just means "no selection"',
    (raw) => {
      expect(parseSelection(raw as string | null)).toBeNull();
    },
  );

  it('keeps at most 5 recents, newest first, without duplicates', () => {
    let recents = [] as ReturnType<typeof pushRecentCity>;
    for (const city of [HAJIPUR, PATNA, DELHI, LONDON_GB, LONDON_CA, NO_CENTRE_CITY]) recents = pushRecentCity(recents, city);
    expect(recents).toHaveLength(5);
    expect(recents[0].id).toBe(NO_CENTRE_CITY.id);
    expect(recents.map((c) => c.id)).not.toContain(HAJIPUR.id);
    recents = pushRecentCity(recents, DELHI);
    expect(recents[0].id).toBe(DELHI.id);
    expect(recents.filter((c) => c.id === DELHI.id)).toHaveLength(1);
  });

  it('London GB and London CA are separate recents', () => {
    const recents = pushRecentCity(pushRecentCity([], LONDON_GB), LONDON_CA);
    expect(recents).toHaveLength(2);
  });

  it('round-trips recents and tolerates garbage', () => {
    expect(parseRecents(serializeRecents([HAJIPUR, PATNA])).map((c) => c.slug)).toEqual(['hajipur', 'patna']);
    expect(parseRecents('garbage')).toEqual([]);
    expect(parseRecents(null)).toEqual([]);
  });
});

describe('filterCitiesLocally', () => {
  const all = [PATNA, HAJIPUR, DELHI, LONDON_GB, LONDON_CA];

  it('is case-insensitive and prefix matches come first', () => {
    expect(filterCitiesLocally(all, 'HAJ').map((c) => c.name)).toEqual(['Hajipur']);
    expect(filterCitiesLocally(all, 'pur').map((c) => c.name)).toEqual(['Hajipur']);
  });

  it('returns every duplicate-named city so none is hidden', () => {
    expect(filterCitiesLocally(all, 'london')).toHaveLength(2);
  });

  it('is accent tolerant and returns everything for an empty query', () => {
    expect(filterCitiesLocally([{ ...PATNA, name: 'Pätna' }], 'patna')).toHaveLength(1);
    expect(filterCitiesLocally(all, '  ')).toHaveLength(5);
    expect(filterCitiesLocally(all, 'zzz')).toEqual([]);
  });
});
