/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { AuthProvider, useAuth } from '../auth-context';
import { getPersistedRefreshToken } from '../api';

jest.mock('../api', () => ({
  apiFetch: jest.fn(),
  clearPersistedRefreshToken: jest.fn().mockResolvedValue(undefined),
  getPersistedRefreshToken: jest.fn(),
  persistRefreshToken: jest.fn().mockResolvedValue(undefined),
  setAccessToken: jest.fn(),
}));

jest.mock('../push-notifications', () => ({
  unregisterCurrentPushDevice: jest.fn().mockResolvedValue(undefined),
}));

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

function Probe({ onStatus }: { onStatus: (status: AuthStatus) => void }) {
  const { status } = useAuth();
  onStatus(status);
  return null;
}

describe('AuthProvider startup restore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed to unauthenticated when secure credential restore rejects instead of hanging in loading', async () => {
    (getPersistedRefreshToken as jest.Mock).mockRejectedValue(new Error('KEYCHAIN_UNAVAILABLE'));
    const seen: AuthStatus[] = [];
    let tree: ReturnType<typeof TestRenderer.create> | undefined;

    await act(async () => {
      tree = TestRenderer.create(
        createElement(AuthProvider, null, createElement(Probe, { onStatus: (status) => seen.push(status) })),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(seen[0]).toBe('loading');
    expect(seen.at(-1)).toBe('unauthenticated');

    await act(async () => {
      tree?.unmount();
    });
  });
});
