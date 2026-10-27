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
import { SalonResultCard, clockText } from '../SalonResultCard';
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

  it('offers only and every service-price sort follow the same URL rules', () => {
    expect(readDiscoveryState(p('offersOnly=true')).offersOnly).toBe(true);
    expect(searchApiQuery(p('offersOnly=true&sort=price_desc'))).toBe('offersOnly=true');
    expect(searchApiQuery(p('popularService=facial&sort=effective_price'))).toBe('popularService=facial&sort=effective_price');
    expect(popularServiceChange(p('popularService=facial&sort=price_desc'), null)).toMatchObject({ sort: null });
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

  it('open now, offers only, top rated and favorites checkboxes report their changes', () => {
    const onChange = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('openNow=true&popularService=beard-styling')} onChange={onChange} onClearAll={jest.fn()} activeCount={1} />); });
    const box = (label) => tree.root.find((n) => n.type === 'label' && textOf(n).startsWith(label)).findByType('input');
    expect(box('Open now only').props.checked).toBe(true);
    act(() => box('Open now only').props.onChange({ target: { checked: false } }));
    expect(onChange).toHaveBeenLastCalledWith({ openNow: null });
    act(() => box('Offers only').props.onChange({ target: { checked: true } }));
    expect(onChange).toHaveBeenLastCalledWith({ offersOnly: 'true' });
    expect(textOf(tree.root)).toContain('Offers that cover beard styling');
    act(() => box('Top rated (4.0+)').props.onChange({ target: { checked: true } }));
    expect(onChange).toHaveBeenLastCalledWith({ minRating: '4' });
    act(() => box('My favorites').props.onChange({ target: { checked: true } }));
    expect(onChange).toHaveBeenLastCalledWith({ favorites: '1' });
  });

  it('distance needs location: picking a distance or Near me goes through the page', () => {
    const onRadius = jest.fn();
    const onNearMe = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('')} onChange={jest.fn()} onClearAll={jest.fn()} activeCount={0} location={{ nearMe: false, radiusKm: null, locating: false, onRadius, onNearMe }} />); });
    const select = tree.root.find((n) => n.type === 'select' && n.props['aria-label'] === 'Distance');
    expect(select.findAllByType('option').map((o) => textOf(o))).toEqual(['Any distance', 'Within 1 km', 'Within 3 km', 'Within 5 km', 'Within 10 km', 'Within 20 km']);
    act(() => select.props.onChange({ target: { value: '5' } }));
    expect(onRadius).toHaveBeenCalledWith(5);
    act(() => tree.root.find((n) => n.type === 'label' && textOf(n).startsWith('Near me')).findByType('input').props.onChange({ target: { checked: true } }));
    expect(onNearMe).toHaveBeenCalledWith(true);
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

  const offer = (over = {}) => ({
    id: 'o1', title: 'Special Offer', description: null, discountType: 'PERCENT', discountValue: 20,
    validTo: '2026-11-30T00:00:00.000Z', audience: 'ALL', schedule: null, minimumBookingAmount: null,
    maximumDiscountAmount: null, appliesTo: 'Beard Styling', conditional: false, saving: 50,
    price: { serviceId: 'beard', serviceName: 'Beard Styling', originalPrice: 250, offerPrice: 200 }, ...over,
  });
  const beardSalon = (over = {}) => salon({
    selectedService: { id: 'beard', name: 'Beard Styling', price: 250, durationMinutes: 20 },
    otherServices: [{ id: 'cut', name: 'Haircut', price: 300 }, { id: 'shave', name: 'Shaving', price: 150 }],
    serviceCount: 6, closesAt: '22:00', photoUrls: ['a.jpg', 'b.jpg', 'c.jpg'], offers: [offer()], ...over,
  });

  it('result card: certain offer shows the struck-through and offer price, and Book Now carries the offer', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => { tree = TestRenderer.create(<SalonResultCard salon={beardSalon()} />); });
    const text = textOf(tree.root);
    expect(text).toContain('20% OFF on Beard Styling');
    expect(text).toContain('Beard Styling₹250 ₹200');
    expect(text).toContain('Haircut₹300');
    expect(text).toContain('Open now · Closes 10:00 PM');
    expect(text).toContain('View all services (3 more)');
    expect(text).toContain('1/3');
    const book = tree.root.find((n) => n.type === 'a' && textOf(n) === 'Book Now');
    expect(book.props.href).toBe('/book/alpha?city=pune&country=IN&offer=o1');
  });

  it('result card: a conditional offer never shows a discounted price, and terms are spelled out', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => {
      tree = TestRenderer.create(<SalonResultCard salon={beardSalon({ offers: [offer({ audience: 'NEW', conditional: true, price: null, schedule: 'Mon–Fri, 14:00–17:00', minimumBookingAmount: 500 })] })} />);
    });
    const text = textOf(tree.root);
    expect(text).toContain('Beard Styling₹250');
    expect(text).not.toContain('₹200');
    expect(text).toContain('First visit only · Mon–Fri, 14:00–17:00 · On bookings above ₹500');
    expect(text).toContain('Offer may apply at booking');
  });

  it('result card: no offer means no offer box, and View all offers opens the list', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => { tree = TestRenderer.create(<SalonResultCard salon={beardSalon({ offers: [] })} />); });
    expect(textOf(tree.root)).not.toContain('Valid till');
    act(() => { tree.update(<SalonResultCard salon={beardSalon({ offers: [offer(), offer({ id: 'o2', title: 'Flat deal', discountType: 'FLAT', discountValue: 50, appliesTo: null, price: null })] })} />); });
    act(() => tree.root.find((n) => n.type === 'button' && textOf(n) === 'View all 2 offers').props.onClick());
    const dialog = tree.root.find((n) => n.props.role === 'dialog');
    expect(textOf(dialog)).toContain('Flat ₹50 OFF Flat deal');
    expect(textOf(dialog)).toContain('On all services');
  });

  it('compare table shows the offer and what you pay only when certain', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => {
      tree = TestRenderer.create(<CompareTable serviceLabel="Beard Styling" salons={[beardSalon(), beardSalon({ id: 's2', offers: [offer({ conditional: true, price: null })] })]} />);
    });
    const rows = tree.root.findByType('tbody').findAllByType('tr').map(textOf);
    expect(rows[0]).toContain('20% OFF');
    expect(rows[0]).toContain('₹200');
    expect(rows[1]).toContain('Conditions apply');
    expect(rows[1]).toContain('Offer checked at booking');
    expect(rows[1]).not.toContain('₹200');
    expect(clockText('09:30')).toBe('9:30 AM');
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
