import React from 'react';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { InventoryUnit } from '@barbercue/shared';
import OwnerInventoryScreen from '../OwnerInventoryScreen';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
}));
jest.mock('../../../lib/salon-context', () => ({
  useSalon: () => ({ selectedSalonId: 'salon-1' }),
}));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'en' }),
}));
jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: jest.fn(() => 'stable-test-key-123') }));

const apiFetch = jest.requireMock('../../../lib/api').apiFetch as jest.Mock;

describe('OwnerInventoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    apiFetch.mockImplementation((path: string, options?: RequestInit) => {
      if (path.endsWith('/report')) return Promise.resolve({
        productCount: 0, lowStockCount: 0, estimatedStockValue: '0.00',
        valuationBasis: 'weighted-average-cost', currency: 'INR', movementCounts: {}, lowStockProducts: [],
      });
      if (options?.method === 'POST') return Promise.resolve({ id: 'new-product', salonId: 'salon-1', name: 'Synthetic shampoo', sku: null, unit: 'EACH', stockOnHand: '0', averageUnitCost: '0.00', reorderThreshold: '0', isLowStock: false, isActive: true, category: null, supplier: null, updatedAt: '2026-11-04T00:00:00.000Z' });
      if (path.includes('/products?')) return Promise.resolve({ items: [], hasMore: false, nextCursor: null });
      return Promise.resolve({ items: [], hasMore: false, nextCursor: null });
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('loads shop-scoped inventory and creates a zero-stock product through the API', async () => {
    const { getByTestId, getByText } = render(<OwnerInventoryScreen />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/inventory/report'));
    fireEvent.changeText(getByTestId('inventory-create-name'), 'Synthetic shampoo');
    fireEvent.press(getByText('Save product'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      'dashboard/salons/salon-1/inventory/products',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Synthetic shampoo', unit: InventoryUnit.EACH, reorderThreshold: 0 }) }),
    ));
    expect(getByText('Inventory')).toBeTruthy();
  });

  it('uses one idempotency key for a purchase and exposes movement history', async () => {
    const product = {
      id: 'product-1', salonId: 'salon-1', name: 'Synthetic shampoo', sku: null, unit: 'EACH',
      stockOnHand: '3', averageUnitCost: '2.00', reorderThreshold: '1', isLowStock: false,
      isActive: true, category: null, supplier: null, updatedAt: '2026-11-04T00:00:00.000Z',
    };
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith('/report')) return Promise.resolve({
        productCount: 1, lowStockCount: 0, estimatedStockValue: '6.00',
        valuationBasis: 'weighted-average-cost', currency: 'INR', movementCounts: {}, lowStockProducts: [],
      });
      if (path.includes('/products?')) return Promise.resolve({ items: [product], hasMore: false, nextCursor: null });
      if (path.endsWith('/movements?limit=20&productId=product-1')) return Promise.resolve({ items: [], hasMore: false, nextCursor: null });
      return Promise.resolve({});
    });
    const { getByText, getByTestId } = render(<OwnerInventoryScreen />);
    await waitFor(() => expect(getByText('Synthetic shampoo')).toBeTruthy());
    fireEvent.press(getByText('Purchase'));
    fireEvent.changeText(getByTestId('inventory-movement-quantity'), '2');
    fireEvent.changeText(getByTestId('inventory-movement-cost'), '3');
    await act(async () => { fireEvent.press(getByText('Record stock movement')); });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      'dashboard/salons/salon-1/inventory/products/product-1/movements',
      expect.objectContaining({ method: 'POST', headers: { 'Idempotency-Key': 'stable-test-key-123' }, body: JSON.stringify({ kind: 'PURCHASE', quantity: 2, unitCost: 3 }) }),
    ));
  });
});
