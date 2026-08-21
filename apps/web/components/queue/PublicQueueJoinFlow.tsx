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
  PublicQueueInfoDto,
  QueueEntryDetailDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { newIdempotencyKey } from "../../lib/idempotency";
import { QueueStatusPanel } from "./QueueStatusPanel";

type Stage = "loading" | "invalid" | "unavailable" | "ready" | "joining" | "joined";

const cardStyle: React.CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  padding: "2rem 1.5rem",
};
const buttonStyle: React.CSSProperties = {
  padding: "12px 20px",
  background: "#1C1A17",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #E7E0D3",
  marginBottom: 12,
  boxSizing: "border-box",
};
const errorStyle: React.CSSProperties = {
  background: "#FBEAEA",
  color: "#B0413E",
  padding: "10px 14px",
  borderRadius: 8,
  marginBottom: 16,
};

/**
 * Scan-and-join: resolves a shop's public QR token, lets the customer pick a service and
 * authenticate via the existing phone-OTP flow, then joins the existing queue engine — the same
 * QueueService.joinWalkIn an authenticated customer already uses via WalkInJoinFlow, just reached
 * through a public token instead of a salonId route param. No second queue implementation, no
 * second auth mechanism, no second realtime system: QueueStatusPanel/getRealtimeSocket below are
 * the exact same components an authenticated customer's own queue page already uses.
 */
export function PublicQueueJoinFlow({ token }: { token: string }) {
  const { status: authStatus, verifyCustomerOtp } = useAuth();
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

  useEffect(() => {
    if (otpStep !== "otp" || resendCooldown <= 0) return undefined;
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [otpStep, resendCooldown]);

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
      <div style={cardStyle}>
        <p style={{ color: "#6B6357" }}>Loading…</p>
      </div>
    );
  }

  if (stage === "invalid") {
    return (
      <div style={cardStyle}>
        <p>Sorry, this shop&apos;s queue link is no longer available.</p>
      </div>
    );
  }

  if (!info) return null; // unreachable once past "loading", satisfies TS below

  if (stage === "unavailable") {
    return (
      <div style={cardStyle}>
        <h1>{info.salonName}</h1>
        <p style={{ color: "#6B6357" }}>The queue is currently unavailable. Please check with the shop.</p>
      </div>
    );
  }

  if (stage === "joined" && entry) {
    return (
      <div style={cardStyle}>
        <h1>{info.salonName}</h1>
        <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h1>{info.salonName}</h1>
      <p style={{ color: "#6B6357", marginBottom: 20 }}>Join the queue for your next visit.</p>

      {info.services.length > 0 && (
        <>
          <label style={{ display: "block", marginBottom: 6, color: "#6B6357" }} htmlFor="public-queue-service">
            Service (optional)
          </label>
          <select
            id="public-queue-service"
            value={selectedServiceId}
            onChange={(e) => setSelectedServiceId(e.target.value)}
            style={inputStyle}
          >
            <option value="">Any service</option>
            {info.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.durationMinutes} min)
              </option>
            ))}
          </select>
        </>
      )}

      {joinError && <p style={errorStyle}>{joinError}</p>}

      {authStatus === "authenticated" ? (
        <button type="button" onClick={() => void handleJoin()} disabled={stage === "joining"} style={buttonStyle}>
          {stage === "joining" ? "Joining…" : "Join Queue"}
        </button>
      ) : authStatus === "loading" ? (
        <p style={{ color: "#6B6357" }}>Loading…</p>
      ) : (
        <>
          {otpError && <p style={errorStyle}>{otpError}</p>}
          {otpStep === "phone" ? (
            <form onSubmit={requestOtp}>
              <p style={{ color: "#6B6357", fontSize: 13, marginBottom: 10 }}>
                Enter your phone number to join the queue.
              </p>
              <input
                type="tel"
                placeholder="+919876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={inputStyle}
              />
              <button type="submit" style={buttonStyle} disabled={otpSubmitting}>
                {otpSubmitting ? "Sending…" : "Send OTP"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <p style={{ color: "#6B6357", fontSize: 13, marginBottom: 10 }}>Enter the code sent to {phone}.</p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <button type="submit" style={buttonStyle} disabled={otpSubmitting}>
                {otpSubmitting ? "Verifying…" : "Verify & Continue"}
              </button>
              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={resendCooldown > 0 || otpSubmitting}
                style={{ ...buttonStyle, background: "transparent", color: "#1C1A17", border: "1px solid #E7E0D3", marginLeft: 8 }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
              </button>
            </form>
          )}
        </>
      )}

      <p style={{ color: "#6B6357", fontSize: 13, marginTop: 20 }}>
        Your phone number is used only to sign you in and manage your place in the queue.
      </p>
    </div>
  );
}
