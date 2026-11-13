import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BookingSourcesPanel } from '../BookingSourcesPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../QrMatrixView', () => ({ QrMatrixView: () => null }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    EmptyState: ({ title }: { title: string }) => createElement(Text, null, title),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const token = 'A'.repeat(43);
const campaign = { id: 'c1', salonId: 's1', source: 'INSTAGRAM', label: 'Bio link', startsAt: null, endsAt: null, revokedAt: null, bookingCount: 4, createdAt: '2026-11-01T00:00:00.000Z' };
const fetchMock = apiFetch as jest.Mock;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.endsWith('/timezone')) return { timezone: 'Asia/Kolkata' };
    if (path.includes('/summary?')) return { salonId: 's1', from: '2026-10-14', to: '2026-11-12', timezone: 'Asia/Kolkata', asOf: '', bySource: [{ source: 'FASTQUE_APP', bookingCount: 5 }, { source: 'UNKNOWN', bookingCount: 2 }], campaigns: [{ campaignId: 'c1', label: 'Bio link', source: 'INSTAGRAM', bookingCount: 4 }] };
    if (path.endsWith('/share-links')) return { status: 'READY', canonicalUrl: 'https://fastque.com/in/delhi/demo-shop' };
    if (path.endsWith('/revoke')) return { ...campaign, revokedAt: '2026-11-12T00:00:00.000Z' };
    if (init?.method === 'POST' && path.endsWith('/campaigns')) return { ...campaign, id: 'c2', label: JSON.parse(init.body!).label, token };
    if (path.includes('/campaigns?')) return { items: [campaign], nextCursor: null };
    return {};
  });
});

it('shows bookings by source (never guessing older ones) and by campaign', async () => {
  await render(<BookingSourcesPanel salonId="s1" language={'EN' as never} />);
  expect(await screen.findByText('FastQue app')).toBeTruthy();
  expect(screen.getByText('Not recorded')).toBeTruthy();
  expect(screen.getAllByText('Bio link').length).toBeGreaterThan(0);
});

it('creates a campaign, shows its one-time code and shares it', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  await render(<BookingSourcesPanel salonId="s1" language={'EN' as never} />);
  await screen.findByText('FastQue app');
  await fireEvent.changeText(screen.getByLabelText('Campaign name'), 'Diwali post');
  await fireEvent.press(screen.getByLabelText('Create campaign code'));
  expect(await screen.findByTestId('campaign-code')).toBeTruthy();
  const post = fetchMock.mock.calls.find(([p, i]) => String(p).endsWith('/campaigns') && i?.method === 'POST');
  expect(post[0]).toBe('dashboard/salons/s1/booking-attribution/campaigns');
  expect(JSON.parse(post[1].body)).toMatchObject({ source: 'FACEBOOK', label: 'Diwali post' });
  await fireEvent.press(screen.getByLabelText('Share / copy code'));
  expect(share).toHaveBeenCalledWith({ message: token });
  share.mockRestore();
});

it('rejects an empty campaign name locally, and turns a campaign off only after confirming', async () => {
  await render(<BookingSourcesPanel salonId="s1" language={'EN' as never} />);
  await screen.findByText('FastQue app');
  await fireEvent.press(screen.getByLabelText('Create campaign code'));
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  await fireEvent.press(screen.getByLabelText('Turn off Bio link'));
  await fireEvent.press(screen.getByLabelText('Yes, turn off'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/booking-attribution/campaigns/c1/revoke', { method: 'POST' }));
});
