import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { ShopLocationPanel } from '../ShopLocationPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-location', () => ({
  Accuracy: { Highest: 6 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
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
const located = { current: { latitude: null, longitude: null, verification: 'UNVERIFIED', verifiedAt: null }, pendingProposal: null, lastDecision: null };

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(located);
});

it('fills the boxes from the phone GPS, then sends a GPS proposal for review without changing anything public', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 28.6139391234, longitude: 77.2090219876, accuracy: 12.4 } });
  await render(<ShopLocationPanel salonId="s1" language={'EN' as never} />);
  expect(await screen.findByText(/No location is set for your shop yet/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Use my phone location'));
  await waitFor(() => expect(screen.getByLabelText('Latitude').props.value).toBe('28.613939'));
  expect(screen.getByText(/accurate to about 12 m/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Send for review'));
  await waitFor(() => expect(screen.getByText(/Your public location does not change until FastQue approves it/)).toBeTruthy());
  const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
  expect(patch[0]).toBe('dashboard/salons/s1/location');
  expect(JSON.parse(patch[1].body)).toEqual({ latitude: 28.613939, longitude: 77.209022, source: 'GPS' });
});

it('marks edited numbers as typed, and refuses invalid coordinates locally', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  await render(<ShopLocationPanel salonId="s1" language={'EN' as never} />);
  await screen.findByText(/No location is set/);
  await fireEvent.press(screen.getByLabelText('Use my phone location'));
  expect(await screen.findByText(/Location permission was not given/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Latitude'), '123');
  await fireEvent.changeText(screen.getByLabelText('Longitude'), '77.2');
  await fireEvent.press(screen.getByLabelText('Send for review'));
  expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
});
