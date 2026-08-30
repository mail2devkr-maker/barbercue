"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { AuthErrorCode, adminGoogleLoginSchema, adminLoginSchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import authStyles from "../../../../components/auth/customer-auth.module.css";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { GoogleIdentityButton } from "../../../../components/auth/GoogleIdentityButton";

type TotpSetup = {
  otpAuthUri: string;
  manualKey: string;
};

function AdminLoginForm() {
  const { adminLogin, adminGoogleLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
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
      } else if (err instanceof ApiError && err.code === AuthErrorCode.TOTP_SETUP_REQUIRED) {
        setError("Authenticator setup is required. Use Continue with Google once to securely enroll this admin account.");
      } else {
        setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function startTotpSetup(idToken: string) {
    const setup = await apiFetch<TotpSetup>("auth/admin/totp/setup", {
      method: "POST",
      body: JSON.stringify({ idToken }),
    });
    setGoogleIdToken(idToken);
    setTotpSetup(setup);
    setNeedsTotp(true);
    setError(null);
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
        setTotpSetup(null);
        setNeedsTotp(true);
        setError("Google was verified. Enter your authenticator code to finish signing in.");
      } else if (err instanceof ApiError && err.code === AuthErrorCode.TOTP_SETUP_REQUIRED) {
        try {
          await startTotpSetup(idToken);
        } catch (setupErr) {
          setError(setupErr instanceof ApiError ? setupErr.message : "Authenticator setup could not be started. Please try again.");
        }
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
      if (totpSetup) {
        await apiFetch<{ success: true }>("auth/admin/totp/confirm", {
          method: "POST",
          body: JSON.stringify({ idToken: googleIdToken, code: totpCode }),
        });
      }
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

        {totpSetup && (
          <div className={authStyles.field}>
            <strong>Set up Google Authenticator</strong>
            <p className={authStyles.formFootnote}>
              Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy, or another TOTP app. Then enter the 6-digit code below.
            </p>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px", background: "#fff", borderRadius: "12px" }}>
              <QRCodeSVG value={totpSetup.otpAuthUri} size={176} level="M" />
            </div>
            <p className={authStyles.formFootnote}>Can&apos;t scan it? Enter this setup key manually:</p>
            <code style={{ display: "block", overflowWrap: "anywhere", padding: "10px", borderRadius: "8px", background: "rgba(0,0,0,0.05)", userSelect: "all" }}>
              {totpSetup.manualKey}
            </code>
            <p className={authStyles.formFootnote}>
              Keep this key private. After the first successful code, normal admin sign-in will always require your authenticator code.
            </p>
          </div>
        )}

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
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
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
          {submitting ? "Signing in…" : totpSetup ? "Verify authenticator & sign in" : "Sign in securely"}
        </button>
        </form>
        {googleIdToken && (
          <button
            type="button"
            className={authStyles.secondaryButton}
            onClick={() => {
              setGoogleIdToken(null);
              setNeedsTotp(false);
              setTotpSetup(null);
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
