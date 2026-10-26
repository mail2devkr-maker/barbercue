jest.mock('../../api', () => {
  class MockApiError extends Error {
    code: string;
    details?: unknown;
    status: number;
    constructor(status: number, body: { error?: { code?: string; message?: string; details?: unknown } }) {
      super(body.error?.message ?? 'Request failed');
      this.status = status;
      this.code = body.error?.code ?? 'UNKNOWN_ERROR';
      this.details = body.error?.details;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

import { ApiError, apiFetch } from '../../api';
import { CitySearchError, __resetCityCacheForTests, fetchAvailableCities, searchCities } from '../city-api';

const apiMock = apiFetch as jest.Mock;
const apiError = (status: number, code: string, details?: unknown) =>
  new (ApiError as unknown as new (s: number, b: unknown) => Error)(status, { error: { code, message: code, details } });

const VALIDATION_COUNTRY_ID = apiError(400, 'VALIDATION_ERROR', { issues: [{ path: 'countryId', message: 'Required' }] });

const IN_COUNTRY = { id: 'country-in-uuid', name: 'India', isoCode2: 'IN', hasSubdivisions: true };
const GB_COUNTRY = { id: 'country-gb-uuid', name: 'United Kingdom', isoCode2: 'GB', hasSubdivisions: true };
const AVAILABLE = [
  { id: 'c-haj', name: 'Hajipur', slug: 'hajipur-bihar', countryCode: 'IN', regionCode: null, state: 'Bihar', country: 'India' },
  { id: 'c-del', name: 'New Delhi', slug: 'new-delhi', countryCode: 'IN', regionCode: null, state: 'Delhi', country: 'India' },
];
const PATNA_ROW = { id: 'c-pat', name: 'Patna', slug: 'patna', countryCode: 'IN', region: { id: 'r1', name: 'Bihar', code: 'BR' } };
const HAJIPUR_ROW = { id: 'c-haj', name: 'Hajipur', slug: 'hajipur-bihar', countryCode: 'IN', region: { id: 'r1', name: 'Bihar', code: 'BR' } };

function route(handlers: Record<string, (path: string) => unknown>) {
  apiMock.mockImplementation(async (path: string) => {
    // Longest matching prefix wins, so 'cities/search?countryId=' beats 'cities'.
    const key = Object.keys(handlers)
      .filter((k) => path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unexpected request ${path}`);
    const out = handlers[key](path);
    if (out instanceof Error) throw out;
    return out;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetCityCacheForTests();
});

describe('searchCities against the current backend (hasShops supported)', () => {
  it('sends the hasShops contract once and returns the server list untouched', async () => {
    route({ 'cities/search': () => [PATNA_ROW] });
    const outcome = await searchCities('patna');
    expect(outcome).toMatchObject({ mode: 'server', activeShopKeys: null });
    expect(outcome.cities.map((c) => c.slug)).toEqual(['patna']);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock.mock.calls[0][0]).toContain('hasShops=true');
    expect(apiMock.mock.calls[0][0]).not.toContain('countryId');
  });

  it('a successful empty result is CITY_NOT_FOUND (empty list), never an error', async () => {
    route({ 'cities/search': () => [] });
    await expect(searchCities('zzzz')).resolves.toMatchObject({ cities: [], mode: 'server' });
  });

  it('a query shorter than 2 letters makes no request', async () => {
    await searchCities('p');
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('searchCities against the deployed older backend (countryId required)', () => {
  function legacy(extra: Record<string, (p: string) => unknown> = {}) {
    route({
      'cities/search?q=': () => VALIDATION_COUNTRY_ID,
      'cities/search?countryId=': (p) => (p.includes('country-in-uuid') ? [PATNA_ROW, HAJIPUR_ROW] : []),
      cities: () => AVAILABLE,
      countries: () => [GB_COUNTRY, IN_COUNTRY],
      ...extra,
    });
  }

  it('detects the exact 400 contract rejection and searches per country using ids from GET countries (no hard-coded UUID)', async () => {
    legacy();
    const outcome = await searchCities('pa');
    expect(outcome.mode).toBe('legacy');
    const calls = apiMock.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((p) => p.startsWith('cities/search?countryId='))).toHaveLength(1);
    expect(calls.find((p) => p.startsWith('cities/search?countryId='))).toContain('countryId=country-in-uuid');
    // GB has no shop, so it is not searched at all: the fan-out follows where shops exist.
    expect(calls.some((p) => p.includes('country-gb-uuid'))).toBe(false);
    expect(outcome.cities.map((c) => c.name)).toEqual(['Hajipur', 'Patna']);
  });

  it('marks cities with no active shop (CITY_FOUND_NO_ACTIVE_SHOPS) and lists cities with shops first', async () => {
    legacy();
    const outcome = await searchCities('pa');
    expect(outcome.activeShopKeys?.has('IN:hajipur-bihar')).toBe(true);
    expect(outcome.activeShopKeys?.has('IN:patna')).toBe(false);
    expect(outcome.cities[0].slug).toBe('hajipur-bihar');
    expect(outcome.cities[1].slug).toBe('patna');
  });

  it('fills country and region so same-named cities stay distinguishable', async () => {
    legacy();
    const patna = (await searchCities('pa')).cities.find((c) => c.slug === 'patna')!;
    expect(patna).toMatchObject({ regionName: 'Bihar', countryName: 'India', countryCode: 'IN' });
  });

  it('remembers the rejection for the session: later searches skip the doomed hasShops request', async () => {
    legacy();
    await searchCities('pa');
    apiMock.mockClear();
    await searchCities('pat');
    const calls = apiMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((p) => p.includes('hasShops'))).toBe(false);
  });

  it('never downloads the full city catalogue', async () => {
    legacy();
    await searchCities('pa');
    expect(apiMock.mock.calls.map((c) => String(c[0])).some((p) => p.includes('cities/all'))).toBe(false);
  });

  it('is BACKEND_UNSUPPORTED when there is no country to search in (no shops anywhere)', async () => {
    legacy({ cities: () => [] });
    await expect(searchCities('pa')).rejects.toMatchObject({ kind: 'BACKEND_UNSUPPORTED' });
  });

  it('is NETWORK_ERROR when the per-country search cannot be reached', async () => {
    legacy({ 'cities/search?countryId=': () => new TypeError('Network request failed') });
    await expect(searchCities('pa')).rejects.toMatchObject({ kind: 'NETWORK_ERROR' });
  });

  it('is BACKEND_UNSUPPORTED when the per-country search is refused with a 4xx', async () => {
    legacy({ 'cities/search?countryId=': () => apiError(404, 'NOT_FOUND') });
    await expect(searchCities('pa')).rejects.toMatchObject({ kind: 'BACKEND_UNSUPPORTED' });
  });
});

describe('failure classification', () => {
  it('a network failure on the first request is NETWORK_ERROR and does NOT switch to the legacy path', async () => {
    route({ 'cities/search': () => new TypeError('Network request failed') });
    await expect(searchCities('patna')).rejects.toBeInstanceOf(CitySearchError);
    apiMock.mockClear();
    route({ 'cities/search': () => [PATNA_ROW] });
    const outcome = await searchCities('patna');
    expect(outcome.mode).toBe('server');
    expect(String(apiMock.mock.calls[0][0])).toContain('hasShops=true');
  });

  it('a 5xx is NETWORK_ERROR (retryable)', async () => {
    route({ 'cities/search': () => apiError(503, 'SERVICE_UNAVAILABLE') });
    await expect(searchCities('patna')).rejects.toMatchObject({ kind: 'NETWORK_ERROR' });
  });

  it('a validation 400 about some OTHER field is not mistaken for the legacy contract', async () => {
    route({ 'cities/search': () => apiError(400, 'VALIDATION_ERROR', { issues: [{ path: 'limit', message: 'bad' }] }) });
    await expect(searchCities('patna')).rejects.toMatchObject({ kind: 'BACKEND_UNSUPPORTED' });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchAvailableCities', () => {
  it('is cached for the session', async () => {
    route({ cities: () => AVAILABLE });
    await fetchAvailableCities();
    await fetchAvailableCities();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
