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
  type MeResponse,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import styles from "./customer-auth.module.css";

type Mode = "existing-owner" | "new-owner";

export function OwnerPhoneOtpPanel({
  mode,
  onSuccess,
}: {
  mode: Mode;
  onSuccess: (user: MeResponse) => void;
}) {
  const { requestOwnerOtp, verifyOwnerOtp, verifyCustomerOtp, logout } = useAuth();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`)
      .then((methods) => {
        if (!cancelled)
          setAvailable(
            // A backend older than the owner OTP routes sends no `ownerPhoneOtp`: that is "not available".
            mode === "existing-owner"
              ? methods.ownerPhoneOtp === true
              : methods.phoneOtp === true,
          );
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    const parsed = otpRequestSchema.safeParse({ phone: phone.trim() });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Enter a valid phone number in international format.",
      );
      return;
    }
    setBusy(true);
    try {
      if (mode === "existing-owner") await requestOwnerOtp(parsed.data);
      else
        await apiFetch(`auth/${AUTH_PATHS.otpRequest}`, {
          method: "POST",
          body: JSON.stringify(parsed.data),
        });
      setPhone(parsed.data.phone);
      setStep("code");
      setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not send a verification code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
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
      const user =
        mode === "existing-owner"
          ? await verifyOwnerOtp(parsed.data)
          : await verifyCustomerOtp(parsed.data);
      // The server issues a STAFF session carrying SALON_OWNER for this route. Anything else is not an owner sign-in:
      // end the session it just opened rather than carry on as a different kind of account.
      if (mode === "existing-owner" && !(user.audience === SessionAudience.STAFF && user.roles.includes(Role.SALON_OWNER))) {
        await logout().catch(() => undefined);
        setError("This number is not linked to a shop-owner account. Use another sign-in option.");
        setCode("");
        return;
      }
      onSuccess(user);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not verify the code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (available === null)
    return (
      <p className={styles.contextLine}>
        Checking mobile sign-in availability…
      </p>
    );
  if (!available) {
    return (
      <p className={styles.contextLine} role="status">
        Mobile verification is temporarily unavailable. Continue with an
        existing sign-in option.
      </p>
    );
  }

  return (
    <section aria-label="Mobile number sign-in">
      {error && (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      )}
      {step === "phone" ? (
        <form onSubmit={sendCode} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor={`owner-phone-${mode}`}>Mobile number</label>
            <input
              id={`owner-phone-${mode}`}
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
            {busy ? "Sending code…" : "Continue with mobile number"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className={styles.form}>
          <p className={styles.contextLine}>
            Enter the 6-digit code for {phone}. SMS delivery may take a moment.
          </p>
          <div className={styles.field}>
            <label htmlFor={`owner-otp-${mode}`}>Verification code</label>
            <input
              id={`owner-otp-${mode}`}
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
            {busy
              ? "Verifying…"
              : mode === "existing-owner"
                ? "Sign in securely"
                : "Verify & continue to shop setup"}
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
