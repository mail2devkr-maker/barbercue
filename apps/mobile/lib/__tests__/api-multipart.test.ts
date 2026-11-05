jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { MULTIPART: 1 },
  uploadAsync: jest.fn(),
}));

jest.mock('../secure-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  deleteItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../network-status', () => ({
  reportNetworkFailure: jest.fn(),
  reportNetworkSuccess: jest.fn(),
}));

jest.mock('../current-language', () => ({
  getCurrentUiStrings: jest.fn(() => ({ networkOfflineMessage: 'You appear to be offline.' })),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { getItem, setItem } from '../secure-storage';
import { reportNetworkFailure, reportNetworkSuccess } from '../network-status';
import { getCurrentUiStrings } from '../current-language';
import { apiFetchResponse, apiUploadImage, NativeUploadError, setAccessToken } from '../api';

const uploadAsyncMock = FileSystem.uploadAsync as jest.Mock;
const getItemMock = getItem as jest.Mock;
const reportNetworkFailureMock = reportNetworkFailure as jest.Mock;
const reportNetworkSuccessMock = reportNetworkSuccess as jest.Mock;
const getCurrentUiStringsMock = getCurrentUiStrings as jest.Mock;
const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock;

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: jest.fn(() => 'application/octet-stream') },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

function uploadResponse(status: number, body: unknown) {
  return { status, body: body === undefined ? '' : JSON.stringify(body) };
}

describe('native image upload transport', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken('access-token-for-test');
    getItemMock.mockResolvedValue(null);
    getCurrentUiStringsMock.mockReturnValue({ networkOfflineMessage: 'You appear to be offline.' });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('dispatches native multipart with the image field, MIME, parameters, and bearer token', async () => {
    uploadAsyncMock.mockResolvedValue(uploadResponse(200, { uploaded: true }));

    await expect(
      apiUploadImage(
        'dashboard/salons/s1/payment-qr/upload',
        { uri: 'file:///cache/qr.png', name: 'payment-qr.png', type: 'image/png' },
        { type: 'GALLERY' },
      ),
    ).resolves.toEqual({ uploaded: true });

    expect(uploadAsyncMock).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/salons/s1/payment-qr/upload'),
      'file:///cache/qr.png',
      expect.objectContaining({
        httpMethod: 'POST',
        uploadType: 1,
        fieldName: 'image',
        mimeType: 'image/png',
        parameters: { type: 'GALLERY' },
        headers: { Authorization: 'Bearer access-token-for-test' },
      }),
    );
    const options = uploadAsyncMock.mock.calls[0][2] as Record<string, unknown>;
    expect(options).not.toHaveProperty('Content-Type');
    expect(options).not.toHaveProperty('content-type');
  });

  it('refreshes once and retries native multipart with the same local file and rotated token', async () => {
    uploadAsyncMock
      .mockResolvedValueOnce(uploadResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(uploadResponse(200, { uploaded: true }));
    getItemMock.mockResolvedValue('refresh-token-for-test');
    fetchMock.mockResolvedValue(response(201, { accessToken: 'refreshed-access-token', refreshToken: 'rotated-refresh-token' }));

    await expect(
      apiUploadImage('dashboard/salons/s1/payment-qr/upload', {
        uri: 'file:///cache/qr.png',
        name: 'payment-qr.png',
        type: 'image/png',
      }),
    ).resolves.toEqual({ uploaded: true });

    expect(uploadAsyncMock).toHaveBeenCalledTimes(2);
    expect(uploadAsyncMock.mock.calls[0][1]).toBe(uploadAsyncMock.mock.calls[1][1]);
    expect(uploadAsyncMock.mock.calls[0][2].headers).toEqual({ Authorization: 'Bearer access-token-for-test' });
    expect(uploadAsyncMock.mock.calls[1][2].headers).toEqual({ Authorization: 'Bearer refreshed-access-token' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces native upload failure as an upload error when an ordinary backend probe succeeds', async () => {
    uploadAsyncMock.mockRejectedValue(new Error('native file serialization failed'));
    fetchMock.mockResolvedValue(response(401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }));

    await expect(
      apiUploadImage('dashboard/salons/s1/payment-qr/upload', {
        uri: 'file:///cache/qr.png',
        name: 'payment-qr.png',
        type: 'image/png',
      }),
    ).rejects.toBeInstanceOf(NativeUploadError);
    expect(reportNetworkFailureMock).not.toHaveBeenCalled();
    expect(reportNetworkSuccessMock).toHaveBeenCalledTimes(1);
  });

  it('keeps genuine native transport failure as NETWORK_OFFLINE when the backend probe fails', async () => {
    uploadAsyncMock.mockRejectedValue(new Error('network request failed'));
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    await expect(
      apiUploadImage('dashboard/salons/s1/payment-qr/upload', {
        uri: 'file:///cache/qr.png',
        name: 'payment-qr.png',
        type: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_OFFLINE', status: 0 });
    expect(reportNetworkFailureMock).toHaveBeenCalledTimes(1);
  });

  it('preserves backend validation codes/messages from native HTTP responses', async () => {
    uploadAsyncMock.mockResolvedValue(
      uploadResponse(422, { error: { code: 'IMAGE_INVALID', message: 'That image is not valid.' } }),
    );

    await expect(
      apiUploadImage('dashboard/salons/s1/payment-qr/upload', {
        uri: 'file:///cache/qr.png',
        name: 'payment-qr.png',
        type: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_INVALID', status: 422, message: 'That image is not valid.' });
    expect(reportNetworkFailureMock).not.toHaveBeenCalled();
  });
});

describe('authenticated file response transport', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken('access-token-for-test');
    getItemMock.mockResolvedValue(null);
  });

  it('returns successful binary responses without parsing or logging file content', async () => {
    const fileResponse = response(200, undefined);
    fetchMock.mockResolvedValue(fileResponse);

    await expect(apiFetchResponse('dashboard/salons/s1/invoices/i1/pdf')).resolves.toBe(fileResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/dashboard/salons/s1/invoices/i1/pdf'),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('refreshes once and retries an owner-authorized file request', async () => {
    const fileResponse = response(200, undefined);
    fetchMock
      .mockResolvedValueOnce(response(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(response(201, { accessToken: 'refreshed-access-token', refreshToken: 'rotated-refresh-token' }))
      .mockResolvedValueOnce(fileResponse);
    getItemMock.mockResolvedValue('refresh-token-for-test');

    await expect(apiFetchResponse('dashboard/salons/s1/revenue/report.csv')).resolves.toBe(fileResponse);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(setItem).toHaveBeenCalledWith('barbercue_refresh_token', 'rotated-refresh-token');
  });

  it('uses normal API error codes for denied file access', async () => {
    fetchMock.mockResolvedValue(response(403, { error: { code: 'FORBIDDEN', message: 'Shop access denied.' } }));

    await expect(apiFetchResponse('dashboard/salons/other/invoices/i1/pdf')).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403, message: 'Shop access denied.',
    });
  });
});
