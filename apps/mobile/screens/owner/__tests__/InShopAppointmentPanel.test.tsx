import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import InShopAppointmentPanel from '../InShopAppointmentPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'synthetic-idempotency-key' }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('../../../components/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  const { createElement } = require('react');
  return {
    Button: ({ title, onPress, loading, disabled }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled: disabled || loading }, createElement(Text, null, title)),
    Card: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Screen: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    SectionHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => createElement(View, null, createElement(Text, null, title), createElement(Text, null, subtitle)),
  };
});

const fetchMock = apiFetch as jest.Mock;
const serviceId = '00000000-0000-4000-8000-000000000001';
const slotStart = '2026-11-10T09:00:00.000Z';
const created = { id: 'booking-synthetic-1', salonId: 'salon-1', slotStart, slotEnd: '2026-11-10T09:30:00.000Z', status: 'CONFIRMED', guestName: 'Synthetic Guest', guestPhone: '9876543210', serviceNames: ['Haircut'], staffName: null, note: null, createdAt: '2026-11-03T12:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockImplementation((path: string, options?: { method?: string }) => {
    if (path.endsWith('/services')) return Promise.resolve([{ id: serviceId, name: 'Haircut', description: null, durationMinutes: 30, price: 250, category: 'Hair', isActive: true, currency: 'INR' }]);
    if (path.endsWith('/timezone')) return Promise.resolve({ id: 'salon-1', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true, timezoneManuallyOverridden: false });
    if (path.includes('/booking/staff?')) return Promise.resolve([]);
    if (path.includes('/booking/availability?')) return Promise.resolve([{ slotStart, slotEnd: '2026-11-10T09:30:00.000Z', available: true, state: 'AVAILABLE' }]);
    if (path.endsWith('/bookings/in-shop') && options?.method === 'POST') return Promise.resolve(created);
    return Promise.resolve({});
  });
});

describe('InShopAppointmentPanel', () => {
  it('uses shop availability, requires phone consent, and sends an idempotent salon-scoped booking', async () => {
    const onBack = jest.fn();
    const onCreated = jest.fn();
    await render(<InShopAppointmentPanel salonId="salon-1" onBack={onBack} onCreated={onCreated} />);

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Service Haircut' })).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByRole('checkbox', { name: 'Service Haircut' })); });
    await waitFor(() => expect(screen.getByRole('radio', { name: `Appointment slot ${slotStart}` })).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Customer name'), 'Synthetic Guest');
      fireEvent.changeText(screen.getByLabelText('Mobile number (optional)'), '9876543210');
    });
    await act(async () => { fireEvent.press(screen.getByRole('radio', { name: `Appointment slot ${slotStart}` })); });

    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Create appointment' })); });
    expect(screen.getByRole('alert').props.children).toContain('agreed');
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/bookings/in-shop'), expect.objectContaining({ method: 'POST' }));

    await act(async () => { fireEvent.press(screen.getByRole('checkbox', { name: 'Customer contact consent' })); });
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Create appointment' })); });

    expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/salon-1/bookings/in-shop', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-idempotency-key' },
      body: JSON.stringify({ guestName: 'Synthetic Guest', guestPhone: '+919876543210', contactConsent: true, serviceIds: [serviceId], slotStart }),
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Appointment booked')).toBeTruthy();
  }, 15000);
});
