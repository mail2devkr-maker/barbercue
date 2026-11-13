import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { InventoryHistoryPanel } from '../InventoryHistoryPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
  };
});
const fetchMock = apiFetch as jest.Mock;
const row = (id: string, kind: string, productName: string) => ({ id, salonId: 's1', productId: `p-${id}`, productName, sku: null, kind, quantityDelta: kind === 'CONSUMPTION' ? '-1' : '5', unitCost: null, stockAfter: '5', averageUnitCostAfter: '0', supplier: null, actorUserId: 'u', reason: null, reference: null, recordedAt: '2026-11-13T05:00:00.000Z' });

it('lists every movement and filters by type through the server and by product on the phone', async () => {
  fetchMock.mockImplementation(async (path: string) => {
    const kind = new URL(`https://x/${path}`).searchParams.get('kind');
    const all = [row('1', 'PURCHASE', 'Shampoo'), row('2', 'CONSUMPTION', 'Wax')];
    return { items: kind ? all.filter((r) => r.kind === kind) : all, nextCursor: null, hasMore: false };
  });
  await render(<InventoryHistoryPanel salonId="s1" currency="INR" />);
  expect(await screen.findByText('Shampoo')).toBeTruthy();
  expect(screen.getByText('Wax')).toBeTruthy();
  expect(String(fetchMock.mock.calls[0][0])).toContain('dashboard/salons/s1/inventory/movements');
  await fireEvent.changeText(screen.getByLabelText('Only this product (optional)'), 'wax');
  expect(screen.queryByText('Shampoo')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Only this product (optional)'), '');
  await fireEvent.press(screen.getByText('Used'));
  await waitFor(() => expect(fetchMock.mock.calls.some(([p]) => String(p).includes('kind=CONSUMPTION'))).toBe(true));
  await waitFor(() => expect(screen.queryByText('Shampoo')).toBeNull());
});
