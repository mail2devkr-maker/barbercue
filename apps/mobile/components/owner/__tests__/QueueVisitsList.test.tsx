import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueueVisitsList } from '../QueueVisitsList';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
  };
});

const visit = (id: string, token: number, extra: Record<string, unknown> = {}) => ({
  id, tokenNumber: token, status: 'COMPLETED', phase: 'DONE', serviceName: 'Haircut', customerName: null,
  assignedStaffName: 'Staff 2', joinedAt: '2026-11-12T05:00:00.000Z', ...extra,
});

it('lists Live Queue visits for the selected filter and pages with the server cursor', async () => {
  const fetchMock = apiFetch as jest.Mock;
  fetchMock
    .mockResolvedValueOnce({ items: [visit('q1', 11)], nextCursor: 'c-2' })
    .mockResolvedValueOnce({ items: [visit('q2', 12, { status: 'NO_SHOW' })], nextCursor: null });
  await render(<QueueVisitsList salonId="s1" filter="completed" language={'EN' as never} />);
  expect(await screen.findByText('#11 · Haircut')).toBeTruthy();
  expect(screen.getByText(/Customer #11 · Staff 2/)).toBeTruthy(); // no invented customer name
  expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/queue/visits?filter=completed&limit=20');
  await fireEvent.press(screen.getByLabelText('Load more Live Queue visits'));
  await waitFor(() => expect(screen.getByText('No-show')).toBeTruthy());
  expect(fetchMock).toHaveBeenLastCalledWith('dashboard/salons/s1/queue/visits?filter=completed&limit=20&cursor=c-2');
});
