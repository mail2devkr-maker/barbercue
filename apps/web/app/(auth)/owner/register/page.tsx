"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ownerSignupSchema } from "@barbercue/shared";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import authStyles from "../../../../components/auth/customer-auth.module.css";
import { ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";

export default function OwnerRegisterPage() {
  const router = useRouter();
  const { ownerSignup, status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An already-authenticated customer can begin onboarding immediately; an existing owner can
  // also use the same route to register an additional shop. Never ask either one to create a
  // duplicate account.
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard/register-shop");
  }, [router, status]);

  if (status === "loading" || status === "authenticated") {
    return <AuthPageFallback audience="owner" />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = ownerSignupSchema.safeParse({ email, password, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your account details.");
      return;
    }

    setSubmitting(true);
    try {
      await ownerSignup(parsed.data);
      router.replace("/dashboard/register-shop");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      audience="owner"
      title="Create your account"
      subtitle="Create your FastQue owner account first. Your shop onboarding starts immediately after this step."
      showAudienceLinks={false}
    >
      {error && <p className={authStyles.errorMessage} role="alert">{error}</p>}

      <form onSubmit={submit} className={authStyles.form}>
        <div className={authStyles.field}>
          <label htmlFor="owner-signup-email">Email ID</label>
          <input
            id="owner-signup-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={authStyles.input}
            required
          />
        </div>

        <div className={authStyles.field}>
          <label htmlFor="owner-signup-password">Password</label>
          <input
            id="owner-signup-password"
            type={showPasswords ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={authStyles.input}
            required
          />
        </div>

        <div className={authStyles.field}>
          <label htmlFor="owner-signup-confirm-password">Re-enter password</label>
          <input
            id="owner-signup-confirm-password"
            type={showPasswords ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Enter the same password again"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={authStyles.input}
            required
          />
        </div>

        <label className={authStyles.contextLine} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={showPasswords}
            onChange={(event) => setShowPasswords(event.target.checked)}
          />
          Show passwords
        </label>

        <button type="submit" className={authStyles.primaryButton} disabled={submitting}>
          {submitting ? "Creating account…" : "Create account & continue"}
        </button>
      </form>

      <div className={authStyles.divider} aria-hidden="true">OR</div>
      <p className={authStyles.contextLine}>
        Already have a shop-owner account? <Link href="/owner/login">Sign in</Link>
      </p>
    </AuthCard>
  );
}
