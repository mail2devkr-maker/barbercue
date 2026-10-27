"use client";

import { useEffect, useRef, useState } from "react";
import { QUEUE_ENTRIES_PATH, queuePhaseOf, type QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import styles from "./queue.module.css";

const ACTIVE_STATUSES = new Set(["WAITING", "CALLED", "IN_SERVICE"]);

function statusLabel(entry: QueueEntryDetailDto): string {
  // ASSIGNED: a barber and chair are reserved for the customer but the service has not started.
  if (queuePhaseOf(entry) === "ASSIGNED") return "Your barber is ready";
  if (entry.status === "CALLED") return "You're being called!";
  if (entry.status === "IN_SERVICE") return "In service";
  if (entry.status === "WAITING" && entry.position) return `Position ${entry.position}`;
  return entry.status;
}

function statusBadgeClass(status: string): string {
  if (status === "CALLED") return styles.statusCalled;
  if (status === "IN_SERVICE") return styles.statusInService;
  if (status === "WAITING") return styles.statusWaiting;
  return styles.statusNeutral;
}

/**
 * Live queue-token status for the current customer — used after both a walk-in join and an
 * appointment check-in. Fully controlled by the parent (`entry` is the current source of truth);
 * subscribes to `salon:{salonId}` for `queue.updated`/`queue.entry.called` and re-fetches
 * `GET queue-entries/mine/active` on either, matching API.md's ids-only realtime payload
 * convention (clients always re-fetch via REST rather than trusting the socket payload), handing
 * the result back to the parent via `onEntryChange` instead of holding its own copy.
 */
export function QueueStatusPanel({
  entry,
  onEntryChange,
}: {
  entry: QueueEntryDetailDto;
  onEntryChange: (entry: QueueEntryDetailDto | null) => void;
}) {
  const [turnAlert, setTurnAlert] = useState(false);
  const [shopPhone, setShopPhone] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canCancel = entry.bookingId === null && (entry.status === "WAITING" || entry.status === "CALLED");

  useEffect(() => {
    if (!ACTIVE_STATUSES.has(entry.status)) {
      setShopPhone(null);
      return;
    }
    let cancelled = false;
    apiFetch<{ shopPhone: string | null }>(`${QUEUE_ENTRIES_PATH}/${entry.id}/shop-contact`)
      .then((result) => { if (!cancelled) setShopPhone(result.shopPhone); })
      .catch(() => { if (!cancelled) setShopPhone(null); });
    return () => { cancelled = true; };
  }, [entry.id, entry.status]);

  async function cancelMyQueue(): Promise<void> {
    if (cancelling || !canCancel) return;
    if (!window.confirm("Cancel your Live Queue token? You will lose your place in line.")) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await apiFetch(`${QUEUE_ENTRIES_PATH}/${entry.id}/cancel`, { method: "POST" });
      onEntryChange(null);
    } catch (error) {
      setCancelError(error instanceof ApiError ? error.message : "Could not cancel your Live Queue token. Please try again.");
      // A race with the shop calling/starting the service may make the token ineligible.
      // Refresh server truth; never pretend a failed cancellation succeeded.
      void apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`).then(onEntryChange).catch(() => undefined);
    } finally {
      setCancelling(false);
    }
  }
  const audioContextRef = useRef<AudioContext | null>(null);

  function playChime() {
    try {
      const AudioContextClass = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 784;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.42);
    } catch {
      /* AudioContext unavailable (e.g. no prior user gesture) — the visible banner still shows */
    }
  }

  useEffect(() => {
    if (!ACTIVE_STATUSES.has(entry.status)) return undefined;
    const salonId = entry.salonId;
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);

    let cancelled = false;
    function refetch() {
      apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
        .then((next) => {
          if (!cancelled) onEntryChange(next);
        })
        .catch(() => {
          /* transient — the next event will retry */
        });
    }
    function onQueueUpdated(payload: { salonId: string }) {
      if (payload.salonId === salonId) refetch();
    }
    function onEntryCalled(payload: { salonId: string; queueEntryId: string }) {
      if (payload.salonId === salonId) refetch();
    }
    // The backend only emits this when it has genuinely detected a turn-approaching crossing or a
    // large wait swing (see queue.service.ts's recomputeEtas) — every receipt here is real news,
    // so there's no client-side dedup to do beyond just reacting to it.
    function onWaitAlert(payload: { salonId: string; queueEntryId: string }) {
      if (payload.salonId !== salonId || payload.queueEntryId !== entry.id) return;
      setTurnAlert(true);
      playChime();
      refetch();
    }

    socket.on("queue.updated", onQueueUpdated);
    socket.on("queue.entry.called", onEntryCalled);
    socket.on("queue.entry.wait_alert", onWaitAlert);
    // Phase 15: the "updates automatically, no need to refresh" promise below only holds if a
    // dropped connection resyncs on its own once restored.
    const unsubscribeReconnect = onReconnect(refetch);
    return () => {
      cancelled = true;
      socket.off("queue.updated", onQueueUpdated);
      socket.off("queue.entry.called", onEntryCalled);
      socket.off("queue.entry.wait_alert", onWaitAlert);
      unsubscribeReconnect();
    };
  }, [entry.salonId, entry.status, entry.id, onEntryChange]);

  return (
    <div className={styles.ticket}>
      {turnAlert && (
        <div className={styles.turnAlertBanner} role="alert">
          <span>{entry.turnApproaching ? "Your turn is almost here!" : "Your wait time has changed."}</span>
          <button type="button" onClick={() => setTurnAlert(false)}>
            Dismiss
          </button>
        </div>
      )}
      <div className={styles.ticketHead}>
        <div>
          <p className={styles.ticketTokenLabel}>Your token</p>
          <p className={styles.ticketToken}>#{entry.tokenNumber}</p>
        </div>
        <span className={`${styles.ticketStatusBadge} ${statusBadgeClass(entry.status)}`}>
          {statusLabel(entry)}
        </span>
      </div>
      {entry.status === "WAITING" && entry.estimatedWaitRangeMinutes && (
        <p className={styles.ticketDetail}>
          Estimated wait:{" "}
          <strong>
            {entry.estimatedWaitRangeMinutes.min}–{entry.estimatedWaitRangeMinutes.max} min
          </strong>
        </p>
      )}
      {entry.status === "WAITING" && entry.turnApproaching && (
        <p className={styles.ticketDetail}>Please head over now — you&apos;re almost up.</p>
      )}
      {queuePhaseOf(entry) === "ASSIGNED" && (
        <p className={styles.ticketDetail}>
          {entry.assignedStaffName ? <><strong>{entry.assignedStaffName}</strong> will serve you</> : "A barber will serve you"}
          {entry.assignedChairLabel ? ` at ${entry.assignedChairLabel}` : ""}. Please head over — your service starts when they begin.
        </p>
      )}
      {entry.status === "IN_SERVICE" && (
        <p className={styles.ticketDetail}>
          {entry.assignedStaffName ? <>With <strong>{entry.assignedStaffName}</strong></> : "In service"}
          {entry.assignedChairLabel ? ` — ${entry.assignedChairLabel}` : ""}
        </p>
      )}
      {shopPhone && (
        <div className={styles.customerCancelWrap}>
          <a href={`tel:${shopPhone}`} aria-label="Call shop about your Live Queue">
            Call shop — {shopPhone}
          </a>
          <p className={styles.ticketReassure}>Uses the shop's public business number; normal carrier charges may apply.</p>
        </div>
      )}
      {canCancel && (
        <div className={styles.customerCancelWrap}>
          <button
            type="button"
            className={styles.customerCancelButton}
            onClick={() => void cancelMyQueue()}
            disabled={cancelling}
            aria-label="Cancel Live Queue token"
          >
            {cancelling ? "Cancelling…" : "Cancel Live Queue"}
          </button>
          <p className={styles.ticketReassure}>You can cancel before your service starts.</p>
        </div>
      )}
      {cancelError && <p className={styles.errorText} role="alert">{cancelError}</p>}
      {ACTIVE_STATUSES.has(entry.status) && (
        <p className={styles.ticketReassure}>
          This updates automatically — no need to refresh.
        </p>
      )}
    </div>
  );
}
