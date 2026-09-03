"use client";

import { useState } from "react";
import { initialPasswordSchema } from "@barbercue/shared";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import styles from "./customer-auth.module.css";

export function InitialPasswordSetup({ onComplete }: { onComplete: () => void }) {
  const { setInitialPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = initialPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your password.");
      return;
    }
    setSubmitting(true);
    try {
      await setInitialPassword(parsed.data);
      onComplete();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Password setup failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="owner-password-title">
      <p className={styles.audienceLabel}>Secure your owner access</p>
      <h2 id="owner-password-title" className={styles.formTitle}>Create your password</h2>
      <p className={styles.formSubtitle}>
        Keep Google sign-in and add email-and-password access to this same FastQue account.
      </p>
      <form className={styles.form} onSubmit={submit}>
        {error && <p className={styles.errorMessage} role="alert">{error}</p>}
        <div className={styles.field}>
          <label htmlFor="owner-initial-password">Create password</label>
          <input
            id="owner-initial-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={styles.input}
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="owner-confirm-password">Confirm password</label>
          <input
            id="owner-confirm-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={styles.input}
          />
        </div>
        <label className={styles.passwordToggle}>
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />
          Show passwords
        </label>
        <p className={styles.contextLine}>Use 8–72 characters. You can change it later through secure password recovery.</p>
        <button className={styles.primaryButton} type="submit" disabled={submitting}>
          {submitting ? "Securing account…" : "Create password & continue"}
        </button>
      </form>
    </section>
  );
}
