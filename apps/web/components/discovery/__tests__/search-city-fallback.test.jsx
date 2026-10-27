import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import SearchClient from '../../../app/(public)/search/SearchClient';
import { apiFetch } from '../../../lib/api';

// When the country catalogue is empty or unavailable (e.g. a fresh local database), the City field
// must not sit on "Loading cities…" forever: it offers the cities that actually have salons.
const push = jest.fn();
let query = '';
let params = new URLSearchParams();
// Stable per query, like the real hook (a new object every render would refetch in a loop).
const mockSearchParams = () => (params.toString() === query ? params : (params = new URLSearchParams(query)));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => mockSearchParams() }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));
jest.mock('../../../lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'unauthenticated' }) }));
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../../discovery/ShopNameSearchField', () => ({ ShopNameSearchField: () => null }));
jest.mock('../../salons/CitySearchField', () => ({ CitySearchField: () => <span>city-autocomplete</span> }));
jest.mock('../../ui/SalonImage', () => ({ SalonImage: () => null }));

const cities = [
  { id: 'c1', name: 'Bengaluru', slug: 'bengaluru', countryCode: 'IN', regionCode: null, state: 'Karnataka', country: 'India' },
  { id: 'c2', name: 'Pune', slug: 'pune', countryCode: 'IN', regionCode: null, state: 'Maharashtra', country: 'India' },
];
const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));

async function render(countries) {
  apiFetch.mockImplementation((path) =>
    path === 'countries' ? (countries instanceof Error ? Promise.reject(countries) : Promise.resolve(countries)) : Promise.resolve(cities),
  );
  let tree;
  await act(async () => { tree = TestRenderer.create(<SearchClient />); });
  await act(async () => {});
  return tree;
}

beforeEach(() => {
  push.mockReset();
  apiFetch.mockReset();
  query = '';
  globalThis.window = { location: { search: '' }, innerHeight: 800, addEventListener() {}, removeEventListener() {}, sessionStorage: { getItem: () => null } };
  globalThis.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) }));
});
afterEach(() => { delete globalThis.window; });

it('offers the cities with salons when the country catalogue is empty, and searches the chosen one', async () => {
  const tree = await render([]);
  const select = tree.root.find((n) => n.type === 'select' && n.props['aria-labelledby'] === 'search-city-label');
  expect(select.findAllByType('option').map(textOf)).toEqual(['Any city', 'Bengaluru, Karnataka', 'Pune, Maharashtra']);
  expect(textOf(tree.root)).not.toContain('Loading cities');
  await act(async () => select.props.onChange({ target: { value: 'pune' } }));
  await act(async () => tree.root.findByProps({ role: 'search' }).props.onSubmit({ preventDefault() {} }));
  expect(push).toHaveBeenLastCalledWith('/search?city=pune&countryCode=IN');
});

it('also falls back when the country request fails, and keeps the city from the link selected', async () => {
  query = 'city=bengaluru&countryCode=IN';
  window.location.search = '?city=bengaluru&countryCode=IN';
  const tree = await render(new Error('down'));
  const select = tree.root.find((n) => n.type === 'select' && n.props['aria-labelledby'] === 'search-city-label');
  expect(select.props.value).toBe('bengaluru');
  // "Any city" really clears the city.
  await act(async () => select.props.onChange({ target: { value: '' } }));
  await act(async () => tree.root.findByProps({ role: 'search' }).props.onSubmit({ preventDefault() {} }));
  expect(push).toHaveBeenLastCalledWith('/search');
});

it('uses the type-to-search city field when the catalogue has India', async () => {
  const tree = await render([{ id: 'in', isoCode2: 'IN', name: 'India' }]);
  expect(textOf(tree.root)).toContain('city-autocomplete');
  expect(tree.root.findAll((n) => n.type === 'select' && n.props['aria-labelledby'] === 'search-city-label')).toHaveLength(0);
});
