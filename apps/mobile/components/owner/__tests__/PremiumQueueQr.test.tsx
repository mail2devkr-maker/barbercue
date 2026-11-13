import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PremiumQueueQr } from '../PremiumQueueQr';
import { apiFetch } from '../../../lib/api';
import { excavatedCells } from '../QrMatrixView';
import { formatQueueQrPrintAddress, gradientCharacters, nameGradientColor, trustedQueueUrl } from '../../../lib/queue-qr-premium';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
const mockCapture = jest.fn(async () => 'file:///cache/handsome-queue-qr.png');
jest.mock('react-native-view-shot', () => ({ captureRef: (...args: unknown[]) => mockCapture(...(args as [])) }));
const mockShareAsync = jest.fn(async () => undefined);
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: (...args: unknown[]) => mockShareAsync(...(args as [])) }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress, disabled, accessibilityState: { disabled: !!disabled } }, createElement(Text, null, title)),
  };
});
const fetchMock = apiFetch as jest.Mock;

beforeEach(() => {
  fetchMock.mockReset();
  mockCapture.mockClear();
  mockShareAsync.mockClear();
});

function serve(queueUrl: string | null, profile: object | Error) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/queue-qr')) return { publicQueueToken: 't', publicQueueUrl: queueUrl };
    if (path.endsWith('/profile')) { if (profile instanceof Error) throw profile; return profile; }
    throw new Error(`unexpected ${path}`);
  });
}

it('draws the website premium stand from the server queue link: gold-on-black QR, mark, address', async () => {
  serve('https://fastque.com/q/abc123', { addressLine: '12  MG Road,   Indiranagar', postalCode: '560038' });
  await render(<PremiumQueueQr salonId="s1" salonName="Handsome Center" hindi={false} />);
  expect(await screen.findByLabelText('Join Handsome Center Live Queue QR code')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith('dashboard/salons/s1/queue-qr');
  expect(screen.getByText('SCAN • JOIN • GET YOUR TURN')).toBeTruthy();
  expect(await screen.findByText('12 MG Road, Indiranagar, 560038')).toBeTruthy();
  const dark = screen.getAllByTestId(/^qr-matrix-cell-/).map((c) => StyleSheet.flatten(c.props.style).backgroundColor);
  expect(new Set(dark)).toEqual(new Set(['#FFE15C', '#000000']));
  expect(screen.getByText('https://fastque.com/q/abc123')).toBeTruthy();
});

it('saves the on-screen poster as a PNG and opens the share sheet', async () => {
  serve('https://fastque.com/q/abc123', { addressLine: 'Shop 4', postalCode: null });
  await render(<PremiumQueueQr salonId="s1" salonName="Handsome Center" hindi={false} />);
  await screen.findByText('Shop 4');
  await fireEvent.press(screen.getByLabelText('Save / share QR poster (PNG)'));
  await waitFor(() => expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/handsome-queue-qr.png', expect.objectContaining({ mimeType: 'image/png' })));
  expect(mockCapture).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: 'png', fileName: 'handsome-center-queue-qr' }));
});

it('blocks the printable poster when the address cannot be loaded, like the website', async () => {
  serve('https://fastque.com/q/abc123', new Error('down'));
  await render(<PremiumQueueQr salonId="s1" salonName="Handsome Center" hindi={false} />);
  expect(await screen.findByText(/address could not be loaded/)).toBeTruthy();
  expect(screen.getByLabelText('Save / share QR poster (PNG)').props.accessibilityState.disabled).toBe(true);
});

it('never encodes a missing or non-web link', async () => {
  serve('javascript:alert(1)', { addressLine: 'Shop 4', postalCode: null });
  await render(<PremiumQueueQr salonId="s1" salonName="Handsome Center" hindi={false} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByTestId('qr-matrix')).toBeNull();
});

describe('premium QR helpers', () => {
  it('matches the website gradient end stops and address rule', () => {
    expect(nameGradientColor(0)).toBe('#ffe15c');
    expect(nameGradientColor(1)).toBe('#f20a83');
    expect(gradientCharacters('AB').map((c) => c.color)).toEqual(['#ffe15c', '#f20a83']);
    expect(formatQueueQrPrintAddress('Road 1, 560038', '560038')).toBe('Road 1, 560038');
    expect(formatQueueQrPrintAddress('  ', '1')).toBe('');
    expect(trustedQueueUrl(' https://a.b/q ')).toBe('https://a.b/q');
    expect(trustedQueueUrl('ftp://a')).toBeNull();
  });

  it('clears only a small centred block of modules for the mark', () => {
    const cleared = excavatedCells(49, { widthRatio: 46 / 200, heightRatio: 34 / 200 });
    expect(cleared.size).toBeGreaterThan(0);
    expect(cleared.size / (49 * 49)).toBeLessThan(0.06);
    expect(cleared.has(24 * 49 + 24)).toBe(true);
    expect(cleared.has(0)).toBe(false);
  });
});
