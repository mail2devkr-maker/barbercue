/// <reference types="jest" />
import { act, createElement } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { OfferDto, OfferPreviewDto, OfferRedemptionStatsDto, SalonServiceDto, SalonTimezoneResultDto } from '@barbercue/shared';
import OwnerOffersScreen from '../OwnerOffersScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'owner-offer-test-key' }));
let mockSelectedShopId = 'salon-1';
let mockPreviewMode: 'immediate' | 'deferred' = 'immediate';
let mockResolvePreview: ((value: OfferPreviewDto) => void) | undefined;
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: mockSelectedShopId, selectedSalon: { id: mockSelectedShopId, name: 'Synthetic shop' } }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]) }));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { View: NativeView, Text: NativeText } = require('react-native');
  return {
    InlineError: ({ message }: any) => el(NativeText, null, message),
    PremiumCard: ({ children }: any) => el(NativeView, null, children),
    PremiumScreen: ({ children }: any) => el(NativeView, null, children),
    PremiumSectionHeader: ({ title, subtitle }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, subtitle)),
  };
});

const services: SalonServiceDto[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Haircut', description: null, durationMinutes: 30, price: 300, category: 'Hair', isActive: true, currency: 'INR' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Beard trim', description: null, durationMinutes: 20, price: 200, category: 'Hair', isActive: true, currency: 'INR' },
];
const offer: OfferDto = {
  id: 'offer-1', salonId: 'salon-1', kind: 'OFFER', status: 'DRAFT', title: 'Weekday offer', description: null,
  discountType: 'PERCENT', discountValue: 20, currency: 'INR', audience: 'ALL', inactiveDays: null,
  validFrom: '2026-10-28T03:30:00.000Z', validTo: '2026-10-30T03:30:00.000Z', maxRedemptions: 20,
  perCustomerLimit: 1, serviceIds: ['00000000-0000-4000-8000-000000000001'], redemptionCount: 0,
  createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
};
const preview: OfferPreviewDto = {
  offerId: null, currency: 'INR', eligibleByRule: null, eligibilityRule: 'ALL',
  lines: [{ serviceId: '00000000-0000-4000-8000-000000000001', serviceName: 'Haircut', basePrice: 300, discount: 60, finalPrice: 240, currency: 'INR' }],
  subtotal: 300, discount: 60, finalTotal: 240,
};
const stats: OfferRedemptionStatsDto = {
  offerId: 'offer-1', redemptionCount: 2, uniqueCustomers: 2, completedBookings: 1,
  cancelledBookings: 1, recordedDiscount: 60, currency: 'INR',
};
const timezone: SalonTimezoneResultDto = {
  id: 'salon-1', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true,
  timezoneManuallyOverridden: false, suggestion: null,
};

let tree: ReturnType<typeof TestRenderer.create>;
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

function visibleText(): string {
  return tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount() {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerOffersScreen, {} as never)); await flushEffects(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedShopId = 'salon-1';
  mockPreviewMode = 'immediate';
  mockResolvePreview = undefined;
  (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/timezone')) return timezone;
    if (path.endsWith('/services')) return services;
    if (path.includes('/offers?')) return { items: [offer], nextCursor: null };
    if (path.endsWith('/offers/preview')) {
      if (mockPreviewMode === 'deferred') return new Promise<OfferPreviewDto>((resolve) => { mockResolvePreview = resolve; });
      return preview;
    }
    if (path.endsWith('/offers/offer-1/stats')) return stats;
    return offer;
  });
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined as never;
});

it('loads owner offers, timezone and services using the selected salon scope', async () => {
  await mount();
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/offers?limit=25');
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/timezone');
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/services');
  expect(visibleText()).toContain('Weekday offer');
  expect(visibleText()).toContain('1 services');
  const edit = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Edit')[0];
  await act(async () => { edit.props.onPress(); await flushEffects(); });
  expect(visibleText()).toContain('Haircut');
});

it('previews then saves a salon-timezone validated draft using the authoritative API', async () => {
  await mount();
  const create = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Create draft'))[0];
  await act(async () => { create.props.onPress(); await flushEffects(); });
  const title = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Name');
  expect(title).toBeDefined();
  await act(async () => { title!.props.onChangeText('Synthetic weekday'); await flushEffects(); });
  const amount = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Discount value');
  await act(async () => { amount!.props.onChangeText('15'); await flushEffects(); });
  const previewButton = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Price preview')[0];
  await act(async () => { previewButton!.props.onPress(); await flushEffects(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/offers/preview', expect.objectContaining({ method: 'POST' }));
  expect(visibleText()).toContain('₹300 − ₹60 = ₹240');
  const save = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Save draft')[0];
  await act(async () => { save.props.onPress(); await flushEffects(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/offers', expect.objectContaining({
    method: 'POST',
    headers: { 'Idempotency-Key': 'owner-offer-test-key' },
    body: expect.stringContaining('Synthetic weekday'),
  }));
  expect(visibleText()).toContain('Draft saved. Customers cannot see it until it is published.');
});

it('discards a stale draft price preview after the offer fields change', async () => {
  await mount();
  const create = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Create draft'))[0];
  await act(async () => { create.props.onPress(); await flushEffects(); });
  const inputs = tree.root.findAllByType(TextInput);
  await act(async () => { inputs.find((input: any) => input.props.accessibilityLabel === 'Name')!.props.onChangeText('Synthetic weekday'); await flushEffects(); });
  await act(async () => { tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Discount value')!.props.onChangeText('15'); await flushEffects(); });
  mockPreviewMode = 'deferred';
  const previewButton = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Price preview')[0];
  await act(async () => { previewButton.props.onPress(); await Promise.resolve(); });
  expect(mockResolvePreview).toBeDefined();
  await act(async () => { tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Name')!.props.onChangeText('Changed after request'); await flushEffects(); });
  await act(async () => { mockResolvePreview!(preview); await flushEffects(); });
  expect(visibleText()).not.toContain('₹300 − ₹60 = ₹240');
  expect(tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Name')!.props.value).toBe('Changed after request');
});

it('saves an edited service subset after users add and remove service selections', async () => {
  await mount();
  const edit = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Edit')[0];
  await act(async () => { edit.props.onPress(); await flushEffects(); });
  const beard = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Beard trim'))[0];
  await act(async () => { beard.props.onPress(); await flushEffects(); });
  const haircut = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes('Haircut'))[0];
  await act(async () => { haircut.props.onPress(); await flushEffects(); });
  const save = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Save changes')[0];
  await act(async () => { save.props.onPress(); await flushEffects(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/offers/offer-1', expect.objectContaining({
    method: 'PATCH',
    body: expect.stringContaining('"serviceIds":["00000000-0000-4000-8000-000000000002"]'),
  }));
});

it('requires confirmation before publishing and displays server redemption statistics', async () => {
  await mount();
  const publish = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Publish')[0];
  await act(async () => { publish.props.onPress(); await flushEffects(); });
  expect(alertSpy).toHaveBeenCalledWith('Publish this offer?', expect.stringContaining('No payment is collected'), expect.any(Array));
  const confirm = alertSpy.mock.calls[0]?.[2]?.[1] as { onPress: () => void };
  await act(async () => { confirm.onPress(); await flushEffects(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/offers/offer-1/publish', expect.objectContaining({
    method: 'POST', headers: { 'Idempotency-Key': 'owner-offer-test-key' },
  }));
  const statsButton = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Redemption stats')[0];
  await act(async () => { statsButton.props.onPress(); await flushEffects(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/offers/offer-1/stats');
  expect(visibleText()).toContain('2 redemptions');
});
