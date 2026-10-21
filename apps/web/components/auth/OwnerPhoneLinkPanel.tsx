"use client";

import { useEffect, useState } from "react";
import {
  AUTH_PATHS,
  OTP_RESEND_COOLDOWN_SECONDS,
  Role,
  SessionAudience,
  otpRequestSchema,
  otpVerifySchema,
  type AuthMethodsDto,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import styles from "./customer-auth.module.css";
import dashboard from "../dashboard/dashboard.module.css";

/** An existing owner must be signed into their own STAFF account before changing its login phone. */
export function OwnerPhoneLinkPanel() {
  const { user, requestOwnerPhoneLinkOtp, verifyOwnerPhoneLink } = useAuth();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`)
      .then((methods) => {
        if (!cancelled) setAvailable(methods.ownerPhoneOtp === true);
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

  if (
    !user ||
    user.audience !== SessionAudience.STAFF ||
    !user.roles.includes(Role.SALON_OWNER)
  ) {
    return null;
  }

  if (available === null) {
    return (
      <p className={styles.contextLine} role="status">
        Checking mobile sign-in availability…
      </p>
    );
  }
  if (!available) {
    return (
      <section aria-labelledby="owner-phone-link-title" className={dashboard.dividerSection}>
        <h2 id="owner-phone-link-title" className={dashboard.sectionHeading}>Owner sign-in phone</h2>
        <p className={styles.contextLine} role="status">
          Mobile verification is temporarily unavailable. Your current sign-in
          methods are unchanged.
        </p>
      </section>
    );
  }

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
      await requestOwnerPhoneLinkOtp(parsed.data);
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
      const updatedUser = await verifyOwnerPhoneLink(parsed.data);
      setPhone(updatedUser.phone ?? parsed.data.phone);
      setStep("phone");
      setCode("");
      setSuccess(
        "Your verified sign-in number has been updated. Other refresh sessions were signed out.",
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
    <section aria-labelledby="owner-phone-link-title" className={dashboard.dividerSection}>
      <h2 id="owner-phone-link-title" className={dashboard.sectionHeading}>Owner sign-in phone</h2>
      <p className={styles.contextLine}>
        Verify a number you control to use it for future owner sign-ins. This
        changes your account login number, not your shop&apos;s public contact
        number. FastQue will never link a number already attached to another
        account.
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
      {step === "phone" ? (
        <form onSubmit={sendCode} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="owner-account-phone">Mobile number</label>
            <input
              id="owner-account-phone"
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
            <label htmlFor="owner-account-phone-otp">Verification code</label>
            <input
              id="owner-account-phone-otp"
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
