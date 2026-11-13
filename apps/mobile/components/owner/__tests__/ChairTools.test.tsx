import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { SalonChairDto } from '@barbercue/shared';
import { ChairBulkRemoval } from '../ChairTools';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../ui', () => {
  const { Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const chairs = [
  { id: 'c1', salonId: 's1', label: 'Chair 1', status: 'ACTIVE', updatedAt: '2026-11-01T00:00:00.000Z' },
  { id: 'c2', salonId: 's1', label: 'Chair 2', status: 'ACTIVE', updatedAt: '2026-11-01T00:00:00.000Z' },
] as unknown as SalonChairDto[];
const fetchMock = apiFetch as jest.Mock;

it('lets the server review the selection, then removes only the READY chairs with their reviewed version', async () => {
  fetchMock.mockImplementation(async (path: string, init: { body: string }) => {
    if (path.endsWith('/bulk-deactivate/preview')) return { salonId: 's1', items: [
      { chairId: 'c1', label: 'Chair 1', status: 'ACTIVE', expectedUpdatedAt: 'v1', disposition: 'READY', conflicts: [] },
      { chairId: 'c2', label: 'Chair 2', status: 'ACTIVE', expectedUpdatedAt: 'v2', disposition: 'CONFLICT', conflicts: [{ code: 'IN_SERVICE', message: 'A customer is seated' }] },
    ] };
    return { salonId: 's1', deactivatedCount: 1, items: JSON.parse(init.body).items.map((i: { chairId: string }) => ({ chairId: i.chairId, label: 'Chair 1', result: 'DEACTIVATED', conflicts: [] })) };
  });
  const onChanged = jest.fn();
  await render(<ChairBulkRemoval salonId="s1" chairs={chairs} language={'EN' as never} onChanged={onChanged} />);
  await fireEvent.press(screen.getByText('Select all (2)'));
  await fireEvent.press(screen.getByLabelText('Review removal (2)'));
  expect(await screen.findByText('Chair 1 — Will be removed')).toBeTruthy();
  expect(screen.getByText('Chair 2 — Cannot be removed now')).toBeTruthy();
  expect(screen.queryByText(/After this, none of your chairs/)).toBeNull(); // Chair 2 stays in use
  await fireEvent.press(screen.getByLabelText('Remove 1 chair'));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  const apply = fetchMock.mock.calls.find(([p]) => String(p).endsWith('/apply'));
  expect(apply[0]).toBe('dashboard/salons/s1/chairs/bulk-deactivate/apply');
  expect(JSON.parse(apply[1].body)).toEqual({ items: [{ chairId: 'c1', expectedUpdatedAt: 'v1' }] });
  expect(await screen.findByText(/1 removed/)).toBeTruthy();
});
