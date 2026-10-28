/// <reference types="jest" />
import { DEFAULT_DISCOVERY_FILTERS, buildDiscoveryQuery } from '../discovery-search';

const base = { text: '', coords: null, favoriteIds: null };

describe('buildDiscoveryQuery', () => {
  it('sends salon type, compared service, price, rating and open now', () => {
    const built = buildDiscoveryQuery({
      ...base,
      filters: {
        ...DEFAULT_DISCOVERY_FILTERS,
        salonType: 'LADIES',
        popularService: 'facial',
        priceMax: 800,
        sort: 'price',
        minRating: 4,
        openNow: true,
      },
    });
    expect(built).toEqual({
      kind: 'search',
      query: 'priceMax=800&salonType=LADIES&popularService=facial&sort=price&minRating=4&openNow=true',
    });
  });

  it('never sends a sort the API would reject', () => {
    const price = buildDiscoveryQuery({ ...base, filters: { ...DEFAULT_DISCOVERY_FILTERS, sort: 'price' } });
    expect(price).toEqual({ kind: 'search', query: '' });
    const distance = buildDiscoveryQuery({ ...base, filters: { ...DEFAULT_DISCOVERY_FILTERS, sort: 'distance' } });
    expect(distance).toEqual({ kind: 'search', query: '' });
    const near = buildDiscoveryQuery({
      ...base,
      coords: { lat: 18.5, lng: 73.8 },
      filters: { ...DEFAULT_DISCOVERY_FILTERS, sort: 'distance', radiusKm: 2 },
    });
    expect(near).toEqual({ kind: 'search', query: 'lat=18.5&lng=73.8&radiusKm=2&sort=distance' });
  });

  it('favorites only: needs a signed-in customer, says so when nothing is saved, else sends the IDs', () => {
    const filters = { ...DEFAULT_DISCOVERY_FILTERS, favoritesOnly: true };
    expect(buildDiscoveryQuery({ ...base, filters })).toEqual({ kind: 'favorites-sign-in' });
    expect(buildDiscoveryQuery({ ...base, filters, favoriteIds: new Set() })).toEqual({ kind: 'favorites-empty' });
    expect(buildDiscoveryQuery({ ...base, filters, favoriteIds: new Set(['a', 'b']) })).toEqual({
      kind: 'search',
      query: 'ids=a%2Cb',
    });
    // Saved IDs are only sent when the customer asked for favorites only.
    expect(buildDiscoveryQuery({ ...base, filters: DEFAULT_DISCOVERY_FILTERS, favoriteIds: new Set(['a']) })).toEqual({
      kind: 'search',
      query: '',
    });
  });

  it('typed text wins over the category filter', () => {
    expect(
      buildDiscoveryQuery({ ...base, text: ' beard ', filters: { ...DEFAULT_DISCOVERY_FILTERS, service: 'hair' } }),
    ).toEqual({ kind: 'search', query: 'service=beard' });
  });
});
