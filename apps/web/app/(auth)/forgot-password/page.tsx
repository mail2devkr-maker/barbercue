"use client";

import { useState } from "react";
import { AUTH_PATHS, forgotPasswordSchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { AuthCard } from "../../../components/auth/AuthCard";
import authStyles from "../../../components/auth/customer-auth.module.css";

// Staff/owner/admin only — customers authenticate via OTP and have no password to reset.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid email.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<{ devResetUrl?: string }>(`auth/${AUTH_PATHS.forgotPassword}`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setSent(true);
      setDevResetUrl(result.devResetUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        audience="recovery"
        title="Check your email"
        subtitle="If that email belongs to a password account, the reset link will arrive shortly and expire in 15 minutes."
      >
        <p className={authStyles.successMessage} role="status">
          Your request has been processed. You can safely close this page after checking your inbox.
        </p>
        {devResetUrl && (
          <p className={authStyles.devMessage}>
            <strong>Development only</strong> (no email provider configured — see EmailSender in
            ARCHITECTURE.md §4):{" "}
            <a href={devResetUrl} className={authStyles.textLink}>{devResetUrl}</a>
          </p>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      audience="recovery"
      title="Reset your password"
      subtitle="For shop owner, barber/staff and administrator password accounts. Customer accounts use Google or phone sign-in."
    >
      <form onSubmit={handleSubmit} className={authStyles.form}>
        {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}
        <div className={authStyles.field}>
          <label htmlFor="recovery-email">Account email</label>
          <input
            id="recovery-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authStyles.input}
            autoFocus
          />
        </div>
        <button type="submit" className={authStyles.primaryButton} disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}
