"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BOOKING_PATHS, QUEUE_ENTRIES_PATH,
  formatMoney,
} from "@barbercue/shared";
import type {
  BookingDetailDto,
  CancelBookingResponseDto,
  PaginatedResult,
  QueueEntryDetailDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { CancelBookingDialog } from "../../../../components/booking/CancelBookingDialog";
import { RescheduleBookingDialog } from "../../../../components/booking/RescheduleBookingDialog";
import { BookingActionsBar } from "../../../../components/booking/BookingActionsBar";
import { ReviewPanel } from "../../../../components/booking/ReviewPanel";
import { CheckInPanel, canCheckIn } from "../../../../components/queue/CheckInPanel";
import { QueueStatusPanel } from "../../../../components/queue/QueueStatusPanel";
import { Card } from "../../../../components/ui/Card";
import { Button, LinkButton } from "../../../../components/ui/Button";
import styles from "./bookings.module.css";

const CANCELLABLE_STATUSES = new Set(["CONFIRMED", "PENDING_PAYMENT"]);
// A booking is "upcoming" while it's still an active reservation, regardless of exact time —
// mirrors CANCELLABLE_STATUSES above (the same two statuses are, by definition, not yet resolved).
const UPCOMING_STATUSES = new Set(["CONFIRMED", "PENDING_PAYMENT"]);

function loadPage(cursor?: string): Promise<PaginatedResult<BookingDetailDto>> {
  const query = cursor ? `?cursor=${cursor}` : "";
  return apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}${query}`);
}

function statusColor(status: string): string {
  if (status === "CONFIRMED") return "var(--bc-success)";
  if (status === "PENDING_PAYMENT") return "#B36B00";
  if (status === "CANCELLED") return "var(--bc-muted)";
  if (status === "COMPLETED") return "var(--bc-ink)";
  return "var(--bc-muted)";
}

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatWhen(slotStart: string): string {
  const date = new Date(slotStart);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + ` · ${time}`;
}

function BookingRow({
  booking,
  onCancel,
  onReschedule,
  onReviewed,
}: {
  booking: BookingDetailDto;
  onCancel: (booking: BookingDetailDto) => void;
  onReschedule: (booking: BookingDetailDto) => void;
  onReviewed: (bookingId: string) => void;
}) {
  return (
    <article className={styles.bookingRow}>
      <div className={styles.bookingRowHead}>
        <strong>{booking.serviceName}</strong>
        <span className={styles.statusBadge} style={{ color: statusColor(booking.status) }}>
          {formatStatus(booking.status)}
        </span>
      </div>
      <p className={styles.bookingRowSalon}>
        {booking.salonName} — {new Date(booking.slotStart).toLocaleString()}
      </p>
      {booking.preferredStaffName && (
        <p className={styles.bookingRowMeta}>Preferred barber: {booking.preferredStaffName}</p>
      )}
      {booking.selectedStyleName && <p className={styles.bookingRowMeta}>Style: {booking.selectedStyleName}</p>}
      {booking.cancellationChargeAmount !== null && booking.cancellationChargeAmount > 0 && (
        <p className={styles.bookingRowMeta}>Cancellation charge: {formatMoney(booking.cancellationChargeAmount, booking.currency)}</p>
      )}
      {CANCELLABLE_STATUSES.has(booking.status) && (
        <div style={{ marginTop: 8 }}>
          <Button type="button" variant="outline" onClick={() => onCancel(booking)}>
            Cancel
          </Button>
        </div>
      )}
      <BookingActionsBar booking={booking} onReschedule={onReschedule} />
      {canCheckIn(booking) && <CheckInPanel booking={booking} />}
      <ReviewPanel booking={booking} onReviewed={onReviewed} />
    </article>
  );
}

// Customer account — home/hub. Auth-gated + shell-wrapped by app/(customer)/account/layout.tsx.
// Booking fetch/cancel/check-in logic below is unchanged from before this redesign; only the
// presentation around it changed, plus one new read (active queue entry) using an endpoint
// WalkInJoinFlow/CheckInPanel already call elsewhere — no new backend functionality.
export default function MyBookingsPage() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingDetailDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingDetailDto | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingDetailDto | null>(null);
  const [activeQueueEntry, setActiveQueueEntry] = useState<QueueEntryDetailDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        return loadPage();
      })
      .then((result) => {
        if (cancelled || !result) return;
        setBookings(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your bookings. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same endpoint WalkInJoinFlow/CheckInPanel already call — surfaced here too so an active queue
  // token is visible from the customer's home page, not only from the salon page it was joined on.
  useEffect(() => {
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((entry) => {
        if (!cancelled) setActiveQueueEntry(entry);
      })
      .catch(() => {
        /* no active entry, or a transient error — simply don't show the section */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const result = await loadPage(nextCursor);
      setBookings((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more bookings.");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleCancelled(result: CancelBookingResponseDto) {
    setBookings((prev) => prev.map((b) => (b.id === result.booking.id ? result.booking : b)));
    setCancelTarget(null);
  }

  function handleRescheduled(updated: BookingDetailDto) {
    setBookings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    setRescheduleTarget(null);
  }

  function handleReviewed(bookingId: string) {
    setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, hasReview: true } : b)));
  }

  const upcoming = bookings.filter((b) => UPCOMING_STATUSES.has(b.status));
  const past = bookings.filter((b) => !UPCOMING_STATUSES.has(b.status));
  const nextBooking = [...upcoming].sort(
    (a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime(),
  )[0];

  const identifier = user?.email ?? user?.phone ?? "";

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.heroEyebrow}>YOUR BARBERCUE</p>
          <h1 className={styles.welcome}>Good to see you.</h1>
          <p className={styles.welcomeSub}>Your next chair, active queue and booking history—organised around your day.</p>
        </div>
        {identifier && (
          <div className={styles.identityCard}>
            <span>Signed in as</span>
            <strong>{identifier}</strong>
          </div>
        )}
      </header>

      {error && (
        <div className={styles.errorPanel} role="alert">
          <strong>We couldn&apos;t load everything.</strong>
          <p>{error} Refresh the page to try again.</p>
        </div>
      )}

      {/* ---------- Your next chair ---------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Your next chair</h2>
        {loading ? (
          <Card className={styles.loadingCard}>
            <span className={styles.loadingPulse} aria-hidden="true" />
            <p role="status">Loading your next chair…</p>
          </Card>
        ) : nextBooking ? (
          <Card raised className={styles.nextChairCard}>
            <span className={styles.nextChairEyebrow}>Upcoming</span>
            <span className={styles.nextChairWhen}>{formatWhen(nextBooking.slotStart)}</span>
            <span className={styles.nextChairSalon}>{nextBooking.salonName}</span>
            <span className={styles.nextChairMeta}>{nextBooking.serviceName}</span>
            {nextBooking.preferredStaffName && (
              <span className={styles.nextChairMeta}>With {nextBooking.preferredStaffName}</span>
            )}
            {nextBooking.selectedStyleName && (
              <span className={styles.nextChairMeta}>Style: {nextBooking.selectedStyleName}</span>
            )}
            <span className={styles.nextChairStatus} style={{ color: statusColor(nextBooking.status) }}>
              {formatStatus(nextBooking.status)}
            </span>
            <div className={styles.nextChairActions}>
              {CANCELLABLE_STATUSES.has(nextBooking.status) && (
                <Button variant="outline" onClick={() => setCancelTarget(nextBooking)}>
                  Cancel
                </Button>
              )}
            </div>
            <BookingActionsBar booking={nextBooking} onReschedule={setRescheduleTarget} />
            {canCheckIn(nextBooking) && <CheckInPanel booking={nextBooking} />}
          </Card>
        ) : (
          <Card className={styles.emptyState}>
            <svg className={styles.emptyIcon} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="10" y="14" width="44" height="36" rx="4" stroke="currentColor" strokeWidth="2.5" />
              <path d="M10 24H54" stroke="currentColor" strokeWidth="2.5" />
              <path d="M20 10V18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M44 10V18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <p className={styles.emptyTitle}>Your chair is waiting.</p>
            <p className={styles.emptyText}>
              Find a barber, check the wait, and book your next appointment in a minute.
            </p>
            <div className={styles.emptyActions}>
              <LinkButton href="/search" variant="primary">
                Find a Barber
              </LinkButton>
              <LinkButton href="/style-advisor" variant="outline">
                Try the AI Style Advisor
              </LinkButton>
            </div>
          </Card>
        )}
      </section>

      {/* ---------- Quick actions ---------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Quick actions</h2>
        <div className={styles.quickActions}>
          <Link href="/search" className={styles.quickActionCard}>
            <span className={styles.quickActionEyebrow}>DISCOVER</span>
            <p className={styles.quickActionTitle}>Find a Barber</p>
            <p className={styles.quickActionText}>Search barbershops, check services and wait times.</p>
          </Link>
          <Link href="/style-advisor" className={styles.quickActionCard}>
            <span className={styles.quickActionEyebrow}>PREVIEW</span>
            <p className={styles.quickActionTitle}>AI Style Advisor</p>
            <p className={styles.quickActionText}>Explore style options and current preview availability.</p>
          </Link>
        </div>
      </section>

      {/* ---------- Active queue ---------- */}
      {activeQueueEntry && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Active queue</h2>
          <QueueStatusPanel entry={activeQueueEntry} onEntryChange={setActiveQueueEntry} />
        </section>
      )}

      {/* ---------- My bookings ---------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Upcoming bookings</h2>
        {!loading && upcoming.length === 0 && <p className={styles.emptyListNote}>No upcoming bookings.</p>}
        {upcoming.map((booking) => (
          <BookingRow
            key={booking.id}
            booking={booking}
            onCancel={setCancelTarget}
            onReschedule={setRescheduleTarget}
            onReviewed={handleReviewed}
          />
        ))}
      </section>

      {past.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Past bookings</h2>
          {past.map((booking) => (
            <BookingRow
            key={booking.id}
            booking={booking}
            onCancel={setCancelTarget}
            onReschedule={setRescheduleTarget}
            onReviewed={handleReviewed}
          />
          ))}
        </section>
      )}

      {nextCursor && (
        <div className={styles.loadMoreWrap}>
          <Button type="button" variant="outline" onClick={() => void handleLoadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {cancelTarget && (
        <CancelBookingDialog
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}

      {rescheduleTarget && (
        <RescheduleBookingDialog
          booking={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onRescheduled={handleRescheduled}
        />
      )}
    </div>
  );
}
