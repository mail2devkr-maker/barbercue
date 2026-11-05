/// <reference types="jest" />
const mockShare = jest.fn();
let mockPlatformOS = 'ios';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get(target, property, receiver) {
      if (property === 'Platform') return { ...actual.Platform, OS: mockPlatformOS };
      if (property === 'Share') return { share: mockShare };
      return Reflect.get(target, property, receiver);
    },
  });
});
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///temporary/',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../api', () => ({ apiFetchResponse: jest.fn() }));

import * as FileSystem from 'expo-file-system/legacy';
import { apiFetchResponse } from '../api';
import { FileShareUnavailableError, shareOwnerFile } from '../owner-file-share';

function response(contentType: string, value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return {
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPlatformOS = 'ios';
  mockShare.mockResolvedValue({ action: 'sharedAction' });
});

it('shares an authenticated CSV from a sanitized temporary filename and removes the copy afterward', async () => {
  (apiFetchResponse as jest.Mock).mockResolvedValue(response('text/csv; charset=utf-8', 'day,total\n2026-10-28,10'));

  await shareOwnerFile({ kind: 'text', path: 'dashboard/salons/salon-1/revenue/report.csv', fileName: 'fastque-revenue-2026-10-01/28.csv', contentType: 'text/csv' });

  expect(apiFetchResponse).toHaveBeenCalledWith('dashboard/salons/salon-1/revenue/report.csv');
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    expect.stringMatching(/^file:\/\/\/temporary\/\d+-fastque-revenue-2026-10-01_28\.csv$/),
    'day,total\n2026-10-28,10',
    { encoding: 'utf8' },
  );
  expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({ title: 'fastque-revenue-2026-10-01_28.csv', url: expect.any(String) }));
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(expect.any(String), { idempotent: true });
});

it('validates the PDF signature before writing and sharing invoice bytes', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.4\nsynthetic invoice');
  (apiFetchResponse as jest.Mock).mockResolvedValue(response('application/pdf', pdf));

  await shareOwnerFile({ kind: 'pdf', path: 'dashboard/salons/salon-1/invoices/invoice-1/pdf', fileName: 'FQ-0001.pdf', contentType: 'application/pdf' });

  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(expect.any(String), 'JVBERi0xLjQKc3ludGhldGljIGludm9pY2U=', { encoding: 'base64' });
  expect(mockShare).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});

it('rejects unexpected file types and invalid PDF payloads without sharing', async () => {
  (apiFetchResponse as jest.Mock).mockResolvedValueOnce(response('application/json', '{"error":"no"}'));
  await expect(shareOwnerFile({ kind: 'pdf', path: 'invoice.pdf', fileName: 'invoice.pdf', contentType: 'application/pdf' })).rejects.toThrow('unexpected file type');
  (apiFetchResponse as jest.Mock).mockResolvedValueOnce(response('application/pdf', 'not a PDF'));
  await expect(shareOwnerFile({ kind: 'pdf', path: 'invoice.pdf', fileName: 'invoice.pdf', contentType: 'application/pdf' })).rejects.toThrow('not a valid PDF');
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
  expect(mockShare).not.toHaveBeenCalled();
});

it('does not fetch or share files on an unsupported platform build', async () => {
  mockPlatformOS = 'android';

  await expect(shareOwnerFile({ kind: 'text', path: 'revenue.csv', fileName: 'revenue.csv', contentType: 'text/csv' })).rejects.toBeInstanceOf(FileShareUnavailableError);

  expect(apiFetchResponse).not.toHaveBeenCalled();
  expect(mockShare).not.toHaveBeenCalled();
});

it('removes the temporary file when the native share sheet fails', async () => {
  (apiFetchResponse as jest.Mock).mockResolvedValue(response('text/csv', 'a,b'));
  mockShare.mockRejectedValueOnce(new Error('native share failure'));

  await expect(shareOwnerFile({ kind: 'text', path: 'revenue.csv', fileName: 'revenue.csv', contentType: 'text/csv' })).rejects.toThrow('native share failure');

  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});

it('surfaces a temporary-file cleanup failure instead of silently leaving a financial export behind', async () => {
  (apiFetchResponse as jest.Mock).mockResolvedValue(response('text/csv', 'a,b'));
  (FileSystem.deleteAsync as jest.Mock).mockRejectedValueOnce(new Error('cleanup failed'));

  await expect(shareOwnerFile({ kind: 'text', path: 'revenue.csv', fileName: 'revenue.csv', contentType: 'text/csv' })).rejects.toThrow('cleanup failed');

  expect(mockShare).toHaveBeenCalledTimes(1);
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1);
});
