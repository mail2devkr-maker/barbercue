import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CustomerInvoicesCard, NotificationPreferencesCard, PhoneLinkCard } from '../CustomerAccountExtras';
import { apiDownloadFile, apiFetch } from '../../../lib/api';
import * as Sharing from 'expo-sharing';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), apiDownloadFile: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
const mockApplySession = jest.fn(async () => undefined);
jest.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', phone: null, audience: 'CUSTOMER', roles: ['CUSTOMER'] }, applySession: mockApplySession }),
}));
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

it('lists the customer’s own invoices and shares the PDF from the customer endpoint', async () => {
  fetchMock.mockResolvedValue({ items: [{ id: 'i1', number: 'INV-1', issuedAt: '2026-11-01T00:00:00.000Z', paymentStatus: 'PAID', total: 300, currency: 'INR' }], nextCursor: null });
  (apiDownloadFile as jest.Mock).mockResolvedValue('file:///cache/INV-1.pdf');
  await render(<CustomerInvoicesCard language={'EN' as never} />);
  expect(await screen.findByText('INV-1')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith('invoices/mine');
  await fireEvent.press(screen.getByLabelText('PDF'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
  expect(apiDownloadFile).toHaveBeenCalledWith('invoices/mine/i1/pdf', 'INV-1.pdf');
});

it('toggles an in-app notification category', async () => {
  const prefs = (enabled: boolean) => ({ categories: [{ category: 'PROMOTIONAL', channels: [{ channel: 'IN_APP', enabled }] }] });
  fetchMock.mockImplementation(async (_p: string, init?: { method?: string }) => (init?.method === 'PUT' ? prefs(false) : prefs(true)));
  await render(<NotificationPreferencesCard language={'EN' as never} />);
  await fireEvent(await screen.findByLabelText('Offers & promotions'), 'valueChange', false);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('notifications/preferences', { method: 'PUT', body: JSON.stringify({ category: 'PROMOTIONAL', channel: 'IN_APP', enabled: false }) }));
});

it('verifies a sign-in phone with OTP and applies the returned session', async () => {
  fetchMock.mockImplementation(async (path: string) => {
    if (path.endsWith('methods')) return { phoneOtp: true };
    if (path.includes('verify')) return { user: { id: 'u1', phone: '+919000000001' }, tokens: {} };
    return {};
  });
  await render(<PhoneLinkCard language={'EN' as never} />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), '+919000000001');
  await fireEvent.press(screen.getByLabelText('Send code'));
  await fireEvent.changeText(await screen.findByLabelText('Verification code'), '123456');
  await fireEvent.press(screen.getByLabelText('Verify'));
  await waitFor(() => expect(mockApplySession).toHaveBeenCalled());
  expect(await screen.findByText(/verified sign-in number is saved/)).toBeTruthy();
});

it('hides the phone link when phone OTP is not enabled on the server', async () => {
  fetchMock.mockResolvedValue({ phoneOtp: false });
  const view = await render(<PhoneLinkCard language={'EN' as never} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(view.queryByLabelText('Phone number')).toBeNull();
});
