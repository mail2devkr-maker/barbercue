import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DaySchedule } from '../DaySchedule';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), apiDownloadFile: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../BookingActions', () => {
  const actual = jest.requireActual('../BookingActions');
  const { Text } = require('react-native');
  const { createElement } = require('react');
  return { ...actual, BookingActions: ({ booking }: { booking: { id: string } }) => createElement(Text, null, `actions:${booking.id}`) };
});
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, null, message),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
  };
});

const booking = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id, salonId: 's1', status: 'CONFIRMED', serviceName: `Service ${id}`, slotStart: start, slotEnd: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  assignedStaffId: null, preferredStaffId: null, assignedStaffName: null, preferredStaffName: null, customerPhone: null, guestPhone: null, ...extra,
});
const fetchMock = apiFetch as jest.Mock;

it('lays out one day by barber in shop time, pages to the end, and never shows a preference as an assignment', async () => {
  fetchMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/staff')) return [{ id: 'st1', displayName: 'Staff 1', status: 'ACTIVE' }];
    const q = new URLSearchParams(path.split('?')[1]);
    if (!q.get('cursor')) return { items: [booking('b2', '2026-11-12T06:00:00.000Z', { preferredStaffId: 'st1' })], nextCursor: 'p2' };
    return { items: [booking('b1', '2026-11-12T04:30:00.000Z', { assignedStaffId: 'st1' }), booking('b3', '2026-11-12T05:00:00.000Z')], nextCursor: null };
  });
  await render(<DaySchedule salonId="s1" timeZone="Asia/Kolkata" language={'EN' as never} onOpenInvoice={jest.fn()} />);
  expect(await screen.findByText('Staff 1 (2)')).toBeTruthy();
  expect(screen.getByText('No preference (1)')).toBeTruthy();
  expect(screen.getByText(/^10:00\s?am\s–\s10:30\s?am$/i)).toBeTruthy(); // 04:30Z in Asia/Kolkata
  expect(screen.getByText(/Confirmed · preference/)).toBeTruthy();
  const bookingCalls = fetchMock.mock.calls.map(([p]) => String(p)).filter((p) => p.includes('/bookings?'));
  expect(bookingCalls).toHaveLength(2);
  await fireEvent.press(screen.getByLabelText(/^10:00\s?am Service b1$/i));
  expect(screen.getByText('actions:b1')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Next →'));
  await waitFor(() => expect(fetchMock.mock.calls.map(([p]) => String(p)).some((p) => /date=\d{4}-\d{2}-\d{2}/.test(p) && !p.includes('cursor'))).toBe(true));
});
