import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ServiceCategoryManager } from '../ServiceCategoryManager';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { status = 0; code = ''; } }));
jest.mock('../../ui', () => {
  const { Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled }, createElement(Text, null, title)),
  };
});

const tree = [
  { id: 'c1', name: 'Hair', subcategories: [{ id: 's1', name: 'Colour' }] },
  { id: 'c2', name: 'Spa', subcategories: [] },
];
const services = [{ id: 'sv1', name: 'Haircut', categoryId: 'c1', category: 'Hair', subcategoryId: null, subcategory: null }];
const fetchMock = apiFetch as jest.Mock;

it('adds, refuses duplicates, renames and deletes only empty categories after confirming', async () => {
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => (init?.method ? {} : path.endsWith('/services') ? services : tree));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.[1]?.onPress?.());
  await render(<ServiceCategoryManager salonId="s1" />);
  expect(await screen.findByText('Hair (1 service)')).toBeTruthy();
  expect(screen.queryByLabelText('Delete Hair')).toBeNull(); // not empty
  await fireEvent.changeText(screen.getByLabelText('New category'), 'hair');
  await fireEvent.press(screen.getAllByLabelText('Add')[0]);
  expect(await screen.findByText(/already have a category called “Hair”/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('New category'), 'Nails');
  await fireEvent.press(screen.getAllByLabelText('Add')[0]);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/service-categories', { method: 'POST', body: JSON.stringify({ name: 'Nails' }) }));
  await fireEvent.press(screen.getByLabelText('Rename Spa'));
  await fireEvent.changeText(screen.getByLabelText('New name'), 'Spa & Wellness');
  await fireEvent.press(screen.getByLabelText('Save'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/service-categories/c2', { method: 'PATCH', body: JSON.stringify({ name: 'Spa & Wellness' }) }));
  await fireEvent.press(await screen.findByLabelText('Delete Spa'));
  expect(alert).toHaveBeenCalled();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/service-categories/c2', { method: 'DELETE' }));
  alert.mockRestore();
});
