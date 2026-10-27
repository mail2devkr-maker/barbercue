"use client";

import { useEffect, useState } from "react";
import { PUBLIC_QUEUE_PATHS, QUEUE_ENTRIES_PATH, type PublicQueueInfoDto, type QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import { BrandLockup } from "../ui/BrandLockup";
import { QueueStatusPanel } from "./QueueStatusPanel";
import { QueueContactFields, resolveContactInput } from "./QueueContactFields";
import styles from "./queue.module.css";

/**
 * QR entry intentionally does not require Google/Apple/phone-OTP sign-in.
 * Guest tickets use a per-ticket 256-bit capability and never impersonate an account.
 * Names and phone numbers are unverified and are solely for contacting the shop.
 */
export function PublicQueueJoinFlow({ token }: { token: string }) {
  const { status: authStatus, user } = useAuth();
  const [info, setInfo] = useState<PublicQueueInfoDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState(user?.phone ?? "");
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);
  const [guestAccessToken, setGuestAccessToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicQueueInfoDto>(`${PUBLIC_QUEUE_PATHS.publicQueue}/${token}`)
      .then((data) => { if (!cancelled) setInfo(data); })
      .catch(() => { if (!cancelled) setError("This queue link is not available."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (user?.phone) setContactPhone((current) => current || (user.phone as string));
  }, [user?.phone]);

  useEffect(() => {
    if (authStatus === "loading") return;
    const key = `fastque:guest-qr:${token}`;
    const saved = sessionStorage.getItem(key);
    if (!saved) return;
    try {
      const data = JSON.parse(saved) as { id: string; token: string };
      if (!data.id || !data.token) return;
      apiFetch<QueueEntryDetailDto>(`${QUEUE_ENTRIES_PATH}/${data.id}/guest-status`, {
        headers: { "X-Queue-Guest-Token": data.token },
      }).then((row) => {
        if (row.status === "WAITING" || row.status === "CALLED" || row.status === "IN_SERVICE") {
          setEntry(row); setGuestAccessToken(data.token);
        }
      }).catch(() => sessionStorage.removeItem(key));
    } catch { sessionStorage.removeItem(key); }
  }, [token, authStatus]);

  async function handleJoin() {
    if (submitting) return;
    const contact = resolveContactInput(contactName, contactPhone);
    if (!contact.ok) { setError(contact.error); return; }
    if (!selectedServiceId) { setError("Please choose a service."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const guest = authStatus !== "authenticated";
      const url = `${PUBLIC_QUEUE_PATHS.publicQueue}/${token}/${guest ? 'guest-join' : PUBLIC_QUEUE_PATHS.join}`;
      const row = await apiFetch<QueueEntryDetailDto & { guestAccessToken?: string }>(url, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify({ serviceId: selectedServiceId, ...contact.contact }),
      });
      if (row.guestAccessToken) {
        setGuestAccessToken(row.guestAccessToken);
        sessionStorage.setItem(`fastque:guest-qr:${token}`, JSON.stringify({
          id: row.id, token: row.guestAccessToken,
        }));
      }
      setEntry(row);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the queue. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.publicWrap}>
      <div className={styles.publicCard}>
        <BrandLockup compact canonicalArtwork className={styles.publicWordmark} />
        <h1 className={styles.publicTitle}>{info?.salonName ?? "Live Queue"}</h1>
        {loading ? (
          <p role="status">Loading shop queue…</p>
        ) : entry ? (
          <QueueStatusPanel entry={entry} guestAccessToken={guestAccessToken} onEntryChange={setEntry} />
        ) : !info || !info.queueAvailable ? (
          <p role="alert">{error ?? "The shop's Live Queue is unavailable right now."}</p>
        ) : (
          <>
            <p className={styles.publicIntro}>Name, mobile number and service are all you need. No Google login.</p>
            <label className={styles.fieldLabel} htmlFor="qr-livequeue-service">Choose a service</label>
            <select id="qr-livequeue-service" value={selectedServiceId}
              onChange={(event) => setSelectedServiceId(event.target.value)} className={styles.select}>
              <option value="">Select service</option>
              {info.services.map((service) => (
                <option key={service.id} value={service.id}>{service.name} ({service.durationMinutes} min)</option>
              ))}
            </select>
            <QueueContactFields idPrefix="qr-livequeue" name={contactName} phone={contactPhone}
              onNameChange={setContactName} onPhoneChange={setContactPhone} />
            {error && <p className={styles.errorText} role="alert">{error}</p>}
            <Button type="button" variant="primary" fullWidth disabled={submitting || authStatus === "loading"}
              onClick={() => void handleJoin()}>
              {submitting ? "Joining…" : "Join Live Queue"}
            </Button>
            <p className={styles.reassure}>The shop will use the number you provide to contact you.
              It is not verified as account ownership.</p>
          </>
        )}
      </div>
    </div>
  );
}
