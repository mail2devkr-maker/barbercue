"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AUTH_PATHS, forgotPasswordSchema, passwordAudienceSchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { AuthCard, AuthPageFallback } from "../../../components/auth/AuthCard";
import authStyles from "../../../components/auth/customer-auth.module.css";

// Staff/owner/admin only — customers authenticate via OTP and have no password to reset.
const LOGIN_PATHS = { owner: "/owner/login", staff: "/staff/login", admin: "/admin/login" } as const;

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const audienceResult = passwordAudienceSchema.safeParse(searchParams.get("audience"));
  const audience = audienceResult.success ? audienceResult.data : "staff";
  const loginPath = LOGIN_PATHS[audience];
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email, audience });
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
        <p className={authStyles.formFootnote}>
          <Link href={loginPath}>Return to {audience} sign in</Link>
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
        <p className={authStyles.formFootnote}>
          <Link href={loginPath}>Back to {audience} sign in</Link>
        </p>
      </form>
    </AuthCard>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthPageFallback audience="recovery" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
