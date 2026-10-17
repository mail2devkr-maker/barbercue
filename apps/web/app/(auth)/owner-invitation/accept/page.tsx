"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { OWNER_INVITATION_PATHS } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { Button } from "../../../../components/ui/Button";
import styles from "./invitation.module.css";

const STORAGE_KEY = "fastque-owner-invitation";

export default function OwnerInvitationAcceptancePage() {
  const { status, user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fragment = new URLSearchParams(
        window.location.hash.replace(/^#/, ""),
      );
      const fromLink = fragment.get("token");
      if (fromLink && /^[a-f0-9]{64}$/.test(fromLink)) {
        window.sessionStorage.setItem(STORAGE_KEY, fromLink);
        window.history.replaceState(null, "", window.location.pathname);
        setToken(fromLink);
      } else {
        setToken(window.sessionStorage.getItem(STORAGE_KEY));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setWorking(true);
    setError(null);
    try {
      if (status === "authenticated" && user) {
        await apiFetch(
          `${OWNER_INVITATION_PATHS.root}/${OWNER_INVITATION_PATHS.acceptExisting}`,
          {
            method: "POST",
            body: JSON.stringify({ token }),
          },
        );
      } else {
        if (password !== confirmation) {
          setError("Passwords do not match.");
          return;
        }
        await apiFetch(
          `${OWNER_INVITATION_PATHS.root}/${OWNER_INVITATION_PATHS.accept}`,
          {
            method: "POST",
            body: JSON.stringify({
              token,
              password,
              confirmPassword: confirmation,
            }),
          },
        );
      }
      window.sessionStorage.removeItem(STORAGE_KEY);
      setToken(null);
      setCompleted(true);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : "Could not accept this invitation.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>FastQue · Shop ownership</p>
        <h1>Accept owner invitation</h1>
        {completed ? (
          <>
            <p>
              Owner access is confirmed. Sign in again through Shop Owner Login
              to refresh your shop permissions.
            </p>
            <Link href="/owner/login">Shop Owner Login</Link>
          </>
        ) : !token ? (
          <p>
            This invitation link is missing or invalid. Ask the FastQue
            administrator to resend it.
          </p>
        ) : (
          <>
            <p>
              Accept only if you recognize the shop invitation sent to your
              email. Existing FastQue accounts must sign in to the same account
              before accepting.
            </p>
            {status === "loading" ? (
              <p>Checking your sign-in…</p>
            ) : (
              <form onSubmit={(event) => void accept(event)}>
                {status === "authenticated" && user ? (
                  <p className={styles.notice}>
                    Signed in. Confirming will attach this shop to your current
                    account only if it matches the invited account.
                  </p>
                ) : (
                  <>
                    <p>
                      New to FastQue? Set a password for the new owner account.
                      If you already have an account, sign in first.
                    </p>
                    <label htmlFor="invite-password">Password</label>
                    <input
                      id="invite-password"
                      type="password"
                      minLength={8}
                      maxLength={72}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <label htmlFor="invite-confirm">Confirm password</label>
                    <input
                      id="invite-confirm"
                      type="password"
                      minLength={8}
                      maxLength={72}
                      required
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                    <p className={styles.links}>
                      <Link href="/owner/login?next=%2Fowner-invitation%2Faccept">
                        Sign in as owner
                      </Link>{" "}
                      ·{" "}
                      <Link href="/login?next=%2Fowner-invitation%2Faccept">
                        Sign in to existing customer account
                      </Link>
                    </p>
                  </>
                )}
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={working}>
                  {working ? "Confirming…" : "Accept invitation"}
                </Button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
