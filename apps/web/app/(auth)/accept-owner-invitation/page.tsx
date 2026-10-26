"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, apiFetch } from "../../../lib/api";
import { AuthCard, AuthPageFallback } from "../../../components/auth/AuthCard";
import { readInvitationToken } from "../../../lib/invitation-token";
import authStyles from "../../../components/auth/customer-auth.module.css";

interface InvitationPreview {
  shopName: string;
  email: string;
  needsPassword: boolean;
  expiresAt: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; preview: InvitationPreview }
  | { kind: "done"; shopName: string };

/**
 * The single-use link FastQue e-mails to a person who is to become a shop's owner. Opening the link proves control of the
 * inbox; nothing changes until the person confirms here. A new address chooses its own password on this page - nobody
 * else ever sees it. An address that already has a verified FastQue account just confirms and keeps its password.
 */
export default function AcceptOwnerInvitationPage() {
  // The token lives in the URL fragment, so it never reaches a server log or a Referer header. It is read once, held in
  // memory only, and removed from the address bar and history straight away.
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Read after mount (a fragment does not exist during server rendering).
    void Promise.resolve().then(() => setToken(readInvitationToken()));
  }, []);

  useEffect(() => {
    let active = true;
    if (token === null) return () => { active = false; };
    if (token === "") {
      void Promise.resolve().then(() => {
        if (active) setPhase({ kind: "invalid", message: "This invitation link is incomplete. Open the link from the e-mail again." });
      });
      return () => { active = false; };
    }
    void Promise.resolve().then(async () => {
      try {
        const preview = await apiFetch<InvitationPreview>("auth/owner-invitations/inspect", { method: "POST", body: JSON.stringify({ token }) });
        if (active) setPhase({ kind: "ready", preview });
      } catch (err) {
        if (active) setPhase({ kind: "invalid", message: err instanceof ApiError ? err.message : "This invitation could not be checked. Try again." });
      }
    });
    return () => { active = false; };
  }, [token]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (phase.kind !== "ready") return;
    setError(null);
    if (phase.preview.needsPassword) {
      if (password.length < 8 || password.length > 72) { setError("Use 8 to 72 characters for your password."); return; }
      if (password !== confirm) { setError("The two passwords do not match."); return; }
    }
    setSubmitting(true);
    try {
      const result = await apiFetch<{ shopName: string }>("auth/owner-invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, ...(phase.preview.needsPassword ? { password } : {}) }),
      });
      setPassword("");
      setConfirm("");
      setPhase({ kind: "done", shopName: result.shopName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept the invitation. Nothing was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "loading") return <AuthPageFallback audience="recovery" />;

  if (phase.kind === "invalid") {
    return (
      <AuthCard audience="recovery" title="This invitation cannot be used" showAudienceLinks={false}>
        <p className={authStyles.errorMessage} role="alert">{phase.message}</p>
      </AuthCard>
    );
  }

  if (phase.kind === "done") {
    return (
      <AuthCard audience="recovery" title="You now own this shop" showAudienceLinks={false}>
        <p className={authStyles.successMessage} role="status">
          {phase.shopName} is now linked to your account. Sign in to manage it.
        </p>
        <Link href="/owner/login" className={authStyles.primaryButton}>Go to owner sign-in</Link>
      </AuthCard>
    );
  }

  const { preview } = phase;
  return (
    <AuthCard
      audience="recovery"
      title={`Take over ${preview.shopName}`}
      subtitle={`You were invited at ${preview.email} to become the owner of this shop on FastQue. Only continue if you expected this.`}
      showAudienceLinks={false}
    >
      <form onSubmit={submit} className={authStyles.form}>
        {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}
        {preview.needsPassword ? (
          <>
            <div className={authStyles.field}>
              <label htmlFor="invite-password">Choose your password</label>
              <input id="invite-password" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={authStyles.input} autoFocus />
            </div>
            <div className={authStyles.field}>
              <label htmlFor="invite-confirm">Confirm your password</label>
              <input id="invite-confirm" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authStyles.input} />
            </div>
            <label className={authStyles.passwordToggle}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Show passwords
            </label>
          </>
        ) : (
          <p className={authStyles.contextLine}>This e-mail already has a FastQue account. Your password stays as it is.</p>
        )}
        <p className={authStyles.contextLine}>This link works once. Accepting signs the previous owner account out of this shop.</p>
        <button type="submit" className={authStyles.primaryButton} disabled={submitting}>
          {submitting ? "Confirming…" : "Accept ownership"}
        </button>
      </form>
    </AuthCard>
  );
}
