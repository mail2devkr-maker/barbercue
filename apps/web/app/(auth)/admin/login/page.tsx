"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthErrorCode, adminLoginSchema } from "@barbercue/shared";
import { ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import authStyles from "../../../../components/auth/customer-auth.module.css";
import { safeNextPath } from "../../../../lib/safe-next-path";

function AdminLoginForm() {
  const { adminLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
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

  return (
    <AuthCard
      audience="admin"
      title="Platform admin sign in"
      subtitle="Restricted to authorised BarberCue administrators. An authenticator code appears when your account requires it."
      showAudienceLinks={false}
    >
      <form onSubmit={handleSubmit} className={authStyles.form}>
        {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}
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
        <button type="submit" className={authStyles.primaryButton} disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in securely"}
        </button>
      </form>
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
