import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import OwnerSettingsScreen from '../OwnerSettingsScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
let mockSelectedSalonId = 'salon-one';
jest.mock('../../../lib/salon-context', () => ({
  useSalon: () => ({ selectedSalonId: mockSelectedSalonId, selectedSalon: { id: mockSelectedSalonId, name: 'Synthetic Shop' } }),
}));
jest.mock('../../../components/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  const { createElement } = require('react');
  return {
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, disabled: disabled || loading, onPress }, createElement(Text, null, title)),
    Card: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    EmptyState: ({ title }: { title: string }) => createElement(Text, null, title),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Screen: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    SectionHeader: ({ title, subtitle }: { title: string; subtitle: string }) => createElement(View, null, createElement(Text, null, title), createElement(Text, null, subtitle)),
    Skeleton: () => createElement(View),
  };
});

const fetchMock = apiFetch as jest.Mock;
const profilePath = 'dashboard/salons/salon-one/profile';
const timezonePath = 'dashboard/salons/salon-one/timezone';
const profile = { id: 'salon-one', name: 'Synthetic Shop', phone: null, email: null, addressLine: 'Test Street', postalCode: null, description: null };
const timezone = { id: 'salon-one', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true, timezoneManuallyOverridden: false, suggestion: { timezone: 'Asia/Kolkata', confidence: 'HIGH', source: 'city' } };

describe('OwnerSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedSalonId = 'salon-one';
    fetchMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.endsWith('/profile') && options?.method === 'PATCH') return Promise.resolve({ ...profile, name: 'Updated Shop' });
      if (path.endsWith('/timezone') && options?.method === 'PATCH') return Promise.resolve({ ...timezone, timezone: 'Europe/London', suggestion: null });
      return Promise.resolve(path.endsWith('/profile') ? profile : timezone);
    });
  });

  it('loads only the selected salon profile and time zone', async () => {
    await render(<OwnerSettingsScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Synthetic Shop')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(profilePath);
    expect(fetchMock).toHaveBeenCalledWith(timezonePath);
    expect(screen.getByDisplayValue('Asia/Kolkata')).toBeTruthy();
  });

  it('validates with the shared schema and saves edited profile only to selected salon', async () => {
    await render(<OwnerSettingsScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Synthetic Shop')).toBeTruthy());
    await fireEvent.changeText(screen.getByLabelText('Shop name'), 'Updated Shop');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Save business details' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalledWith(profilePath, expect.objectContaining({ method: 'PATCH' }));

    await fireEvent.changeText(screen.getByLabelText('Email'), 'owner@example.test');
    await fireEvent.press(screen.getByRole('button', { name: 'Save business details' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(profilePath, {
      method: 'PATCH', body: JSON.stringify({ name: 'Updated Shop', phone: '', email: 'owner@example.test', addressLine: 'Test Street', postalCode: '', description: '' }),
    }));
  });

  it('keeps the detected timezone as a suggestion until the owner explicitly saves it', async () => {
    await render(<OwnerSettingsScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Asia/Kolkata')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Use suggested time zone' }));
    expect(fetchMock).not.toHaveBeenCalledWith(timezonePath, expect.objectContaining({ method: 'PATCH' }));
    await fireEvent.changeText(screen.getByLabelText('IANA time zone'), 'Europe/London');
    await fireEvent.press(screen.getByRole('button', { name: 'Save time zone' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(timezonePath, {
      method: 'PATCH', body: JSON.stringify({ timezone: 'Europe/London' }),
    }));
  });

  it('does not show prior salon data after the selected shop changes', async () => {
    const view = await render(<OwnerSettingsScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Synthetic Shop')).toBeTruthy());
    mockSelectedSalonId = 'salon-two';
    fetchMock.mockImplementation((path: string) => Promise.resolve({ ...profile, id: 'salon-two', name: 'Second Synthetic Shop' }));
    await view.rerender(<OwnerSettingsScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Second Synthetic Shop')).toBeTruthy());
    expect(screen.queryByDisplayValue('Synthetic Shop')).toBeNull();
  });
});
