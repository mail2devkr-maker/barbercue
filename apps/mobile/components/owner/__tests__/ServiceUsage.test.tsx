import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ServiceUsageSheet } from '../ServiceUsageSheet';
import { RecipesPanel } from '../InventoryUsagePanels';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
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

const options = {
  queueEntryId: 'q1', salonId: 's1', tokenNumber: 7, customerName: null, status: 'IN_SERVICE', hasAnythingToRecord: true,
  services: [{ serviceId: 'svc1', serviceName: 'Shave', recorded: null, lines: [{ id: 'r1', categoryName: 'Shaving cream', quantity: '10', unit: 'MILLILITER', productIds: ['p1', 'p2'], defaultProductId: 'p1' }] }],
  products: [
    { productId: 'p1', name: 'Cream A', brand: null, imageUrl: null, categoryId: 'c1', stockOnHand: '500', unit: 'MILLILITER', contentSize: null, contentUnit: null, recentRank: 1 },
    { productId: 'p2', name: 'Cream B', brand: null, imageUrl: null, categoryId: 'c1', stockOnHand: '0', unit: 'MILLILITER', contentSize: null, contentUnit: null, recentRank: null },
  ],
};

it('complete mode with no recipe completes straight away (unchanged behaviour)', async () => {
  fetchMock.mockResolvedValue({ ...options, hasAnythingToRecord: false });
  const onComplete = jest.fn();
  const onClose = jest.fn();
  await render(<ServiceUsageSheet queueEntryId="q1" mode="complete" onClose={onClose} onComplete={onComplete} />);
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  expect(onClose).toHaveBeenCalled();
});

it('pre-chooses only the salon default, saves the whole visit once, then completes', async () => {
  fetchMock.mockImplementation(async (_p: string, init?: { method?: string }) => (init?.method === 'POST' ? { services: [] } : options));
  const onComplete = jest.fn();
  const onSaved = jest.fn();
  await render(<ServiceUsageSheet queueEntryId="q1" mode="complete" onClose={jest.fn()} onComplete={onComplete} onSaved={onSaved} />);
  expect(await screen.findByText('Products used · #7')).toBeTruthy();
  expect(screen.getByText('Out of stock')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Amount for Shaving cream · 10 ml'), '12');
  await fireEvent.press(screen.getByLabelText('Save and complete'));
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
  expect(post[0]).toBe('dashboard/queue-entries/q1/product-usage');
  expect(JSON.parse(post[1].body)).toEqual({ services: [{ serviceId: 'svc1', items: [{ productId: 'p1', quantity: 12, unit: 'MILLILITER', ruleId: 'r1' }] }] });
  expect(onSaved).toHaveBeenCalledWith('1 product taken off stock.');
});

it('staff can always complete without recording', async () => {
  fetchMock.mockResolvedValue(options);
  const onComplete = jest.fn();
  await render(<ServiceUsageSheet queueEntryId="q1" mode="complete" onClose={jest.fn()} onComplete={onComplete} />);
  await fireEvent.press(await screen.findByLabelText('Complete without recording'));
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
});

it('saves a service recipe with the website rules (positive amounts, one line per category)', async () => {
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') return {};
    if (path.endsWith('/service-recipes')) return [{ serviceId: 'svc1', serviceName: 'Shave', serviceCategory: 'Grooming', isActive: true, lines: [{ id: 'l1', inventoryCategoryId: 'c1', categoryName: 'Shaving cream', quantity: '10', unit: 'MILLILITER', defaultProductId: null, defaultProductName: null, autoDeduct: false }], suggestions: [] }];
    if (path.includes('/categories')) return { items: [{ id: 'c1', name: 'Shaving cream', createdAt: '' }], nextCursor: null };
    return { items: [], nextCursor: null };
  });
  await render(<RecipesPanel salonId="s1" />);
  await fireEvent.changeText(await screen.findByLabelText('Amount per service 1'), '0');
  await fireEvent.press(screen.getByLabelText('Save'));
  expect(await screen.findByText('Each amount must be a number above 0.')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Amount per service 1'), '8');
  await fireEvent.press(screen.getByLabelText('Save'));
  await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
  const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT');
  expect(put[0]).toBe('dashboard/salons/s1/inventory/service-recipes/svc1');
  expect(JSON.parse(put[1].body)).toEqual({ lines: [{ inventoryCategoryId: 'c1', quantity: 8, unit: 'MILLILITER', defaultProductId: null, autoDeduct: false }] });
});
