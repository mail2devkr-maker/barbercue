"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, apiFetch, setAccessToken } from "../../../lib/api";
import { AuthCard } from "../../../components/auth/AuthCard";
import authStyles from "../../../components/auth/customer-auth.module.css";

/**
 * Where the backend sends an account that was issued a temporary password (error PASSWORD_CHANGE_REQUIRED). Until the
 * password is replaced the server refuses everything else, so this page is the only way forward. Changing it signs out
 * every session, so the person signs in again with the password they chose.
 */
export default function ChangePasswordRequiredPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!current) { setError("Enter the temporary password you were given."); return; }
    if (next.length < 8 || next.length > 72) { setError("Use 8 to 72 characters for your new password."); return; }
    if (next === current) { setError("Choose a password different from the temporary one."); return; }
    if (next !== confirm) { setError("The two new passwords do not match."); return; }
    setSubmitting(true);
    try {
      await apiFetch("auth/password/change-required", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setAccessToken(null);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard audience="recovery" title="Password changed" showAudienceLinks={false}>
        <p className={authStyles.successMessage} role="status">
          Your new password is set and every session was signed out. Sign in again with the new password.
        </p>
        <Link href="/owner/login" className={authStyles.primaryButton}>Go to owner sign-in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      audience="recovery"
      title="Choose your own password"
      subtitle="Your account was set up with a temporary password. You must replace it before you can use FastQue."
      showAudienceLinks={false}
    >
      <form onSubmit={submit} className={authStyles.form}>
        {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}
        <div className={authStyles.field}>
          <label htmlFor="temporary-password">Temporary password</label>
          <input id="temporary-password" type={show ? "text" : "password"} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={authStyles.input} autoFocus />
        </div>
        <div className={authStyles.field}>
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type={show ? "text" : "password"} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={authStyles.input} />
        </div>
        <div className={authStyles.field}>
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authStyles.input} />
        </div>
        <label className={authStyles.passwordToggle}>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show passwords
        </label>
        <p className={authStyles.contextLine}>The temporary password stops working as soon as you change it.</p>
        <button type="submit" className={authStyles.primaryButton} disabled={submitting}>
          {submitting ? "Changing…" : "Change password"}
        </button>
      </form>
    </AuthCard>
  );
}
