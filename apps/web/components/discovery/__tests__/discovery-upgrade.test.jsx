import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { Role } from '@barbercue/shared';
import {
  activeFilterCount,
  popularServiceChange,
  priceRangeChange,
  readDiscoveryState,
  searchApiQuery,
  sortUnavailableReason,
} from '../../../lib/discovery-params';
import { resetFavoritesForTests, sortFavorites, useFavorites } from '../../../lib/favorites';
import { CompareTable, FiltersPanel, SortControl } from '../DiscoveryFilters';
import { SalonCard } from '../SalonCard';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className }) => <a href={href} className={className}>{children}</a> }));
jest.mock('../../../lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../../ui/SalonImage', () => ({ SalonImage: () => null }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const salon = (over = {}) => ({
  id: 's1', publicId: 'BC-1', name: 'Alpha Cuts', slug: 'alpha', citySlug: 'pune', countryCode: 'IN', currency: 'INR',
  addressLine: 'MG Road', postalCode: null, lat: null, lng: null, coverPhotoUrl: null, ratingAverage: 4.6, ratingCount: 12,
  priceMin: 99, priceMax: 900, distanceKm: 1.2, isOpenNow: true, isClosedForToday: false, verified: false, waitingCount: 0,
  salonType: 'GENTS', salonTypeConfirmed: true, ...over,
});

describe('discovery URL rules', () => {
  const p = (q) => new URLSearchParams(q);

  it('reads filters from the URL and defaults sort sensibly', () => {
    expect(readDiscoveryState(p('salonType=LADIES&popularService=facial&priceMin=200'))).toMatchObject({
      salonType: 'LADIES', popularService: 'facial', priceMin: 200, priceMax: null, sort: 'relevance',
    });
    expect(readDiscoveryState(p('lat=1&lng=2')).sort).toBe('distance');
    expect(readDiscoveryState(p('salonType=OTHER&popularService=nope')).salonType).toBeNull();
    expect(readDiscoveryState(p('popularService=nope')).popularService).toBeNull();
  });

  it('disables price sort until a service is selected, and never sends it without one', () => {
    expect(sortUnavailableReason('price', { popularService: null, legacyService: null })).toBe('Select a service first to sort by price.');
    expect(sortUnavailableReason('price', { popularService: 'haircut', legacyService: null })).toBeNull();
    expect(searchApiQuery(p('sort=price&salonType=GENTS'))).toBe('salonType=GENTS');
    expect(searchApiQuery(p('sort=price&popularService=haircut&view=compare'))).toBe('popularService=haircut&sort=price');
  });

  it('resets the price range (and a now-impossible price sort) when the compared service changes', () => {
    expect(popularServiceChange(p('popularService=haircut&priceMin=100&priceMax=300&sort=price'), 'facial')).toEqual({ popularService: 'facial', priceMin: null, priceMax: null });
    expect(popularServiceChange(p('popularService=haircut&sort=price'), null)).toEqual({ popularService: null, priceMin: null, priceMax: null, sort: null });
  });

  it('treats the slider ends as "no limit" and counts active filters', () => {
    expect(priceRangeChange(0, 2000)).toEqual({ priceMin: null, priceMax: null });
    expect(priceRangeChange(100, 300)).toEqual({ priceMin: '100', priceMax: '300' });
    expect(activeFilterCount(readDiscoveryState(p('salonType=GENTS&popularService=haircut&priceMax=300')))).toBe(3);
  });

  it('reads rating, open-now and favorites filters; sends saved IDs only for favorites', () => {
    const state = readDiscoveryState(p('minRating=4&openNow=true&favorites=1'));
    expect(state).toMatchObject({ minRating: 4, openNow: true, favoritesOnly: true });
    expect(activeFilterCount(state)).toBe(3);
    expect(readDiscoveryState(p('minRating=2.2')).minRating).toBeNull();
    expect(searchApiQuery(p('minRating=4&openNow=true&favorites=1'), ['a', 'b'])).toBe('minRating=4&openNow=true&ids=a%2Cb');
    expect(searchApiQuery(p('minRating=4'), ['a'])).toBe('minRating=4');
  });
});

describe('filter controls', () => {
  const state = (q) => readDiscoveryState(new URLSearchParams(q));

  it('disables the price slider until a service is chosen', () => {
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('')} onChange={jest.fn()} onClearAll={jest.fn()} activeCount={0} />); });
    const priceFieldset = tree.root.findAll((n) => n.type === 'fieldset').find((f) => textOf(f).startsWith('Price'));
    expect(priceFieldset.props.disabled).toBe(true);
    expect(textOf(priceFieldset)).toContain('Select a service to filter by price.');
  });

  it('salon type and popular services report their changes', () => {
    const onChange = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('popularService=haircut')} onChange={onChange} onClearAll={jest.fn()} activeCount={1} />); });
    act(() => tree.root.find((n) => n.props.role === 'radio' && textOf(n) === 'Female').props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ salonType: 'LADIES' });
    const haircut = tree.root.find((n) => n.type === 'button' && textOf(n) === 'Haircut');
    expect(haircut.props['aria-pressed']).toBe(true);
    act(() => haircut.props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ __popularService: null });
    const priceFieldset = tree.root.findAll((n) => n.type === 'fieldset').find((f) => textOf(f).startsWith('Price'));
    expect(priceFieldset.props.disabled).toBe(false);
    expect(textOf(priceFieldset)).toContain('for Haircut');
  });

  it('rating, open-now and favorites controls report their changes', () => {
    const onChange = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('openNow=true')} onChange={onChange} onClearAll={jest.fn()} activeCount={1} />); });
    act(() => tree.root.find((n) => n.props.role === 'radio' && n.props['aria-label'] === '4 stars and up').props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ minRating: '4' });
    const openNow = tree.root.find((n) => n.type === 'button' && textOf(n) === 'Open now');
    expect(openNow.props['aria-pressed']).toBe(true);
    act(() => openNow.props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ openNow: null });
    act(() => tree.root.find((n) => n.type === 'button' && textOf(n).includes('My favorites')).props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ favorites: '1' });
  });

  it('greys out price sort with a reason when no service is selected', () => {
    let tree;
    act(() => { tree = TestRenderer.create(<SortControl state={state('')} onChange={jest.fn()} />); });
    const price = tree.root.find((n) => n.type === 'option' && n.props.value === 'price');
    expect(price.props.disabled).toBe(true);
    expect(textOf(tree.root)).toContain('Select a service first to sort by price.');
  });
});

describe('cards, comparison and hearts', () => {
  beforeEach(() => {
    resetFavoritesForTests();
    push.mockReset();
    apiFetch.mockReset();
    globalThis.window = { location: { pathname: '/search', search: '?popularService=haircut' }, sessionStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; }, removeItem(k) { delete this.store[k]; } } };
  });
  afterEach(() => { delete globalThis.window; });

  it('shows the confirmed salon type, "Type not set" otherwise, and the selected service price', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => { tree = TestRenderer.create(<SalonCard salon={salon({ selectedService: { id: 'x', name: 'Classic Haircut', price: 180, durationMinutes: 30 } })} />); });
    expect(textOf(tree.root)).toContain('Male');
    expect(textOf(tree.root)).toContain('Classic Haircut ₹180');
    expect(textOf(tree.root)).not.toContain('From');
    act(() => { tree.update(<SalonCard salon={salon({ salonTypeConfirmed: false, salonType: 'UNISEX' })} />); });
    expect(textOf(tree.root)).toContain('Type not set');
    expect(textOf(tree.root)).toContain('From ₹99');
  });

  it('compares the same service across salons, and says when a salon does not offer it', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <CompareTable serviceLabel="Haircut" salons={[
          salon({ selectedService: { id: 'a', name: 'Haircut', price: 150, durationMinutes: 30 } }),
          salon({ id: 's2', name: 'Bravo', salonTypeConfirmed: false, ratingAverage: null, ratingCount: 0, distanceKm: null, selectedService: null }),
        ]} />,
      );
    });
    const rows = tree.root.findByType('tbody').findAllByType('tr').map(textOf);
    expect(rows[0]).toContain('₹150');
    expect(rows[0]).toContain('Book now');
    expect(rows[1]).toContain('Not on menu');
    expect(rows[1]).toContain('No reviews yet');
    expect(rows[1]).toContain('Not set');
  });

  it('a signed-out heart tap sends the customer to login and remembers the salon', async () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => { tree = TestRenderer.create(<SalonCard salon={salon()} />); });
    const heart = tree.root.find((n) => n.type === 'button' && n.props['aria-pressed'] !== undefined);
    expect(heart.props['aria-label']).toBe('Save Alpha Cuts to favorites');
    await act(async () => heart.props.onClick({ preventDefault() {}, stopPropagation() {} }));
    expect(push).toHaveBeenCalledWith('/login?next=%2Fsearch%3FpopularService%3Dhaircut');
    expect(window.sessionStorage.getItem('fastque.pendingFavorite')).toBe('s1');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a customer heart turns red at once and rolls back if the server refuses', async () => {
    useAuth.mockReturnValue({ user: { id: 'u1', roles: [Role.CUSTOMER] }, status: 'authenticated' });
    apiFetch.mockImplementation((path) => (path === 'favorites/ids' ? Promise.resolve({ salonIds: [] }) : Promise.reject(new Error('down'))));
    let tree;
    await act(async () => { tree = TestRenderer.create(<SalonCard salon={salon()} />); });
    const heart = () => tree.root.find((n) => n.type === 'button' && n.props['aria-pressed'] !== undefined);
    expect(heart().props['aria-pressed']).toBe(false);
    await act(async () => heart().props.onClick({ preventDefault() {}, stopPropagation() {} }));
    expect(apiFetch).toHaveBeenCalledWith('favorites/s1', { method: 'POST' });
    expect(heart().props['aria-pressed']).toBe(false); // rolled back
    expect(heart().props.title).toContain('Couldn’t update');
  });

  it('saves the remembered salon after the customer signs in', async () => {
    window.sessionStorage.setItem('fastque.pendingFavorite', 's1');
    useAuth.mockReturnValue({ user: { id: 'u1', roles: [Role.CUSTOMER] }, status: 'authenticated' });
    apiFetch.mockImplementation((path) => Promise.resolve(path === 'favorites/ids' ? { salonIds: [] } : { salonId: 's1', favorited: true }));
    function Probe() { const { isFavorite } = useFavorites(); return <span>{String(isFavorite('s1'))}</span>; }
    let tree;
    await act(async () => { tree = TestRenderer.create(<Probe />); });
    await act(async () => {});
    expect(apiFetch).toHaveBeenCalledWith('favorites/s1', { method: 'POST' });
    expect(textOf(tree.root)).toBe('true');
    expect(window.sessionStorage.getItem('fastque.pendingFavorite')).toBeNull();
  });

  it('orders the favorites page', () => {
    const items = [
      { name: 'B', ratingAverage: 4.1, ratingCount: 3, favoritedAt: '2026-10-25T00:00:00Z' },
      { name: 'A', ratingAverage: null, ratingCount: 0, favoritedAt: '2026-10-27T00:00:00Z' },
      { name: 'C', ratingAverage: 4.9, ratingCount: 1, favoritedAt: '2026-10-26T00:00:00Z' },
    ];
    expect(sortFavorites(items, 'recent').map((i) => i.name)).toEqual(['A', 'C', 'B']);
    expect(sortFavorites(items, 'rating').map((i) => i.name)).toEqual(['C', 'B', 'A']);
    expect(sortFavorites(items, 'name').map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });
});
