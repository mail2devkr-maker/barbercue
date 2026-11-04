import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { apiFetch } from '../../../lib/api';
import { AddServiceForm } from '../ShopSetupSections';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), apiUploadImage: jest.fn() }));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({
    language: 'EN',
    t: {
      addService: 'Add service', servicePlaceholder: 'Service name', pricePlaceholder: 'Price', minutesPlaceholder: 'Minutes',
      couldNotAddService: 'Could not add service', addAction: 'Add', cancelAction: 'Cancel',
    },
  }),
}));
jest.mock('../../ui', () => {
  const { Pressable, Text } = require('react-native');
  const { createElement } = require('react');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, disabled, onPress }, createElement(Text, null, title)),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    SafeImage: () => null,
    UpiRoutingStatus: () => null,
  };
});

const fetchMock = apiFetch as jest.Mock;
const categories = [{ id: 'category-hair', name: 'Hair', subcategories: [{ id: 'subcategory-cut', name: 'Cut' }] }];

describe('owner service taxonomy controls', () => {
  afterEach(() => cleanup());
  beforeEach(() => { jest.clearAllMocks(); fetchMock.mockResolvedValue({}); });

  it('creates a salon service with selected stable category IDs', async () => {
    const onAdded = jest.fn();
    const view = await render(<AddServiceForm salonId="salon-owned-by-session" categories={categories} onAdded={onAdded} />);
    await fireEvent.press(view.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(view.getByPlaceholderText('Service name')).toBeTruthy());
    fireEvent.changeText(view.getByPlaceholderText('Service name'), 'Fade');
    fireEvent.changeText(view.getByPlaceholderText('Price'), '250');
    fireEvent.changeText(view.getByPlaceholderText('Minutes'), '30');
    await fireEvent.press(view.getByRole('button', { name: 'Hair' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Cut' })).toBeTruthy());
    await fireEvent.press(view.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'dashboard/salons/salon-owned-by-session/services',
      { method: 'POST', body: JSON.stringify({ name: 'Fade', price: 250, durationMinutes: 30, categoryId: 'category-hair' }) },
    ));
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

});

