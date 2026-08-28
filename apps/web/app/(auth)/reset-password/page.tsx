"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AUTH_PATHS, resetPasswordSchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { AuthCard, AuthPageFallback } from "../../../components/auth/AuthCard";
import authStyles from "../../../components/auth/customer-auth.module.css";

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
      <AuthCard audience="recovery" title="This reset link is incomplete" showAudienceLinks={false}>
        <p className={authStyles.errorMessage} role="alert">
          This link is missing a reset token. Request a new link from the password recovery page.
        </p>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard audience="recovery" title="Password updated" showAudienceLinks={false}>
        <p className={authStyles.successMessage} role="status">
          You can now sign in with your new password. Taking you to staff sign-in…
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      audience="recovery"
      title="Choose a new password"
      subtitle="Set the new password for this owner, staff or administrator account."
      showAudienceLinks={false}
    >
      <form onSubmit={handleSubmit} className={authStyles.form}>
        {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}
        <div className={authStyles.field}>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="Enter a new password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={authStyles.input}
            autoFocus
          />
        </div>
        <button type="submit" className={authStyles.primaryButton} disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthPageFallback audience="recovery" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
