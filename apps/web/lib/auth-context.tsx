"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AUTH_PATHS,
  type AdminLoginInput,
  type AuthTokens,
  type GoogleLoginInput,
  type MeResponse,
  type OtpVerifyInput,
  type StaffLoginInput,
} from "@barbercue/shared";
import { apiFetch, setAccessToken } from "./api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: MeResponse | null;
  status: AuthStatus;
  verifyCustomerOtp: (input: OtpVerifyInput) => Promise<MeResponse>;
  googleLogin: (input: GoogleLoginInput) => Promise<MeResponse>;
  staffLogin: (input: StaffLoginInput) => Promise<MeResponse>;
  staffGoogleLogin: (input: GoogleLoginInput) => Promise<MeResponse>;
  adminLogin: (input: AdminLoginInput) => Promise<MeResponse>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  // Rotates the refresh token to mint a fresh access token, then reloads /auth/me — unlike
  // refreshMe() alone, this picks up ROLE changes that happened server-side after the current
  // access token was issued (e.g. just-completed shop registration granting SALON_OWNER), since
  // TokenService.rotateRefreshToken re-reads roles from the DB on every rotation.
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authPath(p: string): string {
  return `auth/${p}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // fetchMe never touches state itself — the effect below and refreshMe() each apply the result
  // to state in their own `.then()`, which is what keeps the mount effect's setState calls
  // directly (textually) inside the effect body rather than hidden behind an external callback.
  const fetchMe = useCallback((): Promise<MeResponse | null> => {
    return apiFetch<MeResponse>(authPath(AUTH_PATHS.me)).catch(() => null);
  }, []);

  // On mount: apiFetch('auth/me') will 401 (no access token in memory yet after a page reload),
  // which triggers apiFetch's built-in silent-refresh-and-retry using the httpOnly cookie — this
  // is "restore session on app restart" for web, with no separate code path needed.
  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      setUser(me);
      setStatus(me ? "authenticated" : "unauthenticated");
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    setUser(me);
    setStatus(me ? "authenticated" : "unauthenticated");
  }, [fetchMe]);

  const handleAuthResult = useCallback((result: { user: MeResponse; tokens: AuthTokens }) => {
    setAccessToken(result.tokens.accessToken);
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const verifyCustomerOtp = useCallback(
    async (input: OtpVerifyInput) => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.otpVerify), {
        method: "POST",
        body: JSON.stringify(input),
      });
      return handleAuthResult(result);
    },
    [handleAuthResult],
  );

  const googleLogin = useCallback(
    async (input: GoogleLoginInput) => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.google), {
        method: "POST",
        body: JSON.stringify(input),
      });
      return handleAuthResult(result);
    },
    [handleAuthResult],
  );

  const staffLogin = useCallback(
    async (input: StaffLoginInput) => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.staffLogin), {
        method: "POST",
        body: JSON.stringify(input),
      });
      return handleAuthResult(result);
    },
    [handleAuthResult],
  );

  const staffGoogleLogin = useCallback(
    async (input: GoogleLoginInput) => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.staffGoogle), {
        method: "POST",
        body: JSON.stringify(input),
      });
      return handleAuthResult(result);
    },
    [handleAuthResult],
  );

  const adminLogin = useCallback(
    async (input: AdminLoginInput) => {
      const result = await apiFetch<{ user: MeResponse; tokens: AuthTokens }>(authPath(AUTH_PATHS.adminLogin), {
        method: "POST",
        body: JSON.stringify(input),
      });
      return handleAuthResult(result);
    },
    [handleAuthResult],
  );

  const refreshSession = useCallback(async () => {
    const tokens = await apiFetch<AuthTokens>(authPath(AUTH_PATHS.refresh), {
      method: "POST",
      body: "{}",
    });
    setAccessToken(tokens.accessToken);
    await refreshMe();
  }, [refreshMe]);

  const logout = useCallback(async () => {
    try {
      await apiFetch(authPath(AUTH_PATHS.logout), { method: "POST", body: "{}" });
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      verifyCustomerOtp,
      googleLogin,
      staffLogin,
      staffGoogleLogin,
      adminLogin,
      logout,
      refreshMe,
      refreshSession,
    }),
    [user, status, verifyCustomerOtp, googleLogin, staffLogin, staffGoogleLogin, adminLogin, logout, refreshMe, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
