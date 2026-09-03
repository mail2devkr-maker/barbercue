"use client";

import { useEffect, useState } from "react";
import {
  QUEUE_ENTRIES_PATH,
  SALON_QUEUE_PATHS,
  type QueueEntryDetailDto,
  type ServiceDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../ui/Button";
import { GoogleIdentityButton } from "../auth/GoogleIdentityButton";
import { QueueStatusPanel } from "./QueueStatusPanel";
import styles from "./queue.module.css";

// Issue #13 Mission E: service selection is visible and usable with no login wall at all — only
// the actual "Join the queue" action requires a signed-in customer, matching the desired journey
// (find shop -> select -> confirm -> THEN sign in). Google Identity Services renders as an
// in-page button/overlay, never a full-page redirect, so `selectedServiceId` below is never lost
// across sign-in — the exact same pattern PublicQueueJoinFlow (the QR entry point) already proved
// out for this queue engine.
export function WalkInJoinFlow({ salonId, services }: { salonId: string; services: ServiceDto[] }) {
  const { status: authStatus, googleLogin } = useAuth();
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);

  // A customer can only hold one active token anywhere (assertNotAlreadyInQueue) — only checkable
  // once actually signed in, so this waits for authStatus rather than firing unconditionally on
  // mount (which would 401 for the now-common case of an unauthenticated first visit).
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((active) => {
        if (!cancelled) setEntry(active);
      })
      .catch(() => {
        /* no active entry, or a transient error — the join button remains available */
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  async function handleJoin() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.join}`, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify(selectedServiceId ? { serviceId: selectedServiceId } : {}),
      });
      setEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the queue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Selection is preserved: googleLogin() only updates auth state in place, no navigation, so
  // selectedServiceId above is exactly what it was before the sign-in overlay appeared. Once
  // authStatus flips to "authenticated" the button below switches straight to "Join the queue"
  // with that same selection already in place — no restart, no re-pick.
  async function handleGoogleCredential(idToken: string) {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await googleLogin({ idToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in with Google. Please try again.");
    } finally {
      setGoogleSubmitting(false);
    }
  }

  if (authStatus === "loading") return <p className={styles.stepLoading}>Loading…</p>;

  if (entry && entry.salonId !== salonId) {
    return (
      <p className={styles.stepLoading}>
        You already have an active queue token at another salon. Finish or cancel it before joining here.
      </p>
    );
  }

  if (entry) {
    return <QueueStatusPanel entry={entry} onEntryChange={setEntry} />;
  }

  return (
    <div className={styles.joinCard}>
      <label className={styles.fieldLabel} htmlFor="walkin-service">
        Service (optional)
      </label>
      <select
        id="walkin-service"
        value={selectedServiceId}
        onChange={(e) => setSelectedServiceId(e.target.value)}
        className={styles.select}
      >
        <option value="">Any service</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.durationMinutes} min)
          </option>
        ))}
      </select>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.joinActions}>
        {authStatus === "authenticated" ? (
          <Button type="button" variant="primary" onClick={() => void handleJoin()} disabled={submitting}>
            {submitting ? "Joining…" : "Join the queue"}
          </Button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <p className={styles.fieldLabel}>Sign in to join the queue</p>
            <GoogleIdentityButton
              audienceLabel="customer"
              onCredential={(idToken) => void handleGoogleCredential(idToken)}
              disabled={googleSubmitting}
            />
          </div>
        )}
      </div>
      <p className={styles.reassure}>We&apos;ll keep your place — no need to stay by the counter.</p>
    </div>
  );
}
