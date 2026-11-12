import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { InventoryProductDto } from '@barbercue/shared';
import { CategoriesPanel, ProductEditor, SuppliersPanel } from '../InventoryLookups';
import { buildMovement } from '../../../lib/inventory-shared';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { code?: string } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const fetchMock = apiFetch as jest.Mock;
beforeEach(() => fetchMock.mockReset());

it('adds a category through the shop-scoped endpoint and refuses an empty name locally', async () => {
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => (init?.method === 'POST' ? { id: 'c1', name: 'Hair colour', createdAt: '2026-11-12T00:00:00.000Z' } : { items: [], nextCursor: null }));
  await render(<CategoriesPanel salonId="s1" />);
  await fireEvent.press(await screen.findByLabelText('Add category'));
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  await fireEvent.changeText(screen.getByLabelText('New category'), 'Hair colour');
  await fireEvent.press(screen.getByLabelText('Add category'));
  await waitFor(() => expect(screen.getByText('Hair colour added.')).toBeTruthy());
  expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/inventory/categories', { method: 'POST', body: JSON.stringify({ name: 'Hair colour' }) });
});

it('adds a supplier with the website validation', async () => {
  fetchMock.mockImplementation(async (_p: string, init?: { method?: string; body?: string }) => (init?.method === 'POST' ? { id: 'sp1', ...JSON.parse(init.body!), createdAt: '2026-11-12T00:00:00.000Z' } : { items: [], nextCursor: null }));
  await render(<SuppliersPanel salonId="s1" />);
  await fireEvent.changeText(await screen.findByLabelText('Name'), 'Synthetic Traders');
  await fireEvent.changeText(screen.getByLabelText('Email (optional)'), 'not-an-email');
  await fireEvent.press(screen.getByLabelText('Add supplier'));
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  await fireEvent.changeText(screen.getByLabelText('Email (optional)'), 'orders@example.test');
  await fireEvent.press(screen.getByLabelText('Add supplier'));
  await waitFor(() => expect(screen.getByText('Synthetic Traders added.')).toBeTruthy());
});

it('edits a product and sends only the changed fields', async () => {
  const product = { id: 'p1', name: 'Shampoo', sku: null, unit: 'EACH', categoryId: null, supplierId: null, reorderThreshold: '2', isActive: true, contentSize: null, contentUnit: null, stockOnHand: '5' } as unknown as InventoryProductDto;
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => (init?.method === 'PATCH' ? product : { items: [], nextCursor: null }));
  const onSaved = jest.fn();
  await render(<ProductEditor salonId="s1" product={product} onSaved={onSaved} onCancel={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Shampoo 500 ml');
  await fireEvent.press(screen.getByLabelText('Save product'));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Shampoo 500 ml saved.'));
  const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
  expect(patch[0]).toBe('dashboard/salons/s1/inventory/products/p1');
  expect(JSON.parse(patch[1].body)).toEqual({ name: 'Shampoo 500 ml' });
});

it('builds consumption and supplier purchases with the website rules', () => {
  expect(buildMovement('CONSUMPTION', { quantity: '2', unitCost: '', supplierId: '', direction: '', reason: 'Used on walk-ins', reference: '' }).body)
    .toEqual({ kind: 'CONSUMPTION', quantity: 2, reason: 'Used on walk-ins' });
  expect(buildMovement('PURCHASE', { quantity: '3', unitCost: '40', supplierId: 'sp1', direction: '', reason: '', reference: 'BILL-9' }).body)
    .toEqual({ kind: 'PURCHASE', quantity: 3, unitCost: 40, supplierId: 'sp1', reference: 'BILL-9' });
  expect(buildMovement('ADJUSTMENT', { quantity: '1', unitCost: '', supplierId: '', direction: 'DECREASE', reason: '', reference: '' }).body).toBeNull();
});
