jest.mock('../api', () => ({
  apiFetch: jest.fn(),
  clearPersistedRefreshToken: jest.fn().mockResolvedValue(undefined),
  getPersistedRefreshToken: jest.fn().mockResolvedValue(null),
  persistRefreshToken: jest.fn().mockResolvedValue(undefined),
  setAccessToken: jest.fn(),
}));

jest.mock('../push-notifications', () => ({ unregisterCurrentPushDevice: jest.fn().mockResolvedValue(undefined) }));

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { Language, Role, SessionAudience, type MeResponse } from '@barbercue/shared';
import {
  apiFetch,
  clearPersistedRefreshToken,
  getPersistedRefreshToken,
  persistRefreshToken,
  setAccessToken,
} from '../api';
import { AuthProvider, useAuth } from '../auth-context';
import { getAuthenticatedDestination } from '../auth-routing';

const apiFetchMock = apiFetch as jest.Mock;
const getPersistedRefreshTokenMock = getPersistedRefreshToken as jest.Mock;
const clearPersistedRefreshTokenMock = clearPersistedRefreshToken as jest.Mock;
const persistRefreshTokenMock = persistRefreshToken as jest.Mock;
const setAccessTokenMock = setAccessToken as jest.Mock;

const employee: MeResponse = {
  id: 'employee-user',
  roles: [Role.FIELD_EXECUTIVE],
  audience: SessionAudience.EMPLOYEE,
  phone: null,
  email: null,
  preferredLanguage: Language.EN,
  passwordConfigured: true,
};

const tokens = { accessToken: 'employee-access', refreshToken: 'employee-refresh' };

describe('AuthProvider employee login', () => {
  let current: ReturnType<typeof useAuth> | null;

  function Probe() {
    current = useAuth();
    return null;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    current = null;
    apiFetchMock.mockReset();
  });

  it('uses the dedicated endpoint, normalizes the Employee ID, and stores only an EMPLOYEE session', async () => {
    apiFetchMock.mockResolvedValueOnce({ user: employee, tokens });
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(current?.status).toBe('unauthenticated'));

    await act(async () => {
      await current!.employeeLogin({ employeeCode: 'fq-fe-00101', password: 'valid-password' });
    });

    expect(apiFetchMock).toHaveBeenCalledWith('auth/employee/login', {
      method: 'POST',
      body: JSON.stringify({ employeeCode: 'FQ-FE-00101', password: 'valid-password' }),
    });
    expect(current?.user).toEqual(employee);
    expect(setAccessTokenMock).toHaveBeenCalledWith(tokens.accessToken);
    expect(persistRefreshTokenMock).toHaveBeenCalledWith(tokens.refreshToken);
  });

  it('refuses a response with the wrong audience and revokes its refresh token without persisting it', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ user: { ...employee, audience: SessionAudience.STAFF }, tokens })
      .mockResolvedValueOnce(undefined);
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(current?.status).toBe('unauthenticated'));

    await expect(current!.employeeLogin({ employeeCode: 'FQ-FE-00101', password: 'valid-password' }))
      .rejects.toThrow('Employee access could not be verified');

    expect(apiFetchMock).toHaveBeenNthCalledWith(2, 'auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect(setAccessTokenMock).not.toHaveBeenCalled();
    expect(persistRefreshTokenMock).not.toHaveBeenCalled();
    expect(current?.status).toBe('unauthenticated');
  });

  it('rejects an owner/staff role and does not store its tokens', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ user: { ...employee, roles: [Role.SALON_STAFF] }, tokens })
      .mockResolvedValueOnce(undefined);
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(current?.status).toBe('unauthenticated'));

    await expect(current!.employeeLogin({ employeeCode: 'FQ-FE-00101', password: 'valid-password' }))
      .rejects.toThrow('Employee access could not be verified');
    expect(persistRefreshTokenMock).not.toHaveBeenCalled();
  });

  it('rejects malformed credentials before making a network request', async () => {
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(current?.status).toBe('unauthenticated'));

    await expect(current!.employeeLogin({ employeeCode: 'x', password: 'short' })).rejects.toThrow();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('restores an employee session through the existing auth/me refresh path after app restart', async () => {
    getPersistedRefreshTokenMock.mockResolvedValueOnce('persisted-employee-refresh');
    apiFetchMock.mockResolvedValueOnce(employee);
    await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(current?.status).toBe('authenticated'));
    expect(apiFetchMock).toHaveBeenCalledWith('auth/me');
    expect(current?.user).toEqual(employee);
    expect(getAuthenticatedDestination(current!.user!)).toBe('employee');
  });

  it('revokes and clears the persisted employee session on logout', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ user: employee, tokens })
      .mockResolvedValueOnce(undefined);
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(current?.status).toBe('unauthenticated'));

    await act(async () => {
      await current!.employeeLogin({ employeeCode: 'FQ-FE-00101', password: 'valid-password' });
    });
    getPersistedRefreshTokenMock.mockResolvedValueOnce(tokens.refreshToken);
    await act(async () => {
      await current!.logout();
    });

    expect(apiFetchMock).toHaveBeenLastCalledWith('auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect(setAccessTokenMock).toHaveBeenLastCalledWith(null);
    expect(clearPersistedRefreshTokenMock).toHaveBeenCalledTimes(1);
    expect(current?.user).toBeNull();
    expect(current?.status).toBe('unauthenticated');
  });
});
