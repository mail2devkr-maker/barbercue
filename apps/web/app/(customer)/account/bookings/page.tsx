"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BOOKING_PATHS, QUEUE_ENTRIES_PATH,
  formatBookingArrivalTime,
  formatMoney,
  formatZonedDateTime,
  zonedDateKey,
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

// Part 5 (show arrival time after booking): "Today"/"Tomorrow" is judged by the salon's own
// calendar day (zonedDateKey), not the device's — a shop many hours away can already be in its
// next/previous day relative to the customer's own clock. The clock time itself always goes
// through formatBookingArrivalTime, never a bare toLocaleTimeString, for the same reason.
function formatWhen(slotStart: string, salonTimezone: string | null): string {
  const arrival = formatBookingArrivalTime(slotStart, salonTimezone);
  const todayKey = zonedDateKey(new Date().toISOString(), salonTimezone);
  const tomorrowKey = zonedDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), salonTimezone);
  const targetKey = zonedDateKey(slotStart, salonTimezone);
  const suffix = arrival.isDeviceLocalTimezone ? "" : " (shop's local time)";
  if (targetKey === todayKey) return `Today · ${arrival.time}${suffix}`;
  if (targetKey === tomorrowKey) return `Tomorrow · ${arrival.time}${suffix}`;
  return `${arrival.date} · ${arrival.time}${suffix}`;
}

// Part 5 completion (arrival guidance) — compact single-line form for a dense list row; the full
// "Check in between X – Y" window is shown on the primary "Next chair" card below instead, per the
// "don't clutter compact cards" guidance. Both null (see BookingDetailDto's doc comment) means no
// guidance applies, so this returns null rather than fabricating one.
function checkInByLabel(booking: BookingDetailDto): string | null {
  if (!booking.checkInDueBy) return null;
  const time = formatZonedDateTime(booking.checkInDueBy, booking.salonTimezone, undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Check in by ${time}`;
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
        {booking.salonName} — {formatWhen(booking.slotStart, booking.salonTimezone)}
      </p>
      {checkInByLabel(booking) && <p className={styles.bookingRowMeta}>{checkInByLabel(booking)}</p>}
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

  useEffect(() => {
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((entry) => {
        if (!cancelled) setActiveQueueEntry(entry);
      })
      .catch(() => {});
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
          <p className={styles.heroEyebrow}>YOUR FASTQUE</p>
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
            <span className={styles.nextChairWhen}>{formatWhen(nextBooking.slotStart, nextBooking.salonTimezone)}</span>
            <span className={styles.nextChairSalon}>{nextBooking.salonName}</span>
            <span className={styles.nextChairMeta}>{nextBooking.serviceName}</span>
            {/* Part 5 completion (arrival guidance) — the full check-in window, since this is the
                one prominent "detail-like" card on web (there is no separate per-booking detail
                page); the compact list rows below show only the terser checkInByLabel instead. */}
            {nextBooking.checkInOpensAt && nextBooking.checkInDueBy && (
              <span className={styles.nextChairMeta}>
                Check in between{" "}
                {formatZonedDateTime(nextBooking.checkInOpensAt, nextBooking.salonTimezone, undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {" – "}
                {formatZonedDateTime(nextBooking.checkInDueBy, nextBooking.salonTimezone, undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            )}
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

      {activeQueueEntry && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Active queue</h2>
          <QueueStatusPanel entry={activeQueueEntry} onEntryChange={setActiveQueueEntry} />
        </section>
      )}

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
