"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_PATHS,
  SPEECH_LOCALE,
  voiceAnnouncementsFor,
  type ArrivalAlertDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import { useAuth } from "../../lib/auth-context";
import { getVoiceEnabled, useVoiceEnabled } from "../../lib/voice-preference";
import { Button } from "../ui/Button";
import styles from "./arrival-alert-overlay.module.css";

// P0 arrival-alert mission — requirement 6's "recommended repeat interval around 20-30 seconds".
const VOICE_REPEAT_MS = 25_000;
// Requirement 10's "remind you again... short interval such as 2 minutes" for NOT ARRIVED before grace.
const SNOOZE_MS = 2 * 60_000;
// A light safety net alongside realtime (requirement 19) — realtime already drives most refreshes;
// this only covers a missed/dropped event between them.
const SAFETY_REFETCH_MS = 30_000;
// Best-effort cross-tab mutex (requirement 6: "prevent multiple browser tabs from creating
// uncontrolled simultaneous speech where practical"). Not a hard guarantee — localStorage can be
// unavailable (private browsing) or racy across tabs — so a failure here degrades to "this tab
// speaks anyway" rather than silently going mute.
const VOICE_LOCK_KEY = "fastque-arrival-voice-lock";
const VOICE_LOCK_TTL_MS = 4_000;

function alertsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.arrivalAlerts}`;
}
function arrivePath(bookingId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.bookings}/${bookingId}/${DASHBOARD_PATHS.arrive}`;
}
function noShowPath(bookingId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.bookings}/${bookingId}/${DASHBOARD_PATHS.noShow}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function tryAcquireVoiceLock(): boolean {
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(VOICE_LOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { expiresAt: number };
      if (typeof parsed.expiresAt === "number" && parsed.expiresAt > now) return false;
    }
    window.localStorage.setItem(VOICE_LOCK_KEY, JSON.stringify({ expiresAt: now + VOICE_LOCK_TTL_MS }));
    return true;
  } catch {
    return true;
  }
}

type ConfirmStep = null | "arrived" | "not-arrived-early" | "not-arrived-late";

/**
 * Requirement 4 (full-screen owner attention UI) + 9/10 (two-step ARRIVED/NOT ARRIVED
 * confirmation) + 6 (continuous voice reminder). Mounted once on each of the three canonical owner
 * operational surfaces (Bookings, Schedule, Live queue — requirement 18); eligibility is always
 * re-fetched from `GET .../arrival-alerts` (requirement 15's "reconstruct from backend truth"),
 * never trusted from a realtime event alone or cached across a reload.
 */
export function ArrivalAlertOverlay({ salonId }: { salonId: string }) {
  const { user } = useAuth();
  // The existing Voice Announcements preference (lib/voice-preference.ts). The full-screen visual
  // alert never depends on it; only the spoken reminder does.
  const voiceEnabled = useVoiceEnabled();
  const [alerts, setAlerts] = useState<ArrivalAlertDto[]>([]);
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);

  const preferredLanguageRef = useRef(user?.preferredLanguage ?? null);
  useEffect(() => {
    preferredLanguageRef.current = user?.preferredLanguage ?? null;
  }, [user?.preferredLanguage]);

  const refresh = useCallback(() => {
    apiFetch<ArrivalAlertDto[]>(alertsPath(salonId))
      .then(setAlerts)
      .catch(() => {
        /* this tick's refresh just won't update — the next realtime event or safety-interval
           tick retries; never a fatal error for the whole dashboard page. */
      });
  }, [salonId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);

    function onSalonEvent(payload: { salonId: string }) {
      if (payload.salonId !== salonId) return;
      refresh();
    }
    // Any of these can create OR resolve eligibility for this salon — always re-derive truth from
    // the server (requirement 15) rather than guessing which specific booking changed.
    socket.on("booking.arrival_alert", onSalonEvent);
    socket.on("queue.updated", onSalonEvent);
    socket.on("booking.no_show", onSalonEvent);
    socket.on("booking.cancelled", onSalonEvent);
    const unsubscribeReconnect = onReconnect(refresh);
    const safetyInterval = setInterval(refresh, SAFETY_REFETCH_MS);
    // Re-renders once a minute purely so a snooze that just expired (or a booking that just
    // crossed the grace boundary) is re-evaluated even with no new server event.
    const tickInterval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      socket.off("booking.arrival_alert", onSalonEvent);
      socket.off("queue.updated", onSalonEvent);
      socket.off("booking.no_show", onSalonEvent);
      socket.off("booking.cancelled", onSalonEvent);
      unsubscribeReconnect();
      clearInterval(safetyInterval);
      clearInterval(tickInterval);
    };
  }, [salonId, refresh]);

  const now = Date.now();
  const active =
    alerts
      .filter((a) => (snoozedUntil[a.bookingId] ?? 0) <= now)
      .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime())[0] ?? null;

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!getVoiceEnabled()) return;
    if (!tryAcquireVoiceLock()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    if (preferredLanguageRef.current) utterance.lang = SPEECH_LOCALE[preferredLanguageRef.current];
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopVoice = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  // Turning voice OFF while an alert is active cancels any speech already in flight immediately.
  // Only on a true->false transition, so merely mounting with voice off never cancels speech that
  // belongs to another component.
  const previousVoiceEnabledRef = useRef(voiceEnabled);
  useEffect(() => {
    if (previousVoiceEnabledRef.current && !voiceEnabled) stopVoice();
    previousVoiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled, stopVoice]);

  // The repeating voice loop — runs only while Voice Announcements is ON, and stops the instant
  // `active` becomes null (resolved) or a confirmation dialog is open (never talk over the owner
  // mid-decision). Turning voice back ON re-runs this effect and resumes the unresolved reminder.
  useEffect(() => {
    if (!active || confirmStep || !voiceEnabled) return;
    const announce = () => {
      speak(
        voiceAnnouncementsFor(preferredLanguageRef.current).arrivalCheck(
          active.serviceName,
          formatTime(active.slotStart),
        ),
      );
    };
    announce();
    const interval = setInterval(announce, VOICE_REPEAT_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.bookingId, confirmStep, voiceEnabled, speak]);

  useEffect(() => stopVoice, [stopVoice]);

  if (!active) return null;

  function closeConfirm() {
    setConfirmStep(null);
    setError(null);
  }

  async function confirmArrived() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(arrivePath(active!.bookingId), { method: "POST" });
      stopVoice();
      setConfirmStep(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm arrival. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmNotArrivedYet() {
    setSnoozedUntil((current) => ({ ...current, [active!.bookingId]: Date.now() + SNOOZE_MS }));
    setConfirmStep(null);
  }

  async function confirmNoShow() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(noShowPath(active!.bookingId), { method: "POST" });
      stopVoice();
      setConfirmStep(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this booking no-show. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true" aria-label="Appointment arrival check">
      <div className={styles.card}>
        {confirmStep === null && (
          <>
            <p className={styles.eyebrow}>Appointment arrival check</p>
            <h2 className={styles.headline}>
              {formatTime(active.slotStart)} · {active.serviceName}
            </h2>
            <p className={styles.question}>Has {active.customerDisplayName} arrived?</p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <Button type="button" variant="primary" onClick={() => setConfirmStep("arrived")} disabled={busy}>
                Arrived
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmStep(active!.graceExpired ? "not-arrived-late" : "not-arrived-early")}
                disabled={busy}
              >
                Not arrived
              </Button>
            </div>
            <button type="button" className={styles.snooze} onClick={confirmNotArrivedYet} disabled={busy}>
              Snooze 2 minutes
            </button>
          </>
        )}

        {confirmStep === "arrived" && (
          <>
            <h2 className={styles.headline}>Confirm customer arrival?</h2>
            <p className={styles.question}>
              This will check the customer in and add this appointment to the live service queue.
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <Button type="button" variant="primary" onClick={() => void confirmArrived()} disabled={busy}>
                Confirm Arrived
              </Button>
              <Button type="button" variant="outline" onClick={closeConfirm} disabled={busy}>
                Go Back
              </Button>
            </div>
          </>
        )}

        {confirmStep === "not-arrived-early" && (
          <>
            <h2 className={styles.headline}>Customer not here yet?</h2>
            <p className={styles.question}>
              FastQue will keep the appointment active and remind you again. The customer will NOT
              be marked as a no-show yet.
            </p>
            <div className={styles.actions}>
              <Button type="button" variant="primary" onClick={confirmNotArrivedYet}>
                Confirm Not Arrived Yet
              </Button>
              <Button type="button" variant="outline" onClick={closeConfirm}>
                Go Back
              </Button>
            </div>
          </>
        )}

        {confirmStep === "not-arrived-late" && (
          <>
            <h2 className={styles.headline}>Mark customer as No Show?</h2>
            <p className={styles.question}>
              This is a final booking status
              {active.noShowChargePreview !== null && active.noShowChargePreview > 0
                ? ` and may create a ${active.currency ?? ""}${active.noShowChargePreview} no-show charge according to this shop's policy.`
                : " according to this shop's policy."}
            </p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <Button type="button" variant="primary" onClick={() => void confirmNoShow()} disabled={busy}>
                Confirm No Show
              </Button>
              <Button type="button" variant="outline" onClick={closeConfirm} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
