/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { InventoryMovementDto, InventoryPageDto, InventoryProductDto, InventoryReportDto } from '@barbercue/shared';
import OwnerInventoryScreen from '../OwnerInventoryScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
let mockSelectedShop = { id: 'shop/id', name: 'Synthetic shop' };
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: mockSelectedShop.id, selectedSalon: mockSelectedShop }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));
jest.mock('../../../lib/date-locale', () => ({ dateLocaleFor: () => 'en-IN' }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]) }));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { Text: NativeText, View: NativeView, Pressable: NativePressable } = require('react-native');
  return {
    EmptyState: ({ title, message }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, message)),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    PremiumCard: ({ children }: any) => el(NativeView, null, children),
    PremiumScreen: ({ children }: any) => el(NativeView, null, children),
    PremiumSectionHeader: ({ title, subtitle }: any) => el(NativeView, null, el(NativeText, null, title), el(NativeText, null, subtitle)),
    Skeleton: () => null,
  };
});

const report = { productCount: 2, lowStockCount: 1, estimatedStockValue: '1250.00', valuationBasis: 'weighted-average-cost', currency: 'INR', movementCounts: { OPENING: 2, PURCHASE: 1, CONSUMPTION: 0, ADJUSTMENT: 0 }, lowStockProducts: [] } as InventoryReportDto;
const products = { items: [{ id: 'p1', salonId: 'shop/id', name: 'Shampoo', sku: 'SH-1', unit: 'EACH', stockOnHand: '3', averageUnitCost: '250', reorderThreshold: '5', isLowStock: true, isActive: true, category: { id: 'c1', name: 'Hair' }, supplier: null, updatedAt: '2026-10-27T00:00:00.000Z' }], nextCursor: null, hasMore: false } as InventoryPageDto<InventoryProductDto>;
const movements = { items: [{ id: 'm1', salonId: 'shop/id', productId: 'p1', productName: 'Shampoo', sku: 'SH-1', kind: 'PURCHASE', quantityDelta: '4', unitCost: '250', stockAfter: '3', averageUnitCostAfter: '250', supplier: null, actorUserId: 'actor', reason: null, reference: null, recordedAt: '2026-10-27T00:00:00.000Z' }], nextCursor: null, hasMore: false } as InventoryPageDto<InventoryMovementDto>;

let tree: ReturnType<typeof TestRenderer.create>;
const textOf = (instance: any): string => instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
const renderedText = () => tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ');

beforeEach(() => { mockSelectedShop = { id: 'shop/id', name: 'Synthetic shop' }; jest.clearAllMocks(); (apiFetch as jest.Mock).mockImplementation(async (path: string) => path.endsWith('/report') ? report : path.includes('/products?') ? products : movements); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('loads the selected shop report, products and history through salon-scoped routes', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/report');
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/products?limit=25');
  expect(renderedText()).toContain('Shampoo');
  expect(renderedText()).toContain('Low stock');
  expect(renderedText()).toContain('not revenue');
});

it('uses the backend low-stock filter when selected', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const low = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node).includes('Low stock'))[0];
  await act(async () => low.props.onPress());
  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/shop%2Fid/inventory/movements?limit=25');
  expect((apiFetch as jest.Mock).mock.calls.some(([path]) => path === 'dashboard/salons/shop%2Fid/inventory/products?limit=25&lowStock=true')).toBe(true);
});

it('does not render empty/fabricated stock figures when the report request fails', async () => {
  (apiFetch as jest.Mock).mockRejectedValue(new Error('unavailable'));
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  expect(renderedText()).toContain('Could not load inventory. Please try again.');
  expect(renderedText()).not.toContain('1,250');
});

it('follows independent product and movement cursors and de-duplicates overlapping pages', async () => {
  const secondProduct = { ...products.items[0], id: 'p2', name: 'Conditioner' };
  const secondMovement = { ...movements.items[0], id: 'm2', productId: 'p2', productName: 'Conditioner' };
  (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/report')) return report;
    if (path.includes('/products?')) {
      if (path.includes('cursor=products-cursor')) return { items: [products.items[0], secondProduct], nextCursor: null, hasMore: false };
      return { ...products, nextCursor: 'products-cursor', hasMore: true };
    }
    if (path.includes('cursor=movements-cursor')) return { items: [movements.items[0], secondMovement], nextCursor: null, hasMore: false };
    return { ...movements, nextCursor: 'movements-cursor', hasMore: true };
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });

  let moreButtons = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && textOf(node).includes('Load more'));
  expect(moreButtons).toHaveLength(2);
  await act(async () => { moreButtons[0].props.onPress(); await Promise.resolve(); });
  moreButtons = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && textOf(node).includes('Load more'));
  expect(moreButtons).toHaveLength(1);
  await act(async () => { moreButtons[0].props.onPress(); await Promise.resolve(); });

  const allText = renderedText();
  expect(allText.match(/Shampoo/g)).toHaveLength(2); // one product row and one movement row
  expect(allText.match(/Conditioner/g)).toHaveLength(2);
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/products?limit=25&cursor=products-cursor');
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/movements?limit=25&cursor=movements-cursor');
});

it('does not append an old shop page after the selected shop changes mid-request', async () => {
  let resolveOldPage!: (value: InventoryPageDto<InventoryProductDto>) => void;
  const oldPage = new Promise<InventoryPageDto<InventoryProductDto>>((resolve) => { resolveOldPage = resolve; });
  const oldProducts = { ...products, items: [{ ...products.items[0], id: 'old', name: 'Old shop product' }], nextCursor: 'old-cursor' };
  (apiFetch as jest.Mock).mockImplementation((path: string) => {
    if (path.endsWith('/report')) return Promise.resolve(report);
    if (path.includes('/movements?')) return Promise.resolve(movements);
    if (path.includes('old-cursor')) return oldPage;
    if (path.includes('/products?') && path.includes('shop%2Fid')) return Promise.resolve(oldProducts);
    if (path.includes('/products?') && path.includes('shop-2')) return Promise.resolve({ ...products, items: [{ ...products.items[0], id: 'new', name: 'New shop product' }], nextCursor: null });
    return Promise.resolve(products);
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const loadMore = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Load more'))[0];
  await act(async () => { loadMore.props.onPress(); await Promise.resolve(); });

  mockSelectedShop = { id: 'shop-2', name: 'Other synthetic shop' };
  await act(async () => { tree.update(createElement(OwnerInventoryScreen, {} as never)); await Promise.resolve(); });
  await act(async () => { resolveOldPage({ ...oldProducts, items: [{ ...products.items[0], id: 'old-next', name: 'Old shop next page' }], nextCursor: null }); await oldPage; });

  expect(renderedText()).toContain('New shop product');
  expect(renderedText()).not.toContain('Old shop next page');
});
