import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AUTH_PATHS, type AuthTokens, type MeResponse, type OtpVerifyInput } from '@barbercue/shared';
import {
  apiFetch,
  clearPersistedRefreshToken,
  getPersistedRefreshToken,
  persistRefreshToken,
  setAccessToken,
} from './api';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: MeResponse | null;
  status: AuthStatus;
  verifyCustomerOtp: (input: OtpVerifyInput) => Promise<MeResponse>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authPath(p: string): string {
  return `auth/${p}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // fetchMe never touches state itself — callers apply the result, mirroring apps/web/lib/auth-context.tsx.
  const fetchMe = useCallback(async (): Promise<MeResponse | null> => {
    const persisted = await getPersistedRefreshToken();
    if (!persisted) return null; // skip a doomed network round-trip when there's nothing to restore
    return apiFetch<MeResponse>(authPath(AUTH_PATHS.me)).catch(() => null);
  }, []);

  // "Restore session on app restart": apiFetch('auth/me') 401s (no access token in memory yet
  // after a fresh launch), which triggers apiFetch's built-in silent-refresh-and-retry using the
  // persisted refresh token — no separate restore code path needed.
  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      setUser(me);
      setStatus(me ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const verifyCustomerOtp = useCallback(async (input: OtpVerifyInput): Promise<MeResponse> => {
    const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.otpVerify), {
      method: 'POST',
      body: JSON.stringify(input),
    });
    setAccessToken(result.tokens.accessToken);
    await persistRefreshToken(result.tokens.refreshToken);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = await getPersistedRefreshToken();
    try {
      await apiFetch(authPath(AUTH_PATHS.logout), { method: 'POST', body: JSON.stringify({ refreshToken }) });
    } finally {
      setAccessToken(null);
      await clearPersistedRefreshToken();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, verifyCustomerOtp, logout }),
    [user, status, verifyCustomerOtp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
