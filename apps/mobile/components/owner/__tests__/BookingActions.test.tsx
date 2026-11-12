import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { OwnerBookingDetailDto } from '@barbercue/shared';
import { BookingActions, nextDays, shopDay } from '../BookingActions';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  apiDownloadFile: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
let mockKey = 0;
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => `key-${++mockKey}` }));
jest.mock('../../ui', () => {
  const { Pressable, Text, View } = require('react-native');
  const { createElement } = require('react');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, disabled, onPress }, createElement(Text, null, title)),
    Card: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
  };
});

const fetchMock = apiFetch as jest.Mock;
const booking = {
  id: 'b-1', salonId: 'salon-1', serviceId: 'svc-1', services: [{ serviceId: 'svc-1' }, { serviceId: 'svc-2' }],
  status: 'CONFIRMED', serviceName: 'Haircut', slotStart: '2026-11-20T05:30:00.000Z', salonTimezone: 'Asia/Kolkata',
  preferredStaffId: 'staff-1', customerPhone: '+919000000001', guestPhone: null, customerId: 'cust-1',
  cancelledByActor: null, cancellationReason: null,
} as unknown as OwnerBookingDetailDto;

beforeEach(() => { fetchMock.mockReset(); mockKey = 0; });

it('computes the shop-local day and the next 14 days across a month end', () => {
  expect(shopDay(new Date('2026-11-30T20:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-12-01');
  expect(nextDays('2026-11-30', 3)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
});

it('calls the customer, and cancels only after an explicit confirmation with the optional reason', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  fetchMock.mockResolvedValue({ notification: { inApp: 'SENT', push: 'SENT' } });
  const onChanged = jest.fn();
  await render(<BookingActions booking={booking} language={'EN' as never} onChanged={onChanged} onOpenInvoice={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Call customer'));
  expect(openURL).toHaveBeenCalledWith('tel:+919000000001');
  await fireEvent.press(screen.getByLabelText('Cancel appointment'));
  await fireEvent.changeText(screen.getByLabelText('Reason (optional, shown to the customer)'), 'Barber unwell');
  await fireEvent.press(screen.getAllByLabelText('Cancel appointment')[0]);
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Appointment cancelled and the customer was notified.'));
  expect(alertSpy).toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/salon-1/bookings/b-1/cancel', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ reason: 'Barber unwell' }), headers: { 'Idempotency-Key': 'key-1' },
  }));
  alertSpy.mockRestore(); openURL.mockRestore();
});

it('reschedules to a free time from the customer availability engine', async () => {
  fetchMock.mockImplementation((path: string) => Promise.resolve(path.includes('/availability?')
    ? [{ slotStart: '2026-11-20T06:00:00.000Z', slotEnd: '2026-11-20T06:30:00.000Z', available: true, state: 'AVAILABLE' }, { slotStart: '2026-11-20T06:30:00.000Z', slotEnd: '2026-11-20T07:00:00.000Z', available: false, state: 'BOOKED' }]
    : { notification: { inApp: 'NO_ACCOUNT' } }));
  const onChanged = jest.fn();
  await render(<BookingActions booking={booking} language={'EN' as never} onChanged={onChanged} onOpenInvoice={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Reschedule'));
  await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(1)); // the booked time is not offered
  const availability = fetchMock.mock.calls[0][0] as string;
  expect(availability).toContain('salons/salon-1/booking/availability?serviceIds=svc-1%2Csvc-2');
  expect(availability).toContain('staffId=staff-1');
  await fireEvent.press(screen.getAllByRole('radio')[0]);
  await fireEvent.press(screen.getByLabelText('Move appointment'));
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Appointment moved. This guest has no FastQue account, so no notification was sent.'));
  const post = fetchMock.mock.calls.find(([p]) => String(p).endsWith('/reschedule'));
  expect(JSON.parse(post[1].body)).toEqual({ slotStart: '2026-11-20T06:00:00.000Z' });
});

it('shows no cancel/reschedule on a completed booking, but offers its invoice', async () => {
  fetchMock.mockResolvedValue(null);
  await render(<BookingActions booking={{ ...booking, status: 'COMPLETED' } as OwnerBookingDetailDto} language={'EN' as never} onChanged={jest.fn()} onOpenInvoice={jest.fn()} />);
  expect(screen.queryByLabelText('Cancel appointment')).toBeNull();
  expect(screen.queryByLabelText('Reschedule')).toBeNull();
  expect(await screen.findByLabelText('Create invoice')).toBeTruthy();
});

it('explains who cancelled a cancelled booking', async () => {
  await render(<BookingActions booking={{ ...booking, status: 'CANCELLED', cancelledByActor: 'CUSTOMER', cancellationReason: 'Travelling' } as OwnerBookingDetailDto} language={'EN' as never} onChanged={jest.fn()} onOpenInvoice={jest.fn()} />);
  expect(screen.getByText(/Cancelled by: the customer · reason: “Travelling”/)).toBeTruthy();
});
