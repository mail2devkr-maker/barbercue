import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTH_PATHS,
  type AuthTokens,
  type GoogleLoginInput,
  type MeResponse,
  type OtpVerifyInput,
  type StaffLoginInput,
} from '@barbercue/shared';
import {
  apiFetch,
  clearPersistedRefreshToken,
  getPersistedRefreshToken,
  persistRefreshToken,
  setAccessToken,
} from './api';
import { unregisterPushDevice } from './push-notifications';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: MeResponse | null;
  status: AuthStatus;
  verifyCustomerOtp: (input: OtpVerifyInput) => Promise<MeResponse>;
  googleLogin: (input: GoogleLoginInput) => Promise<MeResponse>;
  // Same POST auth/staff/login endpoint web's own /owner/login and /staff/login pages call —
  // it accepts either SALON_OWNER or SALON_STAFF accounts and returns MeResponse.roles, which
  // callers use to route to the right shell. Not customer-facing; never exposed from the
  // customer login screen.
  staffLogin: (input: StaffLoginInput) => Promise<MeResponse>;
  // Same POST auth/staff/google contract as staffLogin above, but via Google Sign-In — verified
  // server-side, restricted to accounts that already hold SALON_OWNER/SALON_STAFF (see
  // auth.service.ts's staffGoogleLogin doc comment). Never creates a user, never elevates a
  // customer-only account. Reuses the exact same GoogleOneTapSignIn flow the customer login
  // screen uses to obtain the ID token — this method only differs in which backend endpoint the
  // token is sent to.
  staffGoogleLogin: (input: GoogleLoginInput) => Promise<MeResponse>;
  logout: () => Promise<void>;
  // Reloads auth/me and applies the result to state — used after a change that doesn't rotate
  // tokens (e.g. PATCH auth/language), mirroring apps/web/lib/auth-context.tsx's own refreshMe.
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authPath(p: string): string {
  return `auth/${p}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  // A mount-time auth/me restore can finish after a login succeeds. Without a mutation version,
  // that stale null result can overwrite the authenticated state and make ordinary navigation
  // (including returning Home) look like a logout.
  const authMutationVersionRef = useRef(0);

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
    const startedAtVersion = authMutationVersionRef.current;
    fetchMe().then((me) => {
      if (cancelled || authMutationVersionRef.current !== startedAtVersion) return;
      setUser(me);
      setStatus(me ? 'authenticated' : 'unauthenticated');
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const refreshMe = useCallback(async () => {
    const startedAtVersion = ++authMutationVersionRef.current;
    const me = await fetchMe();
    if (authMutationVersionRef.current !== startedAtVersion) return;
    setUser(me);
    setStatus(me ? 'authenticated' : 'unauthenticated');
  }, [fetchMe]);

  const applyAuthResult = useCallback(async (result: { user: MeResponse; tokens: AuthTokens }) => {
    authMutationVersionRef.current += 1;
    setAccessToken(result.tokens.accessToken);
    await persistRefreshToken(result.tokens.refreshToken);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const verifyCustomerOtp = useCallback(
    async (input: OtpVerifyInput): Promise<MeResponse> => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.otpVerify), {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return applyAuthResult(result);
    },
    [applyAuthResult],
  );

  const googleLogin = useCallback(
    async (input: GoogleLoginInput): Promise<MeResponse> => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.google), {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return applyAuthResult(result);
    },
    [applyAuthResult],
  );

  const staffGoogleLogin = useCallback(
    async (input: GoogleLoginInput): Promise<MeResponse> => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.staffGoogle), {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return applyAuthResult(result);
    },
    [applyAuthResult],
  );

  const staffLogin = useCallback(
    async (input: StaffLoginInput): Promise<MeResponse> => {
      // twoFactorRequired is always false in V1 (reserved for a future admin-style TOTP step on
      // staff/owner accounts — see auth.service.ts) — every successful call already returns full
      // tokens, so there is nothing else to branch on here.
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens; twoFactorRequired: boolean }>(
        authPath(AUTH_PATHS.staffLogin),
        { method: 'POST', body: JSON.stringify(input) },
      );
      return applyAuthResult(result);
    },
    [applyAuthResult],
  );

  const logout = useCallback(async () => {
    authMutationVersionRef.current += 1;
    const refreshToken = await getPersistedRefreshToken();
    try {
      await unregisterPushDevice().catch(() => {
        // Best effort only: logout/session revocation remains authoritative even while offline.
      });
      await apiFetch(authPath(AUTH_PATHS.logout), { method: 'POST', body: JSON.stringify({ refreshToken }) });
    } finally {
      setAccessToken(null);
      await clearPersistedRefreshToken();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, verifyCustomerOtp, googleLogin, staffLogin, staffGoogleLogin, logout, refreshMe }),
    [user, status, verifyCustomerOtp, googleLogin, staffLogin, staffGoogleLogin, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
