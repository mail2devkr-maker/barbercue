"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthErrorCode, adminLoginSchema } from "@barbercue/shared";
import { ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, authButtonStyle, authErrorStyle, authInputStyle } from "../../../../components/auth/AuthCard";
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
    <AuthCard title="Platform admin login" subtitle="Email, password, and authenticator code required.">
      <form onSubmit={handleSubmit}>
        {error && <p style={authErrorStyle}>{error}</p>}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={authInputStyle}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={authInputStyle}
        />
        {needsTotp && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit authenticator code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            style={authInputStyle}
            autoFocus
          />
        )}
        <button type="submit" style={authButtonStyle} disabled={submitting}>
          {submitting ? "Logging in..." : "Log in"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginForm />
    </Suspense>
  );
}
