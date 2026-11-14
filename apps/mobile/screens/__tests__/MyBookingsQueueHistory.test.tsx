import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import MyBookingsScreen from '../MyBookingsScreen';
import { apiFetch } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: new Proxy({}, { get: (_target, key) => String(key) }) }),
}));
jest.mock('../../lib/use-rebook', () => ({ useRebook: () => ({ rebook: jest.fn(), rebookingId: null, rebookError: null }) }));
jest.mock('../../lib/booking-actions', () => ({ openDirections: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../components/ui', () => {
  const { Text, View } = require('react-native');
  const { createElement } = require('react');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    SectionHeader: ({ title }: { title: string }) => createElement(Text, null, title),
    Skeleton: () => createElement(View, null),
    EmptyState: ({ title }: { title: string }) => createElement(Text, null, title),
    InlineError: ({ message }: { message: string }) => createElement(Text, null, message),
    Button: ({ title }: { title: string }) => createElement(Text, null, title),
  };
});

const fetchMock = apiFetch as jest.Mock;

describe('MyBookingsScreen Live Queue history (owner report 14 Nov)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((path: string) =>
      path.startsWith('queue-entries/mine/history')
        ? Promise.resolve([
            {
              id: 'q1',
              salonId: 's1',
              salonName: 'Demo Studio',
              salonSlug: 'demo',
              citySlug: 'noida',
              countryCode: 'IN',
              salonTimezone: 'Asia/Kolkata',
              tokenNumber: 12,
              status: 'COMPLETED',
              serviceName: 'Haircut',
              joinedAt: '2026-11-13T10:00:00.000Z',
              serviceCompletedAt: '2026-11-13T10:40:00.000Z',
            },
          ])
        : Promise.resolve({ items: [], nextCursor: null }),
    );
  });

  it("shows the customer's own Live Queue visits under a Live Queue tab", async () => {
    await render(<MyBookingsScreen navigation={{ navigate: jest.fn() } as never} route={{} as never} />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('history-tab-queue'));
    });
    await waitFor(() => expect(screen.getByText('Token #12')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('queue-entries/mine/history?limit=50');
    expect(screen.getByText('Demo Studio')).toBeTruthy();
    expect(screen.getByText('Haircut')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });
});
