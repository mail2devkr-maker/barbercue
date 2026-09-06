"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BOOKING_PATHS,
  CREDITS_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  computeMaxRedeemableCredits,
  type AvailabilitySlotDto,
  type BookingDetailDto,
  type CancellationPolicyDto,
  type CancelBookingResponseDto,
  type CustomerCreditBalanceDto,
  type OperatingHoursDto,
  type ServiceDto,
  type StaffOptionDto,
  formatBookingArrivalTime,
  formatMoney,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../ui/Button";
import { GoogleIdentityButton } from "../auth/GoogleIdentityButton";
import { ServiceStep } from "./ServiceStep";
import { StaffStep } from "./StaffStep";
import { DateStep } from "./DateStep";
import { SlotStep } from "./SlotStep";
import { CancelBookingDialog } from "./CancelBookingDialog";
import { RescheduleBookingDialog } from "./RescheduleBookingDialog";
import { BookingActionsBar } from "./BookingActionsBar";
import { CheckInPanel, canCheckIn } from "../queue/CheckInPanel";
import styles from "./booking.module.css";

// Part O (Customer Dues + Cancellation Policy mission): "Free cancellation up to 1 hour before
// your appointment" — but only ever the real effective window, never a hard-coded "1 hour" when a
// salon's own policy is more generous. 60/120/etc render as whole hours; anything else falls back
// to a plain minute count rather than an awkward "1 hour 30 minutes".
function formatFreeCancellationWindow(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

export function BookingFlow({
  salonId,
  services,
  operatingHours,
  selectedStyleName,
  currency,
  countryCode,
  initialServiceId,
  initialStaffId,
}: {
  salonId: string;
  services: ServiceDto[];
  operatingHours: OperatingHoursDto[];
  // From the salon this flow belongs to — every amount shown here is in its currency.
  currency: string | null;
  countryCode?: string | null;
  // AI Style Advisor hand-off (major-upgrade phase) — set only when this flow was reached via
  // "Try This Look"; threaded straight into the booking-creation body when present.
  selectedStyleName?: string;
  // "Book again" hand-off (Phase 3, customer convenience) — preselects service/barber from a past
  // booking, same idea as selectedStyleName's Style Advisor hand-off. The customer still
  // explicitly picks a new date and slot below; nothing here assumes the old slot is available.
  initialServiceId?: string;
  initialStaffId?: string | null;
}) {
  const { status: authStatus, googleLogin } = useAuth();
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(initialServiceId ?? null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | undefined>(initialStaffId);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlotDto | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const [staffOptions, setStaffOptions] = useState<StaffOptionDto[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<BookingDetailDto | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // Only the charge-amount/ledger fields are read off this — the booking itself always comes from
  // confirmedBooking (updated in place by both onCancelled and onRescheduled below) so the two
  // actions can never race each other for which one's "latest" booking gets displayed.
  const [cancelResult, setCancelResult] = useState<CancelBookingResponseDto | null>(null);
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);

  // FastQue Credits / Wallet V1 — the customer's live wallet balance, fetched once they're signed
  // in and reach the Confirm step (never before: an anonymous visitor has no balance to show).
  // creditsToRedeem is a plain number input, re-clamped to [0, min(balance, price)] on every
  // change so the displayed payable amount is always consistent with what the server will actually
  // accept — the server re-validates this again regardless (see BookingsService.create), this is
  // only for a sane, honest preview.
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [creditsToRedeem, setCreditsToRedeem] = useState(0);

  // Part O — fetched once per salon, shown alongside the Confirm step so the customer knows the
  // real policy before they book, not just at cancel time (CancelBookingDialog fetches it again
  // itself for the live charge preview, deliberately not shared state — see that component).
  useEffect(() => {
    let cancelled = false;
    apiFetch<CancellationPolicyDto>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.cancellationPolicy}`,
    )
      .then((policy) => {
        if (!cancelled) setCancellationPolicy(policy);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  // FastQue Credits / Wallet V1 — only fetched once signed in; an anonymous visitor has no wallet.
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
      .then((result) => {
        if (!cancelled) setCreditsBalance(result.balance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  // Stable across retries of the exact same attempt (same service/staff/date/slot); regenerates
  // the moment any earlier choice changes, since that's a materially different attempt. The deps
  // are deliberately not read inside the memo callback — they're a recompute trigger only.
  const idempotencyKey = useMemo(
    () => newIdempotencyKey(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedServiceId, selectedStaffId, selectedDate, selectedSlot?.slotStart],
  );

  function handleSelectService(id: string) {
    setSelectedServiceId(id);
    setSelectedStaffId(undefined);
    setSelectedDate(null);
    setSelectedSlot(null);
    setSlots([]);
  }

  function handleSelectStaff(id: string | null) {
    setSelectedStaffId(id);
    setSelectedDate(null);
    setSelectedSlot(null);
    setSlots([]);
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    setSelectedSlot(null);
  }

  useEffect(() => {
    if (!selectedServiceId) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setStaffLoading(true);
        return apiFetch<StaffOptionDto[]>(
          `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.staff}?serviceId=${selectedServiceId}`,
        );
      })
      .then((options) => {
        if (!cancelled && options) setStaffOptions(options);
      })
      .catch(() => {
        if (!cancelled) setStaffOptions([]);
      })
      .finally(() => {
        if (!cancelled) setStaffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedServiceId, salonId]);

  useEffect(() => {
    if (!selectedServiceId || !selectedDate || selectedStaffId === undefined) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setSlotsLoading(true);
        const params = new URLSearchParams({ serviceId: selectedServiceId, date: selectedDate });
        if (selectedStaffId) params.set("staffId", selectedStaffId);
        return apiFetch<AvailabilitySlotDto[]>(
          `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
        );
      })
      .then((result) => {
        if (!cancelled && result) setSlots(result);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedServiceId, selectedDate, selectedStaffId, salonId]);

  async function refreshCurrentAvailability() {
    if (!selectedServiceId || !selectedDate) return;
    const params = new URLSearchParams({ serviceId: selectedServiceId, date: selectedDate });
    if (selectedStaffId) params.set("staffId", selectedStaffId);
    const result = await apiFetch<AvailabilitySlotDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
    );
    setSlots(result);
  }

  async function handleConfirmBooking() {
    if (!selectedServiceId || !selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const booking = await apiFetch<BookingDetailDto>(BOOKING_PATHS.bookings, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          salonId,
          serviceId: selectedServiceId,
          slotStart: selectedSlot.slotStart,
          ...(selectedStaffId ? { preferredStaffId: selectedStaffId } : {}),
          ...(selectedStyleName ? { selectedStyleName } : {}),
          ...(creditsToRedeem > 0 ? { creditsToRedeem } : {}),
        }),
      });
      void refreshCurrentAvailability().catch(() => undefined);
      setConfirmedBooking(booking);
      setCreditsToRedeem(0);
      // Redemption never fails/rejects — the server always clamps and the booking always succeeds
      // (see BookingsService.create) — so a successful response can still mean some or all of the
      // requested credits were actually applied. Re-fetch the real balance rather than
      // locally subtracting creditsToRedeem, since the server's actualUsed
      // (booking.creditsRedeemedAmount) may be less than what was requested.
      if (creditsToRedeem > 0) {
        void apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
          .then((result) => setCreditsBalance(result.balance))
          .catch(() => undefined);
      }
    } catch (err) {
      // The availability grid is advisory; the booking transaction is authoritative. If another
      // customer won the last capacity concurrently, clear the stale selection and immediately
      // reload the grid so the occupied state is visible without a page refresh.
      if (err instanceof ApiError && err.code === "SLOT_FULL" && selectedDate) {
        setSelectedSlot(null);
        const params = new URLSearchParams({ serviceId: selectedServiceId, date: selectedDate });
        if (selectedStaffId) params.set("staffId", selectedStaffId);
        void apiFetch<AvailabilitySlotDto[]>(
          `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
        ).then(setSlots).catch(() => undefined);
      }
      // A failed create (e.g. SLOT_FULL) never reaches the redemption step at all — the whole
      // transaction rolls back — so the wallet balance is genuinely untouched and doesn't need
      // re-fetching here.
      setSubmitError(err instanceof ApiError ? err.message : "Could not create the booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Issue #13 Mission E: Google Identity Services renders as an in-page button/overlay, never a
  // full-page redirect, so every selection above (service/staff/date/slot) is still exactly what
  // it was the moment authStatus flips to "authenticated" — no restart, no re-pick, no need to
  // serialize state across a navigation that never happens.
  async function handleGoogleCredential(idToken: string) {
    setSubmitError(null);
    setGoogleSubmitting(true);
    try {
      await googleLogin({ idToken });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not sign in with Google. Please try again.");
    } finally {
      setGoogleSubmitting(false);
    }
  }

  // Root cause of "can't book a second service": once confirmedBooking was set, this component
  // had no path back to the picker steps at all — the early `if (confirmedBooking) return ...`
  // below is permanent for the lifetime of this component instance, and nothing ever set
  // confirmedBooking back to null. A customer landing back on this same salon's booking page
  // (e.g. via "Book again" or simply not navigating away) was stuck looking at their first
  // booking's confirmation forever, with no way to start another one from this screen. This does
  // NOT touch cancel/reschedule (those correctly update the SAME booking in place) or the
  // create-fails-with-SLOT_FULL path (that already stays on the picker, unaffected) — only the
  // "start a genuinely new booking attempt" gap.
  function handleBookAnother() {
    setConfirmedBooking(null);
    setCancelResult(null);
    setSubmitError(null);
    setSelectedServiceId(null);
    setSelectedStaffId(undefined);
    setSelectedDate(null);
    setSelectedSlot(null);
    setCreditsToRedeem(0);
  }

  if (confirmedBooking) {
    const booking = confirmedBooking;
    const cancelled = booking.status === "CANCELLED";
    // Part 5 (show arrival time after booking): always converted through the salon's own
    // timezone, never the device's — a customer booking a shop outside their own city/timezone
    // must never be shown a silently-wrong arrival time.
    const arrival = formatBookingArrivalTime(booking.slotStart, booking.salonTimezone);
    const statusClass =
      booking.status === "CONFIRMED"
        ? styles.statusConfirmed
        : booking.status === "PENDING_PAYMENT"
          ? styles.statusPending
          : styles.statusCancelled;
    return (
      <section className={styles.confirmedWrap}>
        <div className={styles.confirmedCard}>
          <div className={styles.confirmedHead}>
            <span className={`${styles.confirmedIcon} ${cancelled ? styles.confirmedIconCancelled : styles.confirmedIconOk}`}>
              {cancelled ? "✕" : "✓"}
            </span>
            <h2 className={styles.confirmedTitle}>{cancelled ? "Booking cancelled" : "Booking confirmed"}</h2>
          </div>
          <p className={styles.summaryLine}>
            <strong>{booking.serviceName}</strong> at {booking.salonName}
          </p>
          <p className={styles.summaryLine}>
            Arrival time: <strong>{arrival.date}, {arrival.time}</strong>
            {!arrival.isDeviceLocalTimezone && " (shop's local time)"}
          </p>
          {booking.selectedStyleName && <p className={styles.summaryLine}>Style: {booking.selectedStyleName}</p>}
          <p className={styles.summaryLine}>
            <span className={`${styles.statusBadge} ${statusClass}`}>{booking.status.replace(/_/g, " ")}</span>
            {booking.status === "PENDING_PAYMENT" && booking.prepaymentRequiredAmount !== null && (
              <> — prepayment of {formatMoney(booking.prepaymentRequiredAmount, currency, countryCode)} required</>
            )}
          </p>
          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (
            <p className={styles.summaryLine}>
              {formatMoney(booking.creditsRedeemedAmount, currency, countryCode)} in FastQue Credits applied —
              pay {formatMoney(booking.payableAmount, currency, countryCode)} at the shop&apos;s payment QR.
            </p>
          )}
          {cancelResult && (
            <p className={styles.summaryLine}>
              {cancelResult.chargeAmount > 0
                ? `A cancellation charge of ${formatMoney(cancelResult.chargeAmount, currency, countryCode)} has been added to your account.`
                : "No cancellation charge was applied."}
            </p>
          )}
          <div className={styles.confirmedActions}>
            {(booking.status === "CONFIRMED" || booking.status === "PENDING_PAYMENT") && (
              <Button type="button" variant="outline" onClick={() => setShowCancelDialog(true)}>
                Cancel this booking
              </Button>
            )}
            <Button type="button" variant="primary" onClick={handleBookAnother}>
              Book another service
            </Button>
            <Link href="/account/bookings" className={styles.textLink}>
              View my bookings
            </Link>
          </div>
          <BookingActionsBar booking={booking} onReschedule={() => setShowRescheduleDialog(true)} />
        </div>
        {canCheckIn(booking) && <CheckInPanel booking={booking} />}
        {showCancelDialog && (
          <CancelBookingDialog
            booking={booking}
            onClose={() => setShowCancelDialog(false)}
            onCancelled={(result) => {
              setCancelResult(result);
              setConfirmedBooking(result.booking);
              setShowCancelDialog(false);
            }}
          />
        )}
        {showRescheduleDialog && (
          <RescheduleBookingDialog
            booking={booking}
            onClose={() => setShowRescheduleDialog(false)}
            onRescheduled={(updated) => {
              setConfirmedBooking(updated);
              setShowRescheduleDialog(false);
            }}
          />
        )}
      </section>
    );
  }

  // Purely derived from existing selection state, for the step-progress strip only — no new
  // business state, no side effects.
  const progressSteps = [
    { key: "service", label: "Service", done: !!selectedServiceId },
    { key: "barber", label: "Barber", done: selectedStaffId !== undefined },
    { key: "date", label: "Date", done: !!selectedDate },
    { key: "time", label: "Time", done: !!selectedSlot },
    { key: "confirm", label: "Confirm", done: false },
  ];
  const currentStepIndex = progressSteps.findIndex((s) => !s.done);

  return (
    <div className={styles.flowRoot}>
      <div className={styles.progress}>
        {progressSteps.map((step, i) => (
          <Fragment key={step.key}>
            <div
              className={`${styles.progressStep} ${step.done ? styles.progressStepDone : ""} ${
                i === currentStepIndex ? styles.progressStepCurrent : ""
              }`}
            >
              <span className={styles.progressDot}>{step.done ? "✓" : i + 1}</span>
              <span className={styles.progressLabel}>{step.label}</span>
            </div>
            {i < progressSteps.length - 1 && <span className={styles.progressRule} />}
          </Fragment>
        ))}
      </div>

      <ServiceStep
        services={services}
        selectedServiceId={selectedServiceId}
        onSelect={handleSelectService}
        currency={currency}
        countryCode={countryCode}
      />

      {selectedServiceId && (
        <StaffStep
          options={staffOptions}
          selectedStaffId={selectedStaffId}
          onSelect={handleSelectStaff}
          loading={staffLoading}
        />
      )}

      {selectedServiceId && selectedStaffId !== undefined && (
        <DateStep operatingHours={operatingHours} selectedDate={selectedDate} onSelect={handleSelectDate} />
      )}

      {selectedDate && (
        <SlotStep slots={slots} selectedSlot={selectedSlot} onSelect={setSelectedSlot} loading={slotsLoading} />
      )}

      {selectedSlot && (
        <section className={styles.stepCard}>
          <h2 className={styles.stepHeading}>
            <span className={styles.stepNumber}>5</span> Confirm
          </h2>
          <p className={styles.summaryLine}>
            <strong>{services.find((s) => s.id === selectedServiceId)?.name}</strong> —{" "}
            {new Date(selectedSlot.slotStart).toLocaleString()}
            {selectedStaffId && <> with {staffOptions.find((s) => s.id === selectedStaffId)?.displayName}</>}
          </p>
          {selectedStyleName && <p className={styles.summaryLine}>Style: {selectedStyleName}</p>}
          {cancellationPolicy && (
            <p className={styles.summaryLine}>
              Free cancellation up to{" "}
              {formatFreeCancellationWindow(cancellationPolicy.effectiveFreeCancellationWindowMinutes)} before your
              appointment.
            </p>
          )}
          {authStatus === "authenticated" && creditsBalance !== null && creditsBalance > 0 && (() => {
            const servicePrice = services.find((s) => s.id === selectedServiceId)?.price ?? 0;
            // FastQue Credits / Wallet V1: the redemption cap is price-based (floor(price/50)*10),
            // NOT "whatever the wallet balance happens to be" — a customer can never redeem more
            // than 20% of the service price even with a much larger balance. This is only a
            // preview; the server independently re-derives and enforces the same cap (see
            // BookingsService.create / CustomerCreditsService.redeemUpTo) regardless of what this
            // slider sends.
            const maxRedeemable = Math.min(creditsBalance, computeMaxRedeemableCredits(servicePrice));
            if (maxRedeemable <= 0) return null;
            const payable = Math.max(0, servicePrice - creditsToRedeem);
            return (
              <div className={styles.summaryLine} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="credits-redeem">
                  You have {formatMoney(creditsBalance, currency, countryCode)} in FastQue Credits — redeem up to{" "}
                  {formatMoney(maxRedeemable, currency, countryCode)}
                </label>
                <input
                  id="credits-redeem"
                  type="range"
                  min={0}
                  max={maxRedeemable}
                  step={1}
                  value={Math.min(creditsToRedeem, maxRedeemable)}
                  onChange={(e) => setCreditsToRedeem(Number(e.target.value))}
                />
                <p>
                  {creditsToRedeem > 0
                    ? `Applying ${formatMoney(creditsToRedeem, currency, countryCode)} — you pay ${formatMoney(payable, currency, countryCode)}`
                    : "Slide to apply credits"}
                </p>
              </div>
            );
          })()}
          {submitError && <p className={styles.errorText}>{submitError}</p>}
          <div className={styles.confirmActions}>
            {authStatus === "authenticated" ? (
              <Button type="button" variant="primary" onClick={() => void handleConfirmBooking()} disabled={submitting}>
                {submitting ? "Booking…" : "Confirm booking"}
              </Button>
            ) : authStatus === "loading" ? (
              <p className={styles.summaryLine}>Loading…</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                <p className={styles.summaryLine}>Sign in to confirm this booking</p>
                <GoogleIdentityButton
                  audienceLabel="customer"
                  onCredential={(idToken) => void handleGoogleCredential(idToken)}
                  disabled={googleSubmitting}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
