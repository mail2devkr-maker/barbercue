"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthErrorCode, adminGoogleLoginSchema, adminLoginSchema } from "@barbercue/shared";
import { ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import authStyles from "../../../../components/auth/customer-auth.module.css";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { GoogleIdentityButton } from "../../../../components/auth/GoogleIdentityButton";

function AdminLoginForm() {
  const { adminLogin, adminGoogleLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = adminLoginSchema.safeParse({ email, password, totpCode: totpCode || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setSubmitting(true);
    try {
      await adminLogin(parsed.data);
      router.replace(safeNextPath(searchParams.get("next")) ?? "/dashboard/admin");
    } catch (err) {
      if (err instanceof ApiError && err.code === AuthErrorCode.TOTP_REQUIRED) {
        setNeedsTotp(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else {
        setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle(idToken: string) {
    setError(null);
    setSubmitting(true);
    try {
      const parsed = adminGoogleLoginSchema.parse({ idToken });
      await adminGoogleLogin(parsed);
      router.replace(safeNextPath(searchParams.get("next")) ?? "/dashboard/admin");
    } catch (err) {
      if (err instanceof ApiError && err.code === AuthErrorCode.TOTP_REQUIRED) {
        setGoogleIdToken(idToken);
        setNeedsTotp(true);
        setError("Google was verified. Enter your authenticator code to finish signing in.");
      } else {
        setError(err instanceof ApiError ? err.message : "Google sign-in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleTotp(event: React.FormEvent) {
    event.preventDefault();
    if (!googleIdToken) return;
    setError(null);
    const parsed = adminGoogleLoginSchema.safeParse({ idToken: googleIdToken, totpCode });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid authenticator code.");
      return;
    }
    setSubmitting(true);
    try {
      await adminGoogleLogin(parsed.data);
      router.replace(safeNextPath(searchParams.get("next")) ?? "/dashboard/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      audience="admin"
      title="Platform admin sign in"
      subtitle="Restricted to existing BarberCue platform administrators. Google or password confirms your identity; your authenticator code is always required."
      showAudienceLinks={false}
    >
      <div className={authStyles.form}>
        {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}
        {!googleIdToken && (
          <GoogleIdentityButton
            onCredential={handleGoogle}
            audienceLabel="platform admin"
            disabled={submitting}
          />
        )}
        {!googleIdToken && <div className={authStyles.divider}>OR</div>}
        <form onSubmit={googleIdToken ? handleGoogleTotp : handleSubmit} className={authStyles.form}>
        {!googleIdToken && (
          <>
            <div className={authStyles.field}>
              <label htmlFor="admin-email">Email address</label>
              <input
                id="admin-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={authStyles.input}
                autoFocus
              />
            </div>
            <div className={authStyles.field}>
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={authStyles.input}
              />
            </div>
            <p className={authStyles.formFootnote}>
              <Link href="/forgot-password?audience=admin">Forgot password?</Link>
            </p>
          </>
        )}
        {needsTotp && (
          <div className={authStyles.field}>
            <label htmlFor="admin-totp">Authenticator code</label>
            <input
              id="admin-totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className={authStyles.input}
              autoFocus
            />
          </div>
        )}
        <button
          type="submit"
          className={authStyles.primaryButton}
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in securely"}
        </button>
        </form>
        {googleIdToken && (
          <button
            type="button"
            className={authStyles.secondaryButton}
            onClick={() => {
              setGoogleIdToken(null);
              setNeedsTotp(false);
              setTotpCode("");
              setError(null);
            }}
            disabled={submitting}
          >
            Use another sign-in method
          </button>
        )}
      </div>
    </AuthCard>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<AuthPageFallback audience="admin" />}>
      <AdminLoginForm />
    </Suspense>
  );
}
