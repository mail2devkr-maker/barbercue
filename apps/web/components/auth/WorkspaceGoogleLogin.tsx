"use client";

import { useState } from "react";
import type { MeResponse } from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api";
import { GoogleIdentityButton } from "./GoogleIdentityButton";
import styles from "./customer-auth.module.css";

export function WorkspaceGoogleLogin({
  audienceLabel,
  onSuccess,
}: {
  audienceLabel: "shop owner" | "barber or staff member";
  onSuccess: (user: MeResponse) => void;
}) {
  const { staffGoogleLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;

  async function handleCredential(idToken: string) {
    setError(null);
    setSubmitting(true);
    try {
      const user = await staffGoogleLogin({ idToken });
      onSuccess(user);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not sign in with Google. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      <GoogleIdentityButton
        audienceLabel={audienceLabel}
        onCredential={(token) => void handleCredential(token)}
        disabled={submitting}
      />
      <div className={styles.divider} aria-hidden="true">OR</div>
    </>
  );
}
