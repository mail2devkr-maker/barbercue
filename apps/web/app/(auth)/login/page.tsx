"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AUTH_PATHS, otpRequestSchema, otpVerifySchema } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { AuthCard, authButtonStyle, authErrorStyle, authInputStyle } from "../../../components/auth/AuthCard";

type Step = "phone" | "otp";

function CustomerLoginForm() {
  const { verifyCustomerOtp } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = otpRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid phone number.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`auth/${AUTH_PATHS.otpRequest}`, { method: "POST", body: JSON.stringify(parsed.data) });
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send OTP. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = otpVerifySchema.safeParse({ phone, code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid code.");
      return;
    }
    setSubmitting(true);
    try {
      await verifyCustomerOtp(parsed.data);
      router.replace(searchParams.get("next") ?? "/account/bookings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify OTP. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Log in to BarberCue"
      subtitle={step === "phone" ? "Enter your phone number to get a one-time code." : `Enter the code sent to ${phone}.`}
    >
      {error && <p style={authErrorStyle}>{error}</p>}
      {step === "phone" ? (
        <form onSubmit={requestOtp}>
          <input
            type="tel"
            placeholder="+919876543210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={authInputStyle}
            autoFocus
          />
          <button type="submit" style={authButtonStyle} disabled={submitting}>
            {submitting ? "Sending..." : "Send OTP"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={authInputStyle}
            autoFocus
          />
          <button type="submit" style={authButtonStyle} disabled={submitting}>
            {submitting ? "Verifying..." : "Verify & Continue"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

export default function CustomerLoginPage() {
  return (
    <Suspense fallback={null}>
      <CustomerLoginForm />
    </Suspense>
  );
}
