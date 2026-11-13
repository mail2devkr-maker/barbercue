import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DemoWorkspacePanel } from '../DemoWorkspacePanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
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

it('is hidden behind the demoData capability', async () => {
  fetchMock.mockResolvedValue({ features: { demoData: { status: 'DISABLED' } } });
  await render(<DemoWorkspacePanel salonId="s1" />);
  expect(await screen.findByText('Demo data is not available yet')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([p]) => String(p).includes('/demo/'))).toBe(false);
});

it('deletes the demo workspace only with the server token and the exact typed phrase', async () => {
  let active = true;
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.endsWith('/capabilities')) return { features: { demoData: { status: 'ENABLED' } } };
    if (path.endsWith('/demo/status')) return active ? { active: true, workspaceId: 'w1', label: 'DEMO DATA — Not real business records', counts: { customers: 5 } } : { active: false };
    if (path.endsWith('/delete-preview')) return { confirmationToken: 'tok-123456789012345678901234', expiresAt: new Date(Date.now() + 600_000).toISOString() };
    if (init?.method === 'DELETE') { active = false; return {}; }
    return {};
  });
  await render(<DemoWorkspacePanel salonId="s1" />);
  await fireEvent.press(await screen.findByLabelText('Delete demo data'));
  const confirm = await screen.findByLabelText('Confirm delete demo data');
  expect(confirm.props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Type the phrase to confirm'), 'DELETE DEMO DATA');
  await fireEvent.press(screen.getByLabelText('Confirm delete demo data'));
  await waitFor(() => expect(screen.getByText('Demo data deleted. Your real shop data was not changed.')).toBeTruthy());
  const del = fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE');
  expect(del[0]).toBe('dashboard/salons/s1/demo');
  expect(JSON.parse(del[1].body)).toMatchObject({ workspaceId: 'w1', confirmationToken: 'tok-123456789012345678901234' });
});
