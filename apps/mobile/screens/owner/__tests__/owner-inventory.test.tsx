/// <reference types="jest" />
import { act, createElement } from 'react';
import { Alert, Text, TextInput } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { InventoryMovementDto, InventoryPageDto, InventoryProductDto, InventoryReportDto } from '@barbercue/shared';
import OwnerInventoryScreen from '../OwnerInventoryScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'synthetic-stock-movement-key' }));
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

it('records a purchase only after confirmation, with server idempotency and a refresh from the selected shop', async () => {
  (apiFetch as jest.Mock).mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') return { created: true, movement: movements.items[0] };
    if (path.endsWith('/report')) return report;
    if (path.includes('/products?')) return products;
    return movements;
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
    const record = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Record stock movement'))[0];
    await act(async () => record.props.onPress());
    const quantity = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Quantity');
    const cost = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Cost per unit');
    await act(async () => { quantity!.props.onChangeText('2'); cost!.props.onChangeText('125.50'); });
    const review = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Review movement')[0];
    await act(async () => review.props.onPress());

    expect(alert).toHaveBeenCalledWith('Confirm stock movement', expect.stringContaining('Shampoo'), expect.any(Array));
    expect(apiFetch).toHaveBeenCalledTimes(3);
    const confirm = alert.mock.calls[0]?.[2]?.[1] as { onPress: () => void };
    await act(async () => confirm.onPress());
    expect(apiFetch).toHaveBeenNthCalledWith(4, 'dashboard/salons/shop%2Fid/inventory/products/p1/movements', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-stock-movement-key' },
      body: JSON.stringify({ kind: 'PURCHASE', quantity: 2, unitCost: 125.5 }),
    });
    expect((apiFetch as jest.Mock).mock.calls.filter(([path]) => path.endsWith('/report'))).toHaveLength(2);
    expect(renderedText()).toContain('Stock movement recorded. Inventory refreshed.');
  } finally {
    alert.mockRestore();
  }
});

it('requires an adjustment reason and does not call the mutation API without one', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const record = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Record stock movement'))[0];
  await act(async () => record.props.onPress());
  const adjustment = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node) === 'Adjustment')[0];
  await act(async () => adjustment.props.onPress());
  const quantity = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Quantity');
  await act(async () => quantity!.props.onChangeText('1'));
  const review = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Review movement')[0];
  await act(async () => review.props.onPress());
  expect(renderedText()).toContain('A reason is required for stock adjustments');
  expect(apiFetch).toHaveBeenCalledTimes(3);
});

it('does not submit a confirmation that belongs to a shop scope which is no longer selected', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
    const record = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node).includes('Record stock movement'))[0];
    await act(async () => record.props.onPress());
    const quantity = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Quantity');
    const cost = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Cost per unit');
    await act(async () => { quantity!.props.onChangeText('2'); cost!.props.onChangeText('125.50'); });
    const review = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Review movement')[0];
    await act(async () => review.props.onPress());
    const confirm = alert.mock.calls[0]?.[2]?.[1] as { onPress: () => void };

    mockSelectedShop = { id: 'shop-2', name: 'Other synthetic shop' };
    await act(async () => { tree.update(createElement(OwnerInventoryScreen, {} as never)); await Promise.resolve(); });
    await act(async () => confirm.onPress());

    expect((apiFetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  } finally {
    alert.mockRestore();
  }
});

it('creates a product only through the selected salon API and refreshes server inventory', async () => {
  const category = { id: '11111111-1111-4111-8111-111111111111', salonId: 'shop/id', name: 'Synthetic supplies', createdAt: '2026-10-28T00:00:00.000Z' };
  const supplier = { id: '22222222-2222-4222-8222-222222222222', salonId: 'shop/id', name: 'Synthetic wholesaler', contactName: null, phone: null, email: null, notes: null, createdAt: '2026-10-28T00:00:00.000Z' };
  const createdProduct = { ...products.items[0], id: 'created-product', name: 'New Shampoo', sku: 'SH-NEW', stockOnHand: '0', category: { id: category.id, name: category.name }, supplier: { id: supplier.id, name: supplier.name } };
  (apiFetch as jest.Mock).mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') return createdProduct;
    if (path.endsWith('/report')) return report;
    if (path.includes('/categories?')) return { items: [category], nextCursor: null, hasMore: false };
    if (path.includes('/suppliers?')) return { items: [supplier], nextCursor: null, hasMore: false };
    if (path.includes('/products?')) return { items: [createdProduct], nextCursor: null, hasMore: false };
    return movements;
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const add = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Add product')[0];
  await act(async () => { add.props.onPress(); await Promise.resolve(); });
  const input = (label: string) => tree.root.findAllByType(TextInput).find((item: any) => item.props.accessibilityLabel === label);
  await act(async () => { input('Product name')!.props.onChangeText('New Shampoo'); input('SKU (optional)')!.props.onChangeText('sh-new'); input('Low-stock threshold')!.props.onChangeText('5'); });
  const categoryOption = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node) === 'Synthetic supplies')[0];
  const supplierOption = tree.root.findAll((node: any) => node.props.accessibilityRole === 'tab' && textOf(node) === 'Synthetic wholesaler')[0];
  await act(async () => { categoryOption.props.onPress(); supplierOption.props.onPress(); });
  const save = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Save')[0];
  await act(async () => { save.props.onPress(); await Promise.resolve(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'New Shampoo', sku: 'sh-new', unit: 'EACH', categoryId: category.id, supplierId: supplier.id, reorderThreshold: 5 }),
  });
  expect(renderedText()).toContain('Product created. Record opening stock to set its on-hand quantity.');
  expect(renderedText()).toContain('New Shampoo');
});

it('creates a category through the salon-scoped endpoint without assuming stock exists', async () => {
  const createdCategory = { id: '33333333-3333-4333-8333-333333333333', salonId: 'shop/id', name: 'Hair care', createdAt: '2026-10-28T00:00:00.000Z' };
  (apiFetch as jest.Mock).mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') return createdCategory;
    if (path.endsWith('/report')) return report;
    if (path.includes('/products?')) return products;
    return movements;
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const add = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Add category')[0];
  await act(async () => add.props.onPress());
  const name = tree.root.findAllByType(TextInput).find((item: any) => item.props.accessibilityLabel === 'Category');
  await act(async () => name!.props.onChangeText('Hair care'));
  const save = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Save')[0];
  await act(async () => { save.props.onPress(); await Promise.resolve(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/categories', { method: 'POST', body: JSON.stringify({ name: 'Hair care' }) });
  expect(renderedText()).toContain('Category created.');
});

it('validates supplier email and creates supplier records only after valid input', async () => {
  const createdSupplier = { id: '44444444-4444-4444-8444-444444444444', salonId: 'shop/id', name: 'Local supplier', contactName: 'Asha', phone: null, email: 'asha@example.test', notes: null, createdAt: '2026-10-28T00:00:00.000Z' };
  (apiFetch as jest.Mock).mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') return createdSupplier;
    if (path.endsWith('/report')) return report;
    if (path.includes('/products?')) return products;
    return movements;
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const add = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Add supplier')[0];
  await act(async () => add.props.onPress());
  const input = (label: string) => tree.root.findAllByType(TextInput).find((item: any) => item.props.accessibilityLabel === label);
  await act(async () => { input('Supplier')!.props.onChangeText('Local supplier'); input('Contact name (optional)')!.props.onChangeText('Asha'); input('Email (optional)')!.props.onChangeText('not-an-email'); });
  const save = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Save')[0];
  await act(async () => { save.props.onPress(); await Promise.resolve(); });
  expect((apiFetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  expect(renderedText()).toContain('Invalid email');

  await act(async () => input('Email (optional)')!.props.onChangeText('asha@example.test'));
  await act(async () => { save.props.onPress(); await Promise.resolve(); });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/suppliers', {
    method: 'POST', body: JSON.stringify({ name: 'Local supplier', contactName: 'Asha', phone: null, email: 'asha@example.test', notes: null }),
  });
  expect(renderedText()).toContain('Supplier created.');
});

it('discards category lookups from the previous salon after a shop switch', async () => {
  const oldCategory = { id: '55555555-5555-4555-8555-555555555555', salonId: 'shop/id', name: 'Old private category', createdAt: '2026-10-28T00:00:00.000Z' };
  const newCategory = { id: '66666666-6666-4666-8666-666666666666', salonId: 'shop-2', name: 'New shop category', createdAt: '2026-10-28T00:00:00.000Z' };
  let resolveOldCategories!: (value: InventoryPageDto<any>) => void;
  const oldCategories = new Promise<InventoryPageDto<any>>((resolve) => { resolveOldCategories = resolve; });
  (apiFetch as jest.Mock).mockImplementation((path: string) => {
    if (path.endsWith('/report')) return Promise.resolve(report);
    if (path.includes('/categories?') && path.includes('shop%2Fid')) return oldCategories;
    if (path.includes('/categories?') && path.includes('shop-2')) return Promise.resolve({ items: [newCategory], nextCursor: null, hasMore: false });
    if (path.includes('/suppliers?')) return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
    if (path.includes('/products?')) return Promise.resolve(products);
    return Promise.resolve(movements);
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const addProduct = () => tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Add product')[0];
  await act(async () => { addProduct().props.onPress(); await Promise.resolve(); });

  mockSelectedShop = { id: 'shop-2', name: 'Other synthetic shop' };
  await act(async () => { tree.update(createElement(OwnerInventoryScreen, {} as never)); await Promise.resolve(); });
  await act(async () => { addProduct().props.onPress(); await Promise.resolve(); });
  await act(async () => { resolveOldCategories({ items: [oldCategory], nextCursor: null, hasMore: false }); await oldCategories; });

  expect(renderedText()).toContain('New shop category');
  expect(renderedText()).not.toContain('Old private category');
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop-2/inventory/categories?limit=25');
});

it('edits and deactivates a product through the selected salon API without rewriting stock history', async () => {
  const active = { ...products.items[0], category: { id: '11111111-1111-4111-8111-111111111111', name: 'Hair' } };
  const inactive = { ...active, isActive: false };
  let productSaved = false;
  (apiFetch as jest.Mock).mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') { productSaved = true; return inactive; }
    if (path.endsWith('/report')) return report;
    if (path.includes('/categories?')) return { items: [], nextCursor: null, hasMore: false };
    if (path.includes('/suppliers?')) return { items: [], nextCursor: null, hasMore: false };
    if (path.includes('/products?')) return { items: [productSaved ? inactive : active], nextCursor: null, hasMore: false };
    return movements;
  });
  await act(async () => { tree = TestRenderer.create(createElement(OwnerInventoryScreen, {} as never)); });
  const edit = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Edit product')[0];
  await act(async () => { edit.props.onPress(); await Promise.resolve(); });
  const inactiveToggle = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Active')[0];
  await act(async () => inactiveToggle.props.onPress());
  const save = tree.root.findAll((node: any) => node.props.accessibilityRole === 'button' && textOf(node) === 'Save')[0];
  await act(async () => { save.props.onPress(); await Promise.resolve(); });

  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/shop%2Fid/inventory/products/p1', {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Shampoo', sku: 'SH-1', categoryId: '11111111-1111-4111-8111-111111111111', supplierId: null, isActive: false, reorderThreshold: 5 }),
  });
  expect((apiFetch as jest.Mock).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  expect(renderedText()).toContain('Inactive');
  expect(renderedText()).toContain('3');
});
