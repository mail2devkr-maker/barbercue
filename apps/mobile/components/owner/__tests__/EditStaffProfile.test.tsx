import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { EditStaffProfile } from '../ShopSetupSections';
import type { SalonStaffDto } from '@barbercue/shared';

const mockApiFetch = jest.fn();
jest.mock('../../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  apiUploadImage: jest.fn(),
  ApiError: class ApiError extends Error {},
  NativeUploadError: class NativeUploadError extends Error {},
}));
let mockLanguage: 'EN' | 'HI' = 'EN';
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: mockLanguage, t: {} }) }));
jest.mock('../../../components/ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, React.createElement(Text, null, title)),
    InlineError: ({ message }: { message: string }) => React.createElement(Text, { accessibilityRole: 'alert' }, message),
    SafeImage: () => React.createElement(View),
    UpiRoutingStatus: () => React.createElement(View),
  };
});

const staff: SalonStaffDto = {
  id: 'staff-1', displayName: 'Sam', phone: null, email: null,
  roleInSalon: 'BARBER' as SalonStaffDto['roleInSalon'], status: 'ACTIVE' as SalonStaffDto['status'],
  hasPassword: false, bio: 'Classic cuts', photoUrl: null, yearsExperience: 5,
};

describe('EditStaffProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLanguage = 'EN';
    mockApiFetch.mockResolvedValue({});
  });

  it('updates only the selected salon staff profile fields through the scoped API', async () => {
    const view = await render(<EditStaffProfile salonId="salon-a" staff={staff} onSaved={jest.fn()} />);
    await fireEvent.press(view.getByRole('button', { name: 'Edit profile' }));
    await fireEvent.changeText(view.getByLabelText('Staff name'), 'Sam Barber');
    await fireEvent.changeText(view.getByLabelText('Bio'), 'Precision cuts');
    await fireEvent.changeText(view.getByLabelText('Years of experience'), '7');
    await fireEvent.press(view.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('dashboard/salons/salon-a/staff/staff-1', {
      method: 'PATCH', body: JSON.stringify({ displayName: 'Sam Barber', bio: 'Precision cuts', yearsExperience: 7 }),
    }));
  }, 15000);

  it('rejects invalid profile values before calling the API', async () => {
    const view = await render(<EditStaffProfile salonId="salon-a" staff={staff} onSaved={jest.fn()} />);
    await fireEvent.press(view.getByRole('button', { name: 'Edit profile' }));
    await fireEvent.changeText(view.getByLabelText('Years of experience'), '81');
    await fireEvent.press(view.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('localizes profile controls in Hindi', async () => {
    mockLanguage = 'HI';
    const view = await render(<EditStaffProfile salonId="salon-a" staff={staff} onSaved={jest.fn()} />);
    expect(view.getByRole('button', { name: 'प्रोफ़ाइल संपादित करें' })).toBeTruthy();
  });
});
