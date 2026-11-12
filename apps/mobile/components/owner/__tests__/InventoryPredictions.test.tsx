import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PredictionsPanel } from '../InventoryPredictions';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const predictions = {
  asOf: '2026-11-12', summary: { orderNow: 1, outOfStock: 1, orderSoon: 2, expiringAtRisk: 0, notEnoughData: 3 },
  alerts: [{ id: 'a1', kind: 'REORDER', title: 'Shampoo', detail: 'Order by 14 Nov' }],
  products: [{ productId: 'p1', name: 'Shampoo', categoryName: 'Hair', supplierName: 'Synthetic Traders', leadTimeDays: 3, stockOnHand: '2', unit: 'EACH', dailyRate: 0.5, trend: 'UP', daysLeft: 4.2, stockOutDate: '2026-11-16', reorderDate: '2026-11-13', suggestedOrderQuantity: 10, status: 'ORDER_NOW', confidence: 'MEDIUM', explanation: 'Used about 3 a week.', expiry: [] }],
  settings: { leadTimeDays: 3, safetyDays: 2, coverDays: 14, alertsEnabled: false },
  suppliers: [{ id: 'sp1', name: 'Synthetic Traders', leadTimeDays: null }],
};
const fetchMock = apiFetch as jest.Mock;

it('shows server predictions, dismisses an alert, and saves assumptions as whole days', async () => {
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => (init?.method ? {} : predictions));
  await render(<PredictionsPanel salonId="s1" />);
  expect(await screen.findByText('Shampoo · Order now')).toBeTruthy();
  expect(screen.getAllByText('2').length).toBeGreaterThan(0); // order now = orderNow + outOfStock (2); within a week also 2
  await fireEvent.press(screen.getByLabelText('Dismiss Shampoo'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/inventory/alerts/a1/dismiss', { method: 'POST' }));
  await fireEvent.changeText(screen.getByLabelText('Order covers (days)'), '1.5');
  await fireEvent.press(screen.getByLabelText('Save'));
  expect(await screen.findByText('Use whole days (an order must cover at least 1 day).')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Order covers (days)'), '21');
  await fireEvent.changeText(screen.getByLabelText('Synthetic Traders delivery days'), '5');
  await fireEvent.press(screen.getByLabelText('Save'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/inventory/suppliers/sp1/lead-time', { method: 'PUT', body: JSON.stringify({ leadTimeDays: 5 }) }));
  expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/inventory/forecast-settings', { method: 'PUT', body: JSON.stringify({ leadTimeDays: 3, safetyDays: 2, coverDays: 21, alertsEnabled: false }) });
});
