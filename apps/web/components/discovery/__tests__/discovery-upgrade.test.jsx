import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { Role } from '@barbercue/shared';
import {
  activeFilterCount,
  popularServiceChange,
  priceRangeChange,
  readDiscoveryState,
  searchApiQuery,
  sortsByStartingPrice,
} from '../../../lib/discovery-params';
import { resetFavoritesForTests, sortFavorites, useFavorites } from '../../../lib/favorites';
import { CompareTable, FiltersPanel, SortControl } from '../DiscoveryFilters';
import { SalonCard } from '../SalonCard';
import { SalonResultCard, clockText, salonStatus } from '../SalonResultCard';
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

  it('price sorts work without a service (by starting price) and are always sent', () => {
    expect(sortsByStartingPrice('price', { popularService: null, legacyService: null })).toBe(true);
    expect(sortsByStartingPrice('price', { popularService: 'haircut', legacyService: null })).toBe(false);
    expect(sortsByStartingPrice('rating', { popularService: null, legacyService: null })).toBe(false);
    expect(searchApiQuery(p('sort=price&salonType=GENTS'))).toBe('salonType=GENTS&sort=price');
    expect(searchApiQuery(p('sort=price&popularService=haircut&view=compare'))).toBe('popularService=haircut&sort=price');
  });

  it('keeps an any-service range when a first service is picked', () => {
    expect(popularServiceChange(p('priceMax=500'), 'haircut')).toEqual({ popularService: 'haircut' });
  });

  it('resets the price range when the compared service changes, and keeps a price sort', () => {
    expect(popularServiceChange(p('popularService=haircut&priceMin=100&priceMax=300&sort=price'), 'facial')).toEqual({ popularService: 'facial', priceMin: null, priceMax: null });
    expect(popularServiceChange(p('popularService=haircut&sort=price'), null)).toEqual({ popularService: null, priceMin: null, priceMax: null });
  });

  it('offers only and every service-price sort follow the same URL rules', () => {
    expect(readDiscoveryState(p('offersOnly=true')).offersOnly).toBe(true);
    expect(searchApiQuery(p('offersOnly=true&sort=price_desc'))).toBe('sort=price_desc&offersOnly=true');
    expect(searchApiQuery(p('popularService=facial&sort=effective_price'))).toBe('popularService=facial&sort=effective_price');
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

  it('the price slider works without a service, for salons with any service in range', () => {
    const onChange = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('')} onChange={onChange} onClearAll={jest.fn()} activeCount={0} />); });
    const priceFieldset = tree.root.findAll((n) => n.type === 'fieldset').find((f) => textOf(f).startsWith('Price'));
    expect(priceFieldset.props.disabled).toBeUndefined();
    expect(textOf(priceFieldset)).toContain('(any service)');
    expect(textOf(priceFieldset)).toContain('Salons with at least one service in this range.');
    const max = priceFieldset.findAll((n) => n.type === 'input' && n.props['aria-label'] === 'Maximum price')[0];
    act(() => max.props.onChange({ target: { value: '500' } }));
    act(() => max.props.onPointerUp());
    expect(onChange).toHaveBeenLastCalledWith({ priceMin: null, priceMax: '500' });
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
    expect(priceFieldset.props.disabled).toBeUndefined();
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

  it('live queue filter: any, available now, or within 15/30/60 minutes', () => {
    const onChange = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('maxWaitMinutes=15')} onChange={onChange} onClearAll={jest.fn()} activeCount={1} />); });
    const radios = tree.root.find((n) => n.props.role === 'radiogroup' && n.props['aria-label'] === 'Live queue wait').findAll((n) => n.type === 'button');
    expect(radios.map((r) => textOf(r))).toEqual(['Any', 'Available now', 'Within 15 min', 'Within 30 min', 'Within 60 min']);
    expect(radios[2].props['aria-checked']).toBe(true);
    act(() => radios[1].props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ maxWaitMinutes: '0' });
    act(() => radios[0].props.onClick());
    expect(onChange).toHaveBeenLastCalledWith({ maxWaitMinutes: null });
    expect(readDiscoveryState(new URLSearchParams('maxWaitMinutes=7')).maxWait).toBeNull();
    expect(searchApiQuery(new URLSearchParams('maxWaitMinutes=0&sort=wait'))).toBe('sort=wait&maxWaitMinutes=0');
  });

  it('distance is a slider like price: 1–20 km, far end = any distance, applied on release', () => {
    const onRadius = jest.fn();
    const onNearMe = jest.fn();
    let tree;
    act(() => { tree = TestRenderer.create(<FiltersPanel state={state('')} onChange={jest.fn()} onClearAll={jest.fn()} activeCount={0} location={{ nearMe: false, radiusKm: null, locating: false, onRadius, onNearMe }} />); });
    const slider = () => tree.root.find((n) => n.type === 'input' && n.props['aria-label'] === 'Distance');
    expect(slider().props).toMatchObject({ type: 'range', min: 1, max: 21, value: 21 });
    expect(textOf(tree.root)).toContain('Any distance');
    act(() => slider().props.onChange({ target: { value: '7' } }));
    expect(textOf(tree.root)).toContain('Within 7 km');
    expect(onRadius).not.toHaveBeenCalled(); // only on release
    act(() => slider().props.onPointerUp());
    expect(onRadius).toHaveBeenCalledWith(7);
    // The page puts the new radius in the URL and passes it back down.
    act(() => { tree.update(<FiltersPanel state={state('')} onChange={jest.fn()} onClearAll={jest.fn()} activeCount={0} location={{ nearMe: true, radiusKm: 7, locating: false, onRadius, onNearMe }} />); });
    act(() => slider().props.onChange({ target: { value: '21' } }));
    act(() => slider().props.onBlur());
    expect(onRadius).toHaveBeenLastCalledWith(null);
    act(() => tree.root.find((n) => n.type === 'label' && textOf(n).startsWith('Near me')).findByType('input').props.onChange({ target: { checked: true } }));
    expect(onNearMe).toHaveBeenCalledWith(true);
  });

  it('every sort can be chosen; price sorts say "starting price" until a service is picked', () => {
    let tree;
    act(() => { tree = TestRenderer.create(<SortControl state={state('')} onChange={jest.fn()} />); });
    const options = tree.root.findAll((n) => n.type === 'option');
    expect(options.every((o) => !o.props.disabled)).toBe(true);
    expect(textOf(options.find((o) => o.props.value === 'price_desc'))).toBe('Price — high to low (starting price)');
    act(() => { tree.update(<SortControl state={state('popularService=haircut')} onChange={jest.fn()} />); });
    expect(textOf(tree.root.find((n) => n.type === 'option' && n.props.value === 'price_desc'))).toBe('Price — high to low');
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
    act(() => { tree.update(<SalonResultCard salon={beardSalon({ offers: [offer(), offer({ id: 'o2', title: 'Flat deal', discountType: 'FLAT', discountValue: 50, appliesTo: null, price: null })], offerHeadline: { count: 2, maxPercent: 20, maxSaving: 50 } })} />); });
    const box = tree.root.find((n) => n.type === 'button' && (n.props['aria-label'] ?? '').startsWith('2 offers'));
    expect(textOf(box)).toContain('2 offers at this salon');
    expect(textOf(box)).toContain('Up to 20% OFF');
    expect(textOf(box)).toContain('Save up to ₹50 on a service');
    expect(textOf(tree.root.find((n) => n.type === 'span' && n.props.className === 'offerBadge'))).toBe('Up to 20% OFF');
    act(() => box.props.onClick());
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

  it('open shows only the closing time; closed shows only when it next opens', () => {
    expect(salonStatus(salon({ isOpenNow: true, closesAt: '21:00' }))).toMatchObject({ tone: 'open', label: 'Open now', detail: 'Closes 9:00 PM' });
    expect(salonStatus(salon({ isOpenNow: false, opensNext: { inDays: 0, dayOfWeek: 2, time: '10:00' } }))).toMatchObject({ tone: 'closed', label: 'Closed', detail: 'Opens 10:00 AM' });
    expect(salonStatus(salon({ isOpenNow: false, opensNext: { inDays: 1, dayOfWeek: 3, time: '09:30' } })).text).toBe('Closed · Opens tomorrow 9:30 AM');
    expect(salonStatus(salon({ isOpenNow: false, opensNext: { inDays: 3, dayOfWeek: 1, time: '10:00' } })).detail).toBe('Opens Mon 10:00 AM');
    expect(salonStatus(salon({ isOpenNow: null }))).toMatchObject({ tone: 'unknown', label: 'Hours not listed', detail: null });
  });

  it('the cover photo opens the photo viewer too', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    globalThis.document = { addEventListener() {}, removeEventListener() {}, body: { style: {} }, activeElement: null };
    try {
      let tree;
      act(() => { tree = TestRenderer.create(<SalonResultCard salon={beardSalon({ photoUrls: ['cover.jpg', 'g1.jpg'] })} />); });
      const cover = tree.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'View Alpha Cuts photos (2)');
      act(() => cover.props.onClick({ currentTarget: { focus() {} } }));
      expect(tree.root.find((n) => n.props.role === 'dialog').findByType('img').props.src).toBe('cover.jpg');
    } finally {
      delete globalThis.document;
    }
  });

  it('gallery thumbnails open the photo viewer at that photo', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    globalThis.document = { addEventListener() {}, removeEventListener() {}, body: { style: {} }, activeElement: null };
    try {
      let tree;
      act(() => { tree = TestRenderer.create(<SalonResultCard salon={beardSalon({ photoUrls: ['c.jpg', 'g1.jpg', 'g2.jpg', 'g3.jpg', 'g4.jpg', 'g5.jpg'] })} />); });
      const thumbs = tree.root.findAll((n) => n.type === 'button' && /^View (photo|all)/.test(n.props['aria-label'] ?? ''));
      expect(thumbs.map((t) => t.props['aria-label'])).toEqual(['View photo 2 of 6', 'View photo 3 of 6', 'View photo 4 of 6', 'View all 6 photos']);
      const opener = { focus: jest.fn() };
      act(() => thumbs[1].props.onClick({ currentTarget: opener }));
      const viewer = tree.root.find((n) => n.props.role === 'dialog' && n.props['aria-modal'] === 'true');
      expect(viewer.props['aria-label']).toBe('Alpha Cuts — photo 3 of 6');
      expect(viewer.findByType('img').props.src).toBe('g2.jpg');
      act(() => viewer.props.onClick());
      expect(tree.root.findAll((n) => n.props.role === 'dialog')).toHaveLength(0);
      expect(opener.focus).toHaveBeenCalled(); // focus goes back to the thumbnail
    } finally {
      delete globalThis.document;
    }
  });

  it('Join Queue sits beside Book Now with the live ETA; closed salons say the queue is closed', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => { tree = TestRenderer.create(<SalonResultCard salon={beardSalon({ isOpenNow: true, queueWait: { waitingCount: 3, estimatedWaitMinutes: 25, range: { min: 19, max: 31 } } })} />); });
    const join = tree.root.find((n) => n.type === 'a' && textOf(n).startsWith('Join Queue'));
    expect(join.props.href).toBe('/queue/alpha?city=pune&country=IN');
    expect(textOf(join)).toBe('Join Queue~25 min wait');
    const joinLink = tree.root.find((n) => n.type !== 'a' && typeof n.props.href === 'string' && n.props.href.startsWith('/queue/'));
    expect(joinLink.props['aria-label']).toBe('Join the live queue — ~25 min wait, 3 in queue');
    act(() => { tree.update(<SalonResultCard salon={beardSalon({ isOpenNow: true, queueWait: { waitingCount: 0, estimatedWaitMinutes: 0, range: { min: 0, max: 5 } } })} />); });
    expect(textOf(tree.root)).toContain('Join QueueNo wait');
    act(() => { tree.update(<SalonResultCard salon={beardSalon({ isOpenNow: false, queueWait: null })} />); });
    expect(textOf(tree.root)).toContain('Queue closed');
    expect(tree.root.findAll((n) => n.type === 'a' && textOf(n).startsWith('Join Queue'))).toHaveLength(0);
  });

  it('every listed service shows its own best discount; only flat offers → Up to ₹ OFF', () => {
    useAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
    let tree;
    act(() => {
      tree = TestRenderer.create(<SalonResultCard salon={beardSalon({
        offers: [offer({ discountType: 'FLAT', discountValue: 100, price: null, conditional: false }), offer({ id: 'o2', discountType: 'FLAT', discountValue: 40 })],
        offerHeadline: { count: 2, maxPercent: null, maxSaving: 100 },
        serviceOffers: [{ serviceId: 'beard', offerId: 'o2', offerPrice: 210, saving: 40 }, { serviceId: 'cut', offerId: 'o1', offerPrice: 200, saving: 100 }],
      })} />);
    });
    const text = textOf(tree.root);
    expect(text).toContain('Beard Styling₹250 ₹210');
    expect(text).toContain('Haircut₹300 ₹200');
    expect(text).toContain('Shaving₹150');
    expect(text).toContain('Up to ₹100 OFF');
    // Book Now carries the best offer for the selected service.
    expect(tree.root.find((n) => n.type === 'a' && textOf(n) === 'Book Now').props.href).toContain('offer=o2');
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
