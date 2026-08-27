"use client";

import { useState } from "react";
import { AUTH_PATHS, forgotPasswordSchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { AuthCard, authButtonStyle, authErrorStyle, authInputStyle } from "../../../components/auth/AuthCard";

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
      <AuthCard title="Check your email">
        <p>If that email is registered, we&apos;ve sent a password reset link. It expires in 15 minutes.</p>
        {devResetUrl && (
          <p style={{ marginTop: 16, fontSize: "0.8rem", color: "var(--bc-muted)", wordBreak: "break-all" }}>
            <strong>Development only</strong> (no email provider configured — see EmailSender in
            ARCHITECTURE.md §4):{" "}
            <a href={devResetUrl}>{devResetUrl}</a>
          </p>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Forgot password" subtitle="For salon owner, staff, and admin accounts only.">
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
        <button type="submit" style={authButtonStyle} disabled={submitting}>
          {submitting ? "Sending..." : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}
