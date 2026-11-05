import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StaffWorkingHoursEditor } from '../StaffWorkingHoursEditor';

const mockApiFetch = jest.fn();
let mockLanguage: 'EN' | 'HI' = 'EN';
jest.mock('../../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: mockLanguage, t: {} }) }));
jest.mock('../../../components/ui', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => React.createElement(
      Pressable,
      { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled },
      React.createElement(Text, null, title),
    ),
    InlineError: ({ message }: { message: string }) => React.createElement(Text, { accessibilityRole: 'alert' }, message),
  };
});

function week() {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    openTime: '00:00',
    closeTime: '23:59',
    isClosed: false,
    configured: false,
  }));
}

describe('StaffWorkingHoursEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLanguage = 'EN';
  });

  it('loads and saves the complete week through the selected salon and staff path', async () => {
    const inputWeek = week();
    mockApiFetch.mockResolvedValueOnce(inputWeek).mockResolvedValueOnce(inputWeek.map((day) => ({ ...day, configured: true })));
    const view = await render(<StaffWorkingHoursEditor salonId="salon-a" staffId="staff-a" />);

    await fireEvent.press(view.getByRole('button', { name: 'Working hours' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenNthCalledWith(1, 'dashboard/salons/salon-a/staff/staff-a/working-hours'));
    await fireEvent.press(view.getAllByRole('button', { name: 'Working' })[0]);
    await fireEvent.changeText(view.getByLabelText('Monday start time'), '09:30');
    await fireEvent.changeText(view.getByLabelText('Monday end time'), '18:00');
    await fireEvent.press(view.getByRole('button', { name: 'Save staff hours' }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenNthCalledWith(2, 'dashboard/salons/salon-a/staff/staff-a/working-hours', {
      method: 'PUT',
      body: JSON.stringify({ days: [
        { dayOfWeek: 0, openTime: '00:00', closeTime: '23:59', isClosed: true },
        { dayOfWeek: 1, openTime: '09:30', closeTime: '18:00', isClosed: false },
        ...inputWeek.slice(2).map(({ configured: _configured, ...day }) => day),
      ] }),
    }));
    expect(view.getByText('Staff weekly hours saved.')).toBeTruthy();
  }, 15000);

  it('rejects invalid ranges client-side and keeps the API read-only', async () => {
    mockApiFetch.mockResolvedValueOnce(week());
    const view = await render(<StaffWorkingHoursEditor salonId="salon-a" staffId="staff-a" />);
    await fireEvent.press(view.getByRole('button', { name: 'Working hours' }));
    await waitFor(() => expect(view.getByLabelText('Sunday start time')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('Sunday start time'), '18:00');
    await fireEvent.changeText(view.getByLabelText('Sunday end time'), '09:00');
    await fireEvent.press(view.getByRole('button', { name: 'Save staff hours' }));
    expect(view.getByRole('alert')).toBeTruthy();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it('localizes the entry control and preserves the staff path', async () => {
    mockLanguage = 'HI';
    mockApiFetch.mockResolvedValueOnce(week());
    const view = await render(<StaffWorkingHoursEditor salonId="salon-a" staffId="staff-b" />);
    expect(view.getByRole('button', { name: 'कार्य समय' })).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'कार्य समय' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('dashboard/salons/salon-a/staff/staff-b/working-hours'));
  });
});

