"use client";

import { useEffect, useState } from "react";
import {
  AUTH_PATHS,
  OTP_RESEND_COOLDOWN_SECONDS,
  PUBLIC_QUEUE_PATHS,
  QUEUE_ENTRIES_PATH,
  otpRequestSchema,
  otpVerifySchema,
} from "@barbercue/shared";
import type {
  AuthMethodsDto,
  PublicQueueInfoDto,
  QueueEntryDetailDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import { GoogleIdentityButton } from "../auth/GoogleIdentityButton";
import authStyles from "../auth/customer-auth.module.css";
import { QueueStatusPanel } from "./QueueStatusPanel";
import styles from "./queue.module.css";

type Stage = "loading" | "invalid" | "unavailable" | "ready" | "joining" | "joined";

/**
 * Scan-and-join: resolves a shop's public QR token, lets the customer pick a service and
 * authenticate via the existing phone-OTP flow, then joins the existing queue engine — the same
 * QueueService.joinWalkIn an authenticated customer already uses via WalkInJoinFlow, just reached
 * through a public token instead of a salonId route param. No second queue implementation, no
 * second auth mechanism, no second realtime system: QueueStatusPanel/getRealtimeSocket below are
 * the exact same components an authenticated customer's own queue page already uses.
 */
export function PublicQueueJoinFlow({ token }: { token: string }) {
  const { status: authStatus, verifyCustomerOtp, googleLogin } = useAuth();
  const [stage, setStage] = useState<Stage>("loading");
  const [info, setInfo] = useState<PublicQueueInfoDto | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Phone-OTP sub-state — same fields/flow as the customer login page, just embedded here so a
  // walk-in never has to leave this page.
  const [otpStep, setOtpStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Same capability probe as the customer login page (CustomerLoginForm) — this embedded flow
  // must not offer a phone form guaranteed to 502 when no SMS provider is configured, and unlike
  // the login page this one had no Google fallback at all until this fix.
  const [phoneOtpAvailable, setPhoneOtpAvailable] = useState<boolean | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  useEffect(() => {
    if (otpStep !== "otp" || resendCooldown <= 0) return undefined;
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [otpStep, resendCooldown]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthMethodsDto>(`auth/${AUTH_PATHS.methods}`)
      .then((m) => {
        if (!cancelled) setPhoneOtpAvailable(m.phoneOtp);
      })
      .catch(() => {
        if (!cancelled) setPhoneOtpAvailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGoogleCredential(idToken: string) {
    setOtpError(null);
    setGoogleSubmitting(true);
    try {
      await googleLogin({ idToken });
    } catch (err) {
      setOtpError(err instanceof ApiError ? err.message : "Could not sign in with Google. Please try again.");
    } finally {
      setGoogleSubmitting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicQueueInfoDto>(`${PUBLIC_QUEUE_PATHS.publicQueue}/${token}`)
      .then((result) => {
        if (cancelled) return;
        setInfo(result);
        setStage(result.queueAvailable ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setStage("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Once authenticated, check for an already-active queue token (any salon) — same "don't attempt
  // a doomed join" check WalkInJoinFlow already does — and show it directly instead of the join UI.
  useEffect(() => {
    if (authStatus !== "authenticated" || stage !== "ready") return;
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((active) => {
        if (!cancelled && active) {
          setEntry(active);
          setStage("joined");
        }
      })
      .catch(() => {
        /* transient — the join button remains available */
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, stage]);

  async function handleJoin() {
    setStage("joining");
    setJoinError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(
        `${PUBLIC_QUEUE_PATHS.publicQueue}/${token}/${PUBLIC_QUEUE_PATHS.join}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": newIdempotencyKey() },
          body: JSON.stringify(selectedServiceId ? { serviceId: selectedServiceId } : {}),
        },
      );
      setEntry(created);
      setStage("joined");
    } catch (err) {
      setJoinError(err instanceof ApiError ? err.message : "Could not join the queue. Please try again.");
      setStage("ready");
    }
  }

  async function sendOtp(targetPhone: string): Promise<void> {
    await apiFetch(`auth/${AUTH_PATHS.otpRequest}`, { method: "POST", body: JSON.stringify({ phone: targetPhone }) });
  }

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    const parsed = otpRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      setOtpError(parsed.error.issues[0]?.message ?? "Invalid phone number.");
      return;
    }
    setOtpSubmitting(true);
    try {
      await sendOtp(parsed.data.phone);
      setOtpStep("otp");
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setOtpError(err instanceof ApiError ? err.message : "Could not send OTP. Please try again.");
    } finally {
      setOtpSubmitting(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || otpSubmitting) return;
    setOtpError(null);
    setOtpSubmitting(true);
    try {
      await sendOtp(phone);
    } catch (err) {
      setOtpError(err instanceof ApiError ? err.message : "Could not resend the code. Please try again.");
    } finally {
      setResendCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setOtpSubmitting(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setOtpError(null);
    const parsed = otpVerifySchema.safeParse({ phone, code });
    if (!parsed.success) {
      setOtpError(parsed.error.issues[0]?.message ?? "Invalid code.");
      return;
    }
    setOtpSubmitting(true);
    try {
      // Establishes the same JWT session as the regular login page — the customer can now join
      // the queue exactly like any other authenticated customer.
      await verifyCustomerOtp(parsed.data);
    } catch (err) {
      setOtpError(err instanceof ApiError ? err.message : "Could not verify OTP. Please try again.");
    } finally {
      setOtpSubmitting(false);
    }
  }

  if (stage === "loading") {
    return (
      <div className={styles.publicWrap}>
        <p className={styles.stepLoading}>Loading…</p>
      </div>
    );
  }

  if (stage === "invalid") {
    return (
      <div className={styles.publicWrap}>
        <div className={styles.publicCard}>
          <p className={styles.publicIntro}>Sorry, this shop&apos;s queue link is no longer available.</p>
        </div>
      </div>
    );
  }

  if (!info) return null; // unreachable once past "loading", satisfies TS below

  if (stage === "unavailable") {
    return (
      <div className={styles.publicWrap}>
        <div className={styles.publicCard}>
          <p className={styles.publicWordmark}>FastQue</p>
          <h1 className={styles.publicTitle}>{info.salonName}</h1>
          <p className={styles.publicIntro}>The queue is currently unavailable. Please check with the shop.</p>
        </div>
      </div>
    );
  }

  if (stage === "joined" && entry) {
    return (
      <div className={styles.publicWrap}>
        <div className={styles.publicCard}>
          <p className={styles.publicWordmark}>FastQue</p>
          <h1 className={styles.publicTitle}>{info.salonName}</h1>
          <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.publicWrap}>
      <div className={styles.publicCard}>
        <p className={styles.publicWordmark}>FastQue</p>
        <h1 className={styles.publicTitle}>{info.salonName}</h1>
        <p className={styles.publicIntro}>Join the queue for your next visit.</p>

        {info.services.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label className={styles.fieldLabel} htmlFor="public-queue-service">
              Service (optional)
            </label>
            <select
              id="public-queue-service"
              value={selectedServiceId}
              onChange={(e) => setSelectedServiceId(e.target.value)}
              className={styles.select}
            >
              <option value="">Any service</option>
              {info.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
            </select>
          </div>
        )}

        {joinError && <p className={styles.errorText}>{joinError}</p>}

        {authStatus === "authenticated" ? (
          <Button type="button" variant="secondary" fullWidth onClick={() => void handleJoin()} disabled={stage === "joining"}>
            {stage === "joining" ? "Joining…" : "Join Queue"}
          </Button>
        ) : authStatus === "loading" ? (
          <p className={styles.stepLoading}>Loading…</p>
        ) : (
          <>
            {otpError && <p className={styles.errorText}>{otpError}</p>}
            {otpStep === "phone" ? (
              <>
                <GoogleIdentityButton
                  audienceLabel="customer"
                  onCredential={(idToken) => void handleGoogleCredential(idToken)}
                  disabled={googleSubmitting}
                />
                {phoneOtpAvailable === false ? (
                  <p className={authStyles.noticeMessage}>
                    Phone sign-in is temporarily unavailable. Please continue with Google above —
                    it&apos;s the same account either way.
                  </p>
                ) : phoneOtpAvailable === null ? (
                  <p className={styles.pageSubtitle} style={{ fontSize: 13 }} role="status">
                    Checking sign-in options…
                  </p>
                ) : (
                  <>
                    <div className={authStyles.divider} aria-hidden="true">OR</div>
                    <form onSubmit={requestOtp}>
                      <p className={styles.pageSubtitle} style={{ fontSize: 13, marginBottom: 10 }}>
                        Enter your phone number to join the queue.
                      </p>
                      <input
                        type="tel"
                        placeholder="+919876543210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={styles.textInput}
                      />
                      <Button type="submit" variant="secondary" fullWidth disabled={otpSubmitting}>
                        {otpSubmitting ? "Sending…" : "Send OTP"}
                      </Button>
                    </form>
                  </>
                )}
              </>
            ) : (
              <form onSubmit={verifyOtp}>
                <p className={styles.pageSubtitle} style={{ fontSize: 13, marginBottom: 10 }}>
                  Enter the code sent to {phone}.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={styles.textInput}
                  autoFocus
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="submit" variant="secondary" disabled={otpSubmitting}>
                    {otpSubmitting ? "Verifying…" : "Verify & Continue"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleResend()}
                    disabled={resendCooldown > 0 || otpSubmitting}
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}

        <p className={styles.reassure}>
          Your phone number is used only to sign you in and manage your place in the queue.
        </p>
      </div>
    </div>
  );
}
