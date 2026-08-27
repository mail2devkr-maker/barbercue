"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AUTH_PATHS,
  type AuthMethodsDto,
  OTP_RESEND_COOLDOWN_SECONDS,
  otpRequestSchema,
  otpVerifySchema,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import {
  authButtonStyle,
  authErrorStyle,
  authInputStyle,
} from "../../../components/auth/AuthCard";
import { CustomerAuthCard } from "../../../components/auth/CustomerAuthCard";
import { safeNextPath } from "../../../lib/safe-next-path";

type Step = "phone" | "otp";

// Google Identity Services attaches itself to window at runtime (script loaded via next/script
// below) — declared here rather than pulling in a whole @types/google.accounts package for one
// narrow, stable-shaped callback.
interface GoogleCredentialResponse {
  credential: string;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            // Routes the rendered button's sign-in through the browser's native FedCM API
            // instead of GSI's default window.open() popup — see the login flow's popup-mode
            // failure investigation. FedCM's account picker is browser-chrome UI, not a popup
            // window, so it is structurally exempt from popup blockers. Falls back to the
            // existing popup flow automatically in browsers without FedCM support.
            use_fedcm_for_button?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const authSuccessStyle: React.CSSProperties = {
  color: "var(--bc-success)",
  fontSize: "0.85rem",
  marginBottom: 12,
};

const resendButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem",
  borderRadius: "var(--bc-radius-sm)",
  border: "1px solid var(--bc-border)",
  background: "transparent",
  color: "var(--bc-ink)",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
  marginTop: 8,
};

const dividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  color: "var(--bc-muted)",
  fontSize: "0.8rem",
  margin: "16px 0",
};

// Same typographic treatment AuthCard's own subtitle used previously — preserved here since these
// two lines carry information the old dynamic title/subtitle used to show (new-account framing on
// the phone step, "code sent to X" on the OTP step), just relocated now that CustomerAuthCard owns
// a fixed headline/supporting-text instead of a per-step subtitle.
const contextLineStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--bc-muted)",
  marginBottom: 12,
};

function CustomerLoginForm() {
  const { verifyCustomerOtp, googleLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Whether this deployment can actually complete a phone OTP. Null while unknown — the form is
  // hidden until we know, so a customer is never shown an input that is guaranteed to 502.
  const [phoneOtpAvailable, setPhoneOtpAvailable] = useState<boolean | null>(null);
  const [resending, setResending] = useState(false);
  // Seconds remaining before "Resend OTP" is enabled again; 0 = enabled. Starts counting the
  // moment a code is sent (initial send or a resend) — a client-side throttle only, layered on
  // top of (never replacing) OtpService's server-side per-phone rate limit.
  const [resendCooldown, setResendCooldown] = useState(0);

  const [googleScriptLoaded, setGoogleScriptLoaded] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Ticks the cooldown down once a second while on the OTP step. Cleared on unmount/step change
  // so no stale timer fires after the user leaves this screen.
  useEffect(() => {
    if (step !== "otp" || resendCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, resendCooldown]);

  async function handleGoogleCredential(idToken: string) {
    setError(null);
    setSubmitting(true);
    try {
      await googleLogin({ idToken });
      router.replace(safeNextPath(searchParams.get("next")) ?? "/account/bookings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in with Google. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Renders Google's own button widget (not a custom-styled one) once both the GSI script has
  // loaded and a client ID is configured — deliberately inert with no error shown when
  // NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset (e.g. local dev before Google Cloud setup is done);
  // phone-OTP sign-in keeps working either way.
  useEffect(() => {
    if (!googleScriptLoaded || step !== "phone") return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !googleButtonRef.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => void handleGoogleCredential(response.credential),
      use_fedcm_for_button: true,
    });
    // Google's renderButton width is a fixed pixel number (max 400), not a percentage — measuring
    // the actual container width here is what makes the button fit the card responsively instead
    // of the previous hardcoded 320. theme/text/size are unchanged from before.
    const width = Math.min(googleButtonRef.current.offsetWidth || 320, 400);
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: "outline",
      size: "large",
      width,
      text: "continue_with",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleScriptLoaded, step]);

  async function sendOtp(targetPhone: string): Promise<void> {
    await apiFetch(`auth/${AUTH_PATHS.otpRequest}`, {
      method: "POST",
      body: JSON.stringify({ phone: targetPhone }),
    });
  }

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
      await sendOtp(parsed.data.phone);
      setStep("otp");
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send OTP. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    // Belt-and-braces guard against a stray click landing between disabled-state re-renders —
    // the button is already disabled during cooldown/in-flight, this just makes it non-negotiable.
    if (resendCooldown > 0 || resending) return;
    setError(null);
    setResendMessage(null);
    setResending(true);
    try {
      await sendOtp(phone);
      setResendMessage("A new code has been sent.");
    } catch (err) {
      // The backend's OTP_RATE_LIMITED message is already written for end users (see
      // OtpService) — surfaced as-is rather than replaced with a generic string.
      setError(err instanceof ApiError ? err.message : "Could not resend the code. Please try again.");
    } finally {
      // Restart the cooldown on both success and failure — on failure this also prevents
      // hammering the resend button (and the server's rate limit) with instant retries.
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setResending(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResendMessage(null);
    const parsed = otpVerifySchema.safeParse({ phone, code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid code.");
      return;
    }
    setSubmitting(true);
    try {
      await verifyCustomerOtp(parsed.data);
      router.replace(safeNextPath(searchParams.get("next")) ?? "/account/bookings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not verify OTP. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`)
      .then((m) => {
        if (!cancelled) setPhoneOtpAvailable(m.phoneOtp);
      })
      // If the capability probe itself fails, fall back to showing the form: a working sign-in
      // method must not disappear because one extra request was unlucky.
      .catch(() => {
        if (!cancelled) setPhoneOtpAvailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setGoogleScriptLoaded(true)}
      />
      <CustomerAuthCard>
        {error && <p style={authErrorStyle}>{error}</p>}
        {resendMessage && <p style={authSuccessStyle}>{resendMessage}</p>}
        {step === "phone" ? (
          <>
            <div ref={googleButtonRef} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />
            {phoneOtpAvailable === false ? (
              <p style={contextLineStyle}>
                Phone sign-in is temporarily unavailable. Please continue with Google above —
                it&apos;s the same account either way.
              </p>
            ) : (
              <>
                <div style={dividerStyle}>
                  <span style={{ flex: 1, borderTop: "1px solid var(--bc-border)" }} />
                  OR
                  <span style={{ flex: 1, borderTop: "1px solid var(--bc-border)" }} />
                </div>
                <p style={contextLineStyle}>New here? Signing in creates your account automatically.</p>
                {phoneOtpAvailable === null ? (
                  <p style={contextLineStyle}>Checking sign-in options…</p>
                ) : (
                  <form onSubmit={requestOtp}>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+919876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      style={authInputStyle}
                    />
                    <button type="submit" style={authButtonStyle} disabled={submitting}>
                      {submitting ? "Sending..." : "Send OTP"}
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        ) : (
          <form onSubmit={verifyOtp}>
            <p style={contextLineStyle}>Enter the code sent to {phone}.</p>
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
            <button
              type="button"
              style={resendButtonStyle}
              onClick={() => void handleResend()}
              disabled={resendCooldown > 0 || resending}
            >
              {resending
                ? "Resending..."
                : resendCooldown > 0
                  ? `Resend OTP in ${resendCooldown}s`
                  : "Resend OTP"}
            </button>
          </form>
        )}
      </CustomerAuthCard>
    </>
  );
}

export default function CustomerLoginPage() {
  return (
    <Suspense fallback={null}>
      <CustomerLoginForm />
    </Suspense>
  );
}
