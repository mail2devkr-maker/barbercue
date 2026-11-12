import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ScanStockPanel } from '../ScanStockPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), apiUploadImage: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
let mockGranted = false;
const mockRequest = jest.fn(async () => ({ granted: mockGranted }));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: false }, mockRequest] }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
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
const product = { id: 'g1', name: 'Synthetic Shampoo', brand: 'Acme', packSize: '200', packUnit: 'MILLILITER', mrp: '250', verificationStatus: 'VERIFIED', barcodes: [{ display: '8901234567890' }], imageUrls: [] };

it('rejects a barcode with a wrong check digit before calling the server', async () => {
  await render(<ScanStockPanel salonId="s1" />);
  await fireEvent.changeText(screen.getByLabelText('Barcode'), '8901234567893');
  await fireEvent.press(screen.getByLabelText('Look up'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([p]) => String(p).includes('/catalog/lookup'))).toBe(false);
});

it('falls back to typing when camera permission is refused', async () => {
  mockGranted = false;
  await render(<ScanStockPanel salonId="s1" />);
  await fireEvent.press(screen.getByLabelText('Scan with camera'));
  expect(await screen.findByText('Camera permission was not given. Type the barcode instead.')).toBeTruthy();
});

it('looks a typed barcode up and receives stock idempotently through the catalog receive endpoint', async () => {
  fetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.includes('/catalog/lookup')) return { status: 'FOUND', product, salonStock: [], linkCandidates: [], barcode: { display: '8901234567890', code: '08901234567893' } };
    if (path.endsWith('/receive') && init?.method === 'POST') return { product: { name: 'Synthetic Shampoo', unit: 'EACH', stockOnHand: '6' }, movement: {} };
    return { items: [], nextCursor: null };
  });
  await render(<ScanStockPanel salonId="s1" />);
  await fireEvent.changeText(screen.getByLabelText('Barcode'), '8901234567890');
  await fireEvent.press(screen.getByLabelText('Look up'));
  expect(await screen.findByText('Synthetic Shampoo · Verified')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('How many (pcs)'), '6');
  await fireEvent.changeText(screen.getByLabelText('Paid for one pcs (₹)'), '120');
  await fireEvent.press(screen.getByLabelText('Add stock'));
  await waitFor(() => expect(screen.getByText(/You now have 6 pcs/)).toBeTruthy());
  const post = fetchMock.mock.calls.find(([p, i]) => String(p).endsWith('/receive') && i?.method === 'POST');
  expect(post[0]).toBe('dashboard/salons/s1/inventory/receive');
  expect(post[1].headers['Idempotency-Key']).toBeTruthy();
  expect(JSON.parse(post[1].body)).toMatchObject({ globalProductId: 'g1', usage: 'PROFESSIONAL', unit: 'EACH', quantity: 6, unitCost: 120 });
});
