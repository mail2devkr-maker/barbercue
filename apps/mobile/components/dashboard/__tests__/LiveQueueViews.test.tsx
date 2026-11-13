import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LiveQueuePanel } from '../LiveQueuePanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'idem-key' }));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => undefined,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, []),
}));
jest.mock('../../owner/InvoiceTools', () => {
  const { Text } = require('react-native');
  const { createElement } = require('react');
  return { CreateInvoiceButton: ({ queueEntryId, bookingId }: { queueEntryId?: string | null; bookingId?: string | null }) => createElement(Text, null, `invoice:${bookingId ?? queueEntryId}`) };
});
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    Skeleton: View,
    EmptyState: ({ title }: { title: string }) => createElement(Text, null, title),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
    InlineError: ({ message }: { message: string }) => createElement(Text, null, message),
  };
});

const done = (id: string, token: number, extra: Record<string, unknown> = {}) => ({
  id, salonId: 's1', bookingId: null, tokenNumber: token, status: 'COMPLETED', customerName: `Customer ${token}`,
  serviceName: 'Haircut', assignedStaffName: 'Staff 1', joinedAt: '2026-11-12T05:00:00.000Z', ...extra,
});
function dashboard(autoAssignEnabled: boolean) {
  return {
    entries: [], staffRoster: [], chairs: [], services: [], autoAssignEnabled,
    sections: {
      waiting: [], called: [], assigned: [], inService: [],
      completedToday: [done('q1', 1), done('q2', 2, { bookingId: 'b-2' })],
      historyToday: [done('q3', 3, { status: 'NO_SHOW' }), done('q4', 4, { status: 'CANCELLED' })],
    },
  };
}
const fetchMock = apiFetch as jest.Mock;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path: string) => (path.endsWith('/queue') ? dashboard(false) : {}));
});

it('shows Completed today / No-show / History from the server sections, with an invoice per completed visit', async () => {
  await render(<LiveQueuePanel salonId="s1" ownerTools />);
  await fireEvent.press(await screen.findByText('Completed today (2)'));
  expect(screen.getByText('invoice:q1')).toBeTruthy();
  expect(screen.getByText('invoice:b-2')).toBeTruthy(); // a booking visit invoices the booking, never the queue row
  await fireEvent.press(screen.getByText('No-show (1)'));
  expect(screen.getByText('Customer 3')).toBeTruthy();
  await fireEvent.press(screen.getByText('History (1)'));
  expect(screen.getByText('Customer 4')).toBeTruthy();
});

it('lets the owner turn automatic assignment on through the queue settings endpoint', async () => {
  await render(<LiveQueuePanel salonId="s1" ownerTools />);
  const toggle = await screen.findByLabelText('Automatic assignment');
  await fireEvent(toggle, 'valueChange', true);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/queue/settings', { method: 'PATCH', body: JSON.stringify({ autoAssignEnabled: true }) }));
});

it('never shows owner-only tools (auto-assign, invoices) on the staff screen', async () => {
  await render(<LiveQueuePanel salonId="s1" />);
  await screen.findByText('Completed today (2)');
  expect(screen.queryByLabelText('Automatic assignment')).toBeNull();
  await fireEvent.press(screen.getByText('Completed today (2)'));
  expect(screen.queryByText('invoice:q1')).toBeNull();
});
