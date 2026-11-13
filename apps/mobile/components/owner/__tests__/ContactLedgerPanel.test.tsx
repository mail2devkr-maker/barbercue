import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ContactLedgerPanel } from '../ContactLedgerPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled, accessibilityState: { disabled: !!disabled } }, createElement(Text, null, title)),
  };
});
const fetchMock = apiFetch as jest.Mock;

beforeEach(() => fetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
  if (path.endsWith('/summary')) return { active: 4, withdrawn: 1, expired: 0, expiringWithin30Days: 2, retentionDays: 365, dispatchEnabled: false };
  if (path.endsWith('/withdraw')) return { withdrawn: true, suppressedEverywhere: false };
  if (path.endsWith('/erase')) return { erased: 1, suppressionKept: true };
  throw new Error(path);
}));

it('shows counts only and records a stop request without sending anything', async () => {
  await render(<ContactLedgerPanel salonId="s1" />);
  expect(await screen.findByText('4')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '98765 43210');
  await fireEvent.press(screen.getByLabelText('They asked to stop'));
  expect(await screen.findByText('Saved as asked to stop.')).toBeTruthy();
  const call = fetchMock.mock.calls.find(([p]) => String(p).endsWith('/withdraw'));
  expect(JSON.parse(call[1].body)).toEqual({ phone: '98765 43210', suppressEverywhere: false });
});

it('erases only after the explicit acknowledgement, keeping a do-not-contact marker by default', async () => {
  await render(<ContactLedgerPanel salonId="s1" />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), '98765 43210');
  expect(screen.getByLabelText('Erase my record').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByLabelText('I understand that erasing deletes my shop’s record of this number'));
  await fireEvent.press(screen.getByLabelText('Erase my record'));
  await waitFor(() => expect(screen.getByText(/was erased\. Only a do-not-contact marker is kept/)).toBeTruthy());
  const call = fetchMock.mock.calls.find(([p]) => String(p).endsWith('/erase'));
  expect(JSON.parse(call[1].body)).toEqual({ phone: '98765 43210', keepSuppression: true });
});
