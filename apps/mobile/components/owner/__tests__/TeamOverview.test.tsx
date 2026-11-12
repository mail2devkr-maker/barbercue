import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TeamOverview } from '../TeamOverview';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../ui', () => {
  const { View, Text } = require('react-native');
  const { createElement } = require('react');
  return { Card: View, InlineError: ({ message }: { message: string }) => createElement(Text, null, message) };
});

it('shows per-barber performance and the week of working hours (shop hours when not set)', async () => {
  (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path.endsWith('/overview')) return { currency: 'INR', staffPerformance: [{ staffId: 'st1', displayName: 'Staff 1', availabilityState: 'IN_SERVICE', completedToday: 3, completedLast30Days: 41, estimatedValueLast30Days: 12300 }] };
    if (path.endsWith('/staff')) return [{ id: 'st1', displayName: 'Staff 1', status: 'ACTIVE' }];
    return [{ dayOfWeek: 1, configured: true, isClosed: false, openTime: '10:00', closeTime: '19:00' }, { dayOfWeek: 2, configured: true, isClosed: true, openTime: null, closeTime: null }];
  });
  await render(<TeamOverview salonId="s1" language={'EN' as never} />);
  expect(await screen.findByText('With a customer')).toBeTruthy();
  expect(screen.getByText('Today 3 · 30 days 41')).toBeTruthy();
  await fireEvent.press(screen.getByText('Schedule'));
  expect(await screen.findByText('Mon: 10:00–19:00')).toBeTruthy();
  expect(screen.getByText('Tue: Off')).toBeTruthy();
  expect(screen.getByText('Sun: Shop hours')).toBeTruthy();
});
