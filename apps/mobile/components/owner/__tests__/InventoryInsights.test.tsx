import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { InventoryAnalyticsPanel, InventoryDashboardPanel } from '../InventoryInsights';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', writeAsStringAsync: jest.fn(async () => undefined) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
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

it('shows the server dashboard and links missing usage to the Product usage tab', async () => {
  fetchMock.mockResolvedValue({
    asOf: '2026-11-12', currency: 'INR',
    totals: { activeProducts: 12, lowStock: 2, outOfStock: 1, stockValue: '4500.00', expiringSoon: 0 },
    visitsMissingUsage7Days: 3, usage: { today: '40', last7Days: '300', last30Days: '1200' },
    usageByDay: [{ day: '2026-11-11', value: '30' }, { day: '2026-11-12', value: '40' }],
    purchases30Days: { value: '2000', entries: 4 }, retailOut30Days: { value: '0', entries: 0 }, wastage30Days: { value: '50', entries: 1 },
    byService30Days: [], topProducts30Days: [], expiring: [],
  });
  const onOpenUsage = jest.fn();
  await render(<InventoryDashboardPanel salonId="s1" onOpenUsage={onOpenUsage} />);
  expect(await screen.findByText('3 visits in the last 7 days have no products recorded.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Record them'));
  expect(onOpenUsage).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/inventory/dashboard');
});

it('loads analytics for the chosen period and shares the website CSV', async () => {
  fetchMock.mockResolvedValue({
    currency: 'INR', range: { from: '2026-08-15', to: '2026-11-12' },
    totals: { receivedValue: '100', usedValue: '60', lostValue: '5', stockValue: '400' },
    byWeek: [], byCategory: [], products: [],
  });
  await render(<InventoryAnalyticsPanel salonId="s1" />);
  await fireEvent.press(await screen.findByText('Last 90 days'));
  await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('dashboard/salons/s1/inventory/analytics?days=90'));
  await fireEvent.press(screen.getByLabelText('Download CSV'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
  expect((FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][0]).toBe('file:///cache/inventory-2026-08-15-to-2026-11-12.csv');
});
