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

import { getItem } from '../secure-storage';
import { reportNetworkFailure } from '../network-status';
import { apiFetch, apiFetchMultipart, setAccessToken } from '../api';

const getItemMock = getItem as jest.Mock;
const reportNetworkFailureMock = reportNetworkFailure as jest.Mock;
const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock;

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('apiFetchMultipart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setAccessToken('access-token-for-test');
    getItemMock.mockResolvedValue(null);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('dispatches a valid multipart upload request and keeps multipart headers runtime-owned', async () => {
    fetchMock.mockResolvedValue(response(200, { uploaded: true }));
    const bodyFactory = jest.fn(() => new FormData());

    await expect(apiFetchMultipart('dashboard/salons/s1/payment-qr/upload', { method: 'POST' }, bodyFactory)).resolves.toEqual({ uploaded: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyFactory).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBeInstanceOf(FormData);
    expect(new Headers(options.headers).get('content-type')).toBeNull();
  });

  it('rebuilds the multipart body after a successful access-token refresh', async () => {
    getItemMock.mockResolvedValue('refresh-token-for-test');
    fetchMock
      .mockResolvedValueOnce(response(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(response(201, { accessToken: 'refreshed-access-token', refreshToken: 'rotated-refresh-token' }))
      .mockResolvedValueOnce(response(200, { uploaded: true }));
    const bodies: FormData[] = [];
    const bodyFactory = jest.fn(() => {
      const body = new FormData();
      bodies.push(body);
      return body;
    });

    await expect(apiFetchMultipart('dashboard/salons/s1/payment-qr/upload', { method: 'POST' }, bodyFactory)).resolves.toEqual({ uploaded: true });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bodyFactory).toHaveBeenCalledTimes(2);
    expect(bodies[0]).not.toBe(bodies[1]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe(bodies[0]);
    expect((fetchMock.mock.calls[2][1] as RequestInit).body).toBe(bodies[1]);
    expect(new Headers((fetchMock.mock.calls[2][1] as RequestInit).headers).get('authorization')).toBe('Bearer refreshed-access-token');
  });

  it('does not map local multipart-body construction failures to NETWORK_OFFLINE', async () => {
    const bodyFactory = jest.fn(() => {
      throw new Error('cannot serialize local file');
    });

    await expect(apiFetchMultipart('dashboard/salons/s1/payment-qr/upload', { method: 'POST' }, bodyFactory)).rejects.toThrow('cannot serialize local file');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportNetworkFailureMock).not.toHaveBeenCalled();
  });

  it('keeps genuine transport failures mapped to the existing offline error', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(apiFetch('dashboard/salons/s1/payment-qr/upload', { method: 'POST', body: JSON.stringify({}) })).rejects.toMatchObject({
      code: 'NETWORK_OFFLINE',
      status: 0,
    });
    expect(reportNetworkFailureMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[api] transport request failed',
      expect.objectContaining({ error: 'Network request failed' }),
    );
    warnSpy.mockRestore();
  });

  it('surfaces server validation responses as ApiError instead of offline', async () => {
    fetchMock.mockResolvedValue(response(422, { error: { code: 'IMAGE_INVALID', message: 'That image is not valid.' } }));

    await expect(apiFetchMultipart('dashboard/salons/s1/payment-qr/upload', { method: 'POST' }, () => new FormData())).rejects.toEqual(
      expect.objectContaining({ code: 'IMAGE_INVALID', status: 422, message: 'That image is not valid.' }),
    );
    expect(reportNetworkFailureMock).not.toHaveBeenCalled();
  });
});
