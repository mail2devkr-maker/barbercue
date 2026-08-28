"use client";

import { useState } from "react";
import Link from "next/link";
import { staffLoginSchema } from "@barbercue/shared";
import { ApiError } from "../../lib/api";
import styles from "./customer-auth.module.css";

/** Owner and staff routes deliberately retain the same email/password auth operation. */
export function EmailPasswordLoginForm({
  onSubmit,
  forgotPasswordHref,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<void>;
  forgotPasswordHref: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = staffLoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid email or password.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      <div className={styles.field}>
        <label htmlFor="workspace-email">Email address</label>
        <input
          id="workspace-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
          autoFocus
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="workspace-password">Password</label>
        <input
          id="workspace-password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={styles.input}
        />
      </div>
      <button type="submit" className={styles.primaryButton} disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in to workspace"}
      </button>
      <p className={styles.formFootnote}>
        <Link href={forgotPasswordHref}>Forgot your password?</Link>
      </p>
    </form>
  );
}
