import React, { act } from 'react';
import { webcrypto } from 'crypto';
import TestRenderer from 'react-test-renderer';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { bag, wishlist, locationQuery } from '../../../lib/shop/store';
import { ProductCard } from '../ShopParts';
import { ShopCheckout } from '../ShopCheckout';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  usePathname: () => '/shop',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, className, style }) => <a href={href} className={className} style={style}>{children}</a> }));
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../../../lib/auth-context', () => ({ useAuth: jest.fn() }));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const line = (over = {}) => ({ listingId: 'l1', productId: 'p1', salonId: 's1', salonName: 'Alpha Salon', name: 'Daily Shampoo', brand: 'Studio', variant: '100 ml', category: 'Hair Care', quantity: 1, price: '199.00', ...over });

// Jest runs in "node": give the store a minimal window + localStorage.
const memory = new Map();
globalThis.window = {
  localStorage: { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k), clear: () => memory.clear() },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  confirm: () => true,
};

beforeEach(() => {
  window.localStorage.clear();
  apiFetch.mockReset();
  push.mockReset();
  useAuth.mockReturnValue({ user: null });
  globalThis.crypto ??= webcrypto;
});

describe('bag store', () => {
  it('keeps one salon per bag, merges quantities, caps and removes', () => {
    expect(bag.add(line())).toBe('added');
    expect(bag.add(line({ quantity: 2 }))).toBe('added');
    expect(bag.get()).toHaveLength(1);
    expect(bag.get()[0].quantity).toBe(3);
    expect(bag.add(line({ listingId: 'l9', salonId: 's2' }))).toBe('other-salon');
    expect(bag.get()).toHaveLength(1);
    bag.setQuantity('l1', 99);
    expect(bag.get()[0].quantity).toBe(50);
    bag.setQuantity('l1', 0);
    expect(bag.get()).toEqual([]);
  });
  it('wishlist toggles and location becomes query params', () => {
    expect(wishlist.toggle('p1')).toBe(true);
    expect(wishlist.toggle('p1')).toBe(false);
    expect(locationQuery({ lat: 21.851234, lng: 84.0, label: 'Near me' })).toBe('lat=21.8512&lng=84.0000');
    expect(locationQuery({ citySlug: 'jharsuguda', label: 'Jharsuguda' })).toBe('city=jharsuguda');
    expect(locationQuery(null)).toBe('');
  });
});

describe('product card', () => {
  const card = { id: 'p1', name: 'Daily Shampoo', brand: 'Studio', category: 'Hair Care', variant: '100 ml', imageUrl: null, isTestData: true, barcode: '2000000000015', mrp: null, fromPrice: '525.00', compareAtPrice: null, discountPercent: null, maxDiscountPercent: 8, sellerCount: 2, inStock: true, nearestKm: 1.2 };
  it('shows the lowest salon price, seller count, offer and the test-data label', () => {
    let tree;
    act(() => { tree = TestRenderer.create(<ProductCard product={card} />); });
    const text = textOf(tree.toJSON());
    expect(text).toContain('from ₹525');
    expect(text).toContain('Up to 8% off');
    expect(text).toContain('2 salons · 1.2 km');
    expect(text).toContain('Sample product');
  });
  it('says honestly when no salon sells it yet', () => {
    let tree;
    act(() => { tree = TestRenderer.create(<ProductCard product={{ ...card, fromPrice: null, inStock: false, sellerCount: 0, isTestData: false }} />); });
    expect(textOf(tree.toJSON())).toContain('Not sold nearby yet');
  });
});

describe('checkout', () => {
  it('places a guest order with the server total and an idempotency key, then clears the bag', async () => {
    bag.add(line({ quantity: 2 }));
    const quote = { salon: { id: 's1', name: 'Alpha Salon', address: 'MG Road', city: 'Jharsuguda' }, lines: [{ listingId: 'l1', productId: 'p1', quantity: 2, unitPrice: '199.00', lineTotal: '398.00', availableQuantity: 5, maxPerOrder: 5, problem: null }], subtotal: '398.00', discountTotal: '0.00', savings: '0.00', total: '398.00', currency: 'INR', blocking: [] };
    apiFetch.mockImplementation((path) =>
      Promise.resolve(path === 'shop/cart/quote' ? quote : { order: { orderNumber: 'FQS-ABCDEF0123', placedAt: '2026-11-17T10:00:00Z' }, accessToken: 'tok_abcdefghijklmnopqrstuvwxyz', created: true }),
    );
    let tree;
    await act(async () => { tree = TestRenderer.create(<ShopCheckout />); });
    const inputs = tree.root.findAll((n) => n.type === 'input');
    act(() => inputs[0].props.onChange({ target: { value: 'Asha' } }));
    act(() => inputs[1].props.onChange({ target: { value: '+91 98765 43210' } }));
    await act(async () => tree.root.find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} }));
    const call = apiFetch.mock.calls.find(([p]) => p === 'shop/orders');
    expect(call[1].headers['Idempotency-Key']).toMatch(/^shop-[0-9a-f]{32}$/);
    expect(JSON.parse(call[1].body)).toMatchObject({ expectedTotal: '398.00', paymentMethod: 'PAY_AT_SALON', fulfillment: 'PICKUP', items: [{ listingId: 'l1', quantity: 2 }] });
    expect(push).toHaveBeenCalledWith('/shop/orders/FQS-ABCDEF0123?t=tok_abcdefghijklmnopqrstuvwxyz&new=1');
    expect(bag.get()).toEqual([]);
  });

  it('blocks checkout when the server says the bag cannot be bought', async () => {
    bag.add(line());
    apiFetch.mockResolvedValue({ salon: null, lines: [], subtotal: '0.00', discountTotal: '0.00', savings: '0.00', total: '0.00', currency: 'INR', blocking: ['Daily Shampoo: Out of stock at this salon.'] });
    let tree;
    await act(async () => { tree = TestRenderer.create(<ShopCheckout />); });
    expect(textOf(tree.toJSON())).toContain('Out of stock at this salon.');
    expect(tree.root.find((n) => n.type === 'button' && n.props.type === 'submit').props.disabled).toBe(true);
  });
});
