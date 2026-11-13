import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ContactsCheckPanel } from '../ContactsCheckPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(async () => ({ features: {} })), ApiError: class ApiError extends Error {} }));
const mockPick = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockPick(...a) }));
const mockRead = jest.fn();
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: (...a: unknown[]) => mockRead(...a), EncodingType: { UTF8: 'utf8' } }));
jest.mock('../../ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
  };
});

beforeEach(() => { mockPick.mockReset(); mockRead.mockReset(); });

it('reads a .vcf on the phone into the review box without sending anything', async () => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c.vcf', name: 'friends.vcf', size: 200 }] });
  mockRead.mockResolvedValue('BEGIN:VCARD\nFN:A\nTEL:+91 98765 43210\nEND:VCARD\nBEGIN:VCARD\nFN:B\nTEL:98111 22233\nEND:VCARD\n');
  await render(<ContactsCheckPanel salonId="s1" />);
  await fireEvent.press(screen.getByLabelText('Import a contacts file (.csv, .txt, .vcf)'));
  expect(await screen.findByText(/Read 2 numbers from friends.vcf/)).toBeTruthy();
  expect(String(screen.getByLabelText('Contact list').props.value).split('\n')).toHaveLength(2);
  expect((apiFetch as jest.Mock).mock.calls.some(([p]) => String(p).includes('/contacts/'))).toBe(false);
});

it('refuses unsupported or oversized files and leaves the box unchanged', async () => {
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///x.pdf', name: 'x.pdf', size: 10 }] });
  await render(<ContactsCheckPanel salonId="s1" />);
  await fireEvent.press(screen.getByLabelText('Import a contacts file (.csv, .txt, .vcf)'));
  expect(await screen.findByText(/That kind of file is not supported/)).toBeTruthy();
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///big.csv', name: 'big.csv', size: 600 * 1024 }] });
  await fireEvent.press(screen.getByLabelText('Import a contacts file (.csv, .txt, .vcf)'));
  expect(await screen.findByText(/larger than 512 KB/)).toBeTruthy();
  expect(mockRead).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Contact list').props.value).toBe('');
});
