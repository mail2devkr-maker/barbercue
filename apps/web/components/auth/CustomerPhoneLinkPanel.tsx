"use client";

import { useEffect, useState } from "react";
import {
  AUTH_PATHS,
  OTP_RESEND_COOLDOWN_SECONDS,
  SessionAudience,
  otpRequestSchema,
  otpVerifySchema,
  type AuthMethodsDto,
  type AuthTokens,
  type MeResponse,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import styles from "./customer-auth.module.css";

/** Existing identity-authenticated customers can prove and link a phone without account merging. */
export function CustomerPhoneLinkPanel() {
  const { user, applySession } = useAuth();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`)
      .then((methods) => {
        if (!cancelled) setAvailable(methods.phoneOtp === true);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  if (!user || user.audience !== SessionAudience.CUSTOMER) return null;

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setSuccess(null);
    const parsed = otpRequestSchema.safeParse({ phone: phone.trim() });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Enter a valid international phone number.",
      );
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`auth/${AUTH_PATHS.customerPhoneLinkRequest}`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setPhone(parsed.data.phone);
      setCode("");
      setStep("code");
      setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not send a verification code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const parsed = otpVerifySchema.safeParse({
      phone,
      code: code.replace(/\D/g, ""),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const result = await apiFetch<{
        user: MeResponse;
        tokens: AuthTokens;
      }>(`auth/${AUTH_PATHS.customerPhoneLinkVerify}`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      applySession(result);
      setPhone(result.user.phone ?? parsed.data.phone);
      setCode("");
      setStep("phone");
      setSuccess(
        "Your verified sign-in number is saved. Other refresh sessions were signed out.",
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not verify this number. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="customer-phone-link-title">
      <h2 id="customer-phone-link-title">Verified sign-in phone</h2>
      <p className={styles.contextLine}>
        Verify a number you control for future customer sign-ins. This updates
        only your account; it never links or merges another account based on a
        phone number.
      </p>
      {error && (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className={styles.successMessage} role="status">
          {success}
        </p>
      )}
      {available === null ? (
        <p className={styles.contextLine} role="status">
          Checking mobile sign-in availability…
        </p>
      ) : !available ? (
        <p className={styles.contextLine} role="status">
          Mobile verification is temporarily unavailable. Your current sign-in
          methods are unchanged.
        </p>
      ) : step === "phone" ? (
        <form onSubmit={sendCode} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="customer-account-phone">Mobile number</label>
            <input
              id="customer-account-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={styles.input}
              required
            />
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={busy}
          >
            {busy ? "Sending code…" : "Verify sign-in number"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className={styles.form}>
          <p className={styles.contextLine}>
            Enter the 6-digit code for {phone}. SMS delivery may take a moment.
          </p>
          <div className={styles.field}>
            <label htmlFor="customer-account-phone-otp">
              Verification code
            </label>
            <input
              id="customer-account-phone-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className={styles.input}
              required
            />
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={busy || code.length !== 6}
          >
            {busy ? "Verifying…" : "Confirm number"}
          </button>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <button
              type="button"
              className={styles.textLink}
              onClick={() => {
                setStep("phone");
                setCode("");
                setError(null);
              }}
              disabled={busy}
            >
              Change number
            </button>
            <button
              type="button"
              className={styles.textLink}
              onClick={() => void sendCode()}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
