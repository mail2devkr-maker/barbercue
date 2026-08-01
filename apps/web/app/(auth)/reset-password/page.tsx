"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AUTH_PATHS, resetPasswordSchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { AuthCard, authButtonStyle, authErrorStyle, authInputStyle } from "../../../components/auth/AuthCard";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = resetPasswordSchema.safeParse({ token, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`auth/${AUTH_PATHS.resetPassword}`, { method: "POST", body: JSON.stringify(parsed.data) });
      setDone(true);
      setTimeout(() => router.replace("/staff/login"), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "This reset link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Reset password">
        <p style={authErrorStyle}>This link is missing a reset token. Request a new one from the forgot-password page.</p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password updated">
        <p>You can now log in with your new password. Redirecting…</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset password">
      <form onSubmit={handleSubmit}>
        {error && <p style={authErrorStyle}>{error}</p>}
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={authInputStyle}
          autoFocus
        />
        <button type="submit" style={authButtonStyle} disabled={submitting}>
          {submitting ? "Updating..." : "Update password"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
