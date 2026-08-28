"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_PATHS,
  OWNER_BOOKING_FILTERS,
  type OwnerBookingDetailDto,
  type OwnerBookingFilter,
  type PaginatedResult,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { getRealtimeSocket, joinSalonRoom } from "../../lib/realtime";
import { Button } from "../ui/Button";
import styles from "./bookings.module.css";

const PAGE_SIZE = 20;

const FILTER_LABEL: Record<OwnerBookingFilter, string> = {
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
  all: "All / History",
};

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PENDING_PAYMENT: "Pending payment",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
  EXPIRED: "Expired",
};

function statusClass(status: string): string {
  if (status === "COMPLETED") return styles.statusCompleted;
  if (status === "CANCELLED") return styles.statusCancelled;
  if (status === "NO_SHOW") return styles.statusNoShow;
  if (status === "PENDING_PAYMENT") return styles.statusPending;
  return styles.statusConfirmed;
}

function bookingsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}`;
}

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function BookingCard({ booking, isNew }: { booking: OwnerBookingDetailDto; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${styles.card} ${isNew ? styles.cardNew : ""}`} onClick={() => setOpen((v) => !v)}>
      <div className={styles.cardHead}>
        <div>
          <span className={styles.cardTitle}>{booking.serviceName}</span>
          {isNew && <span className={styles.newBadge}>NEW</span>}
          <p className={styles.cardMeta}>
            {formatSlot(booking.slotStart)}
            {booking.customerPhone ? ` · ${booking.customerPhone}` : ""}
            {booking.assignedStaffName
              ? ` · ${booking.assignedStaffName}`
              : booking.preferredStaffName
                ? ` · Pref: ${booking.preferredStaffName}`
                : ""}
          </p>
        </div>
        <span className={`${styles.statusBadge} ${statusClass(booking.status)}`}>
          {STATUS_LABEL[booking.status] ?? booking.status}
        </span>
      </div>

      {open && (
        <dl className={styles.detail}>
          <div className={styles.detailItem}>
            <dt>Reference</dt>
            <dd>{booking.id.slice(0, 8)}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>Duration</dt>
            <dd>{booking.serviceDurationMinutes} min</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>Price</dt>
            <dd>
              {booking.currency ?? ""} {booking.servicePrice}
            </dd>
          </div>
          {booking.prepaymentRequiredAmount !== null && (
            <div className={styles.detailItem}>
              <dt>Prepayment required</dt>
              <dd>
                {booking.currency ?? ""} {booking.prepaymentRequiredAmount}
              </dd>
            </div>
          )}
          {booking.selectedStyleName && (
            <div className={styles.detailItem}>
              <dt>Style</dt>
              <dd>{booking.selectedStyleName}</dd>
            </div>
          )}
          <div className={styles.detailItem}>
            <dt>Source</dt>
            <dd>{booking.source}</dd>
          </div>
          {booking.customerEmail && (
            <div className={styles.detailItem}>
              <dt>Customer email</dt>
              <dd>{booking.customerEmail}</dd>
            </div>
          )}
          <div className={styles.detailItem}>
            <dt>Booked on</dt>
            <dd>{formatSlot(booking.createdAt)}</dd>
          </div>
          {booking.cancelledAt && (
            <div className={styles.detailItem}>
              <dt>Cancelled</dt>
              <dd>{formatSlot(booking.cancelledAt)}</dd>
            </div>
          )}
          {booking.cancellationChargeAmount !== null && (
            <div className={styles.detailItem}>
              <dt>Cancellation charge</dt>
              <dd>
                {booking.currency ?? ""} {booking.cancellationChargeAmount}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

/**
 * Owner-only salon bookings view: filtered/paginated list over the same dashboard-bookings API the
 * mobile Owner app uses, plus realtime "new booking" / "booking cancelled" notifications over the
 * same /realtime socket the live queue view already uses. booking.created/booking.cancelled carry
 * ids only (see realtime.gateway.ts) — this always refetches the current list and, for a new
 * booking, fetches that one booking's own detail for the popup rather than trusting anything from
 * the socket payload itself.
 */
export function OwnerBookingsView({ salonId }: { salonId: string }) {
  const [filter, setFilter] = useState<OwnerBookingFilter>("today");
  const [items, setItems] = useState<OwnerBookingDetailDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newIds, setNewIds] = useState<string[]>([]);
  const [newNotice, setNewNotice] = useState<OwnerBookingDetailDto | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);

  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const alertsEnabledRef = useRef(false);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const playChime = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    // A distinct two-tone rising chime (523/784 Hz — a perfect fifth) so a booking alert doesn't
    // sound identical to the live-queue "new arrival" chime (660/880 Hz).
    [523, 784].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + index * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.16, now + index * 0.15 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.15 + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + index * 0.15);
      oscillator.stop(now + index * 0.15 + 0.18);
    });
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, []);

  async function enableAlerts() {
    try {
      const AudioContextClass = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") await context.resume();
      alertsEnabledRef.current = true;
      setAlertsEnabled(true);
      playChime();
    } catch {
      // AudioContext unavailable — alerts still work as silent toasts/badges.
      alertsEnabledRef.current = true;
      setAlertsEnabled(true);
    }
  }

  const loadPage = useCallback(
    (targetFilter: OwnerBookingFilter, cursor: string | undefined, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      const params = new URLSearchParams({ filter: targetFilter, limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      return apiFetch<PaginatedResult<OwnerBookingDetailDto>>(`${bookingsPath(salonId)}?${params}`)
        .then((result) => {
          setItems((prev) => (append ? [...prev, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        })
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : "Could not load bookings.");
        })
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [salonId],
  );

  useEffect(() => {
    // Deferred a tick so this effect body never calls setState synchronously — same pattern as
    // DashboardQueueView's own initial-load effect.
    void Promise.resolve().then(() => loadPage(filter, undefined, false));
  }, [filter, loadPage]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);

    function onCreated(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== salonId) return;
      // Always refresh the current list so counts/rows stay authoritative...
      void loadPage(filterRef.current, undefined, false);
      // ...but the alert (popup/badge/chime/voice) fires at most once per booking id, regardless
      // of how many times the event is delivered (reconnects, duplicate emits).
      if (notifiedIdsRef.current.has(payload.bookingId)) return;
      notifiedIdsRef.current.add(payload.bookingId);
      setNewIds((current) => [...current, payload.bookingId]);
      apiFetch<OwnerBookingDetailDto>(`${bookingsPath(salonId)}/${payload.bookingId}`)
        .then((detail) => {
          setNewNotice(detail);
          if (alertsEnabledRef.current) {
            playChime();
            speak(
              `New booking received${detail.serviceName ? ` for ${detail.serviceName}` : ""}${
                detail.slotStart ? ` at ${formatTime(detail.slotStart)}` : ""
              }.`,
            );
          }
        })
        .catch(() => {
          /* the toast just won't have rich details — the list refetch above still shows it */
        });
    }

    function onCancelled(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== salonId) return;
      void loadPage(filterRef.current, undefined, false);
      setCancelNotice(payload.bookingId);
      if (alertsEnabledRef.current) speak("Booking cancelled.");
    }

    socket.on("booking.created", onCreated);
    socket.on("booking.cancelled", onCancelled);
    return () => {
      socket.off("booking.created", onCreated);
      socket.off("booking.cancelled", onCancelled);
    };
  }, [salonId, loadPage, playChime, speak]);

  return (
    <div>
      <div className={styles.tools}>
        <p>Realtime updates are on.</p>
        <Button type="button" variant="outline" onClick={() => void enableAlerts()} disabled={alertsEnabled}>
          {alertsEnabled ? "Booking alerts: Sound ON" : "Booking alerts: Sound OFF"}
        </Button>
      </div>

      <div className={styles.liveAnnouncer} aria-live="polite" aria-atomic="true">
        {newNotice && (
          <div className={styles.newBookingBanner}>
            <div>
              <strong>New booking received</strong>
              <span>
                {newNotice.serviceName} · {formatSlot(newNotice.slotStart)}
                {newNotice.customerPhone ? ` · ${newNotice.customerPhone}` : ""}
              </span>
            </div>
            <Button type="button" variant="outline" onClick={() => setNewNotice(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {cancelNotice && (
          <div className={`${styles.newBookingBanner} ${styles.cancelBanner}`}>
            <div>
              <strong>Booking cancelled</strong>
            </div>
            <Button type="button" variant="outline" onClick={() => setCancelNotice(null)}>
              Dismiss
            </Button>
          </div>
        )}
      </div>

      <div className={styles.filterRow}>
        {OWNER_BOOKING_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.filterChip} ${filter === f ? styles.filterChipActive : ""}`}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {error && <p className={styles.errorText}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : items.length === 0 ? (
        <p className={styles.emptyState}>No bookings in this view yet.</p>
      ) : (
        <div className={styles.list}>
          {items.map((booking) => (
            <BookingCard key={booking.id} booking={booking} isNew={newIds.includes(booking.id)} />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className={styles.loadMoreRow}>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadPage(filter, nextCursor, true)}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
