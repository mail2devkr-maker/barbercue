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
  type BookingPaymentInfoDto,
  type CancellationPolicyDto,
  type CancelBookingResponseDto,
  type CustomerCreditBalanceDto,
  type OperatingHoursDto,
  type ServiceDto,
  type StaffOptionDto,
  formatBookingArrivalTime,
  formatMoney,
  formatZonedDateTime,
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
import { BookingUpiAction } from "./BookingUpiAction";
import { hasCustomerBookingSession } from "./booking-session";
import { CheckInPanel, canCheckIn } from "../queue/CheckInPanel";
import styles from "./booking.module.css";

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
  salonTimezone,
  initialServiceId,
  initialStaffId,
}: {
  salonId: string;
  services: ServiceDto[];
  operatingHours: OperatingHoursDto[];
  currency: string | null;
  countryCode?: string | null;
  salonTimezone: string | null;
  selectedStyleName?: string;
  initialServiceId?: string;
  initialStaffId?: string | null;
}) {
  const { status: authStatus, user, googleLogin } = useAuth();
  const isCustomerSession = hasCustomerBookingSession(authStatus, user);
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
  const [cancelResult, setCancelResult] = useState<CancelBookingResponseDto | null>(null);
  const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<BookingPaymentInfoDto | null>(null);
  const [paymentInfoError, setPaymentInfoError] = useState(false);
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [creditsToRedeem, setCreditsToRedeem] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    setPaymentInfoError(false);
    apiFetch<BookingPaymentInfoDto>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.paymentInfo}`,
    )
      .then((info) => {
        if (!cancelled) setPaymentInfo(info);
      })
      .catch(() => {
        if (!cancelled) setPaymentInfoError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  useEffect(() => {
    if (!isCustomerSession) {
      setCreditsBalance(null);
      setCreditsToRedeem(0);
      return;
    }
    let cancelled = false;
    apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
      .then((result) => {
        if (!cancelled) setCreditsBalance(result.balance);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isCustomerSession]);

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
    if (!isCustomerSession || !selectedServiceId || !selectedSlot) return;
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
      if (creditsToRedeem > 0) {
        void apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
          .then((result) => setCreditsBalance(result.balance))
          .catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "SLOT_FULL" && selectedDate) {
        setSelectedSlot(null);
        const params = new URLSearchParams({ serviceId: selectedServiceId, date: selectedDate });
        if (selectedStaffId) params.set("staffId", selectedStaffId);
        void apiFetch<AvailabilitySlotDto[]>(
          `${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.availability}?${params.toString()}`,
        )
          .then(setSlots)
          .catch(() => undefined);
      }
      setSubmitError(err instanceof ApiError ? err.message : "Could not create the booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

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
            <span
              className={`${styles.confirmedIcon} ${
                cancelled ? styles.confirmedIconCancelled : styles.confirmedIconOk
              }`}
            >
              {cancelled ? "✕" : "✓"}
            </span>
            <h2 className={styles.confirmedTitle}>{cancelled ? "Booking cancelled" : "Booking confirmed"}</h2>
          </div>
          <p className={styles.summaryLine}>
            <strong>{booking.serviceName}</strong> at {booking.salonName}
          </p>
          <p className={styles.summaryLine}>
            Appointment time: <strong>{arrival.date}, {arrival.time}</strong>
            {!arrival.isDeviceLocalTimezone && " (shop's local time)"}
          </p>
          {booking.checkInOpensAt && booking.checkInDueBy && (
            <p className={styles.summaryLine}>
              Check in between:{" "}
              <strong>
                {formatZonedDateTime(booking.checkInOpensAt, booking.salonTimezone, undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {" – "}
                {formatZonedDateTime(booking.checkInDueBy, booking.salonTimezone, undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </strong>
            </p>
          )}
          {booking.selectedStyleName && <p className={styles.summaryLine}>Style: {booking.selectedStyleName}</p>}
          <p className={styles.summaryLine}>
            <span className={`${styles.statusBadge} ${statusClass}`}>{booking.status.replace(/_/g, " ")}</span>
            {booking.status === "PENDING_PAYMENT" && booking.prepaymentRequiredAmount !== null && (
              <> — prepayment of {formatMoney(booking.prepaymentRequiredAmount, currency, countryCode)} required</>
            )}
          </p>
          {!cancelled && paymentInfo?.onlinePaymentAvailable && (
            <div
              className={styles.summaryLine}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 12,
                border: "1px solid var(--bc-border)",
                borderRadius: 12,
              }}
            >
              <strong>Pay Online with UPI</strong>
              <span>Amount payable: {formatMoney(booking.payableAmount, currency, countryCode)}</span>
              <BookingUpiAction booking={booking} paymentInfo={paymentInfo} />
              {paymentInfo.paymentQrImageUrl && (
                <img
                  src={paymentInfo.paymentQrImageUrl}
                  alt="Shop UPI payment QR"
                  width={220}
                  height={220}
                  style={{ maxWidth: "100%", objectFit: "contain" }}
                />
              )}
              <span>
                Scan this shop QR with your UPI app. Opening/scanning the QR does not make FastQue mark payment as
                paid; settlement is not automatically verified in V1.
              </span>
            </div>
          )}
          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (
            <p className={styles.summaryLine}>
              {formatMoney(booking.creditsRedeemedAmount, currency, countryCode)} in FastQue Credits applied — pay{" "}
              {formatMoney(booking.payableAmount, currency, countryCode)}{" "}
              {paymentInfo?.onlinePaymentAvailable ? "using the shop's UPI option or at the shop." : "at the shop."}
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
        <DateStep
          operatingHours={operatingHours}
          selectedDate={selectedDate}
          onSelect={handleSelectDate}
          salonTimezone={salonTimezone}
        />
      )}

      {selectedDate && (
        <SlotStep
          slots={slots}
          selectedSlot={selectedSlot}
          onSelect={setSelectedSlot}
          loading={slotsLoading}
          salonTimezone={salonTimezone}
        />
      )}

      {selectedSlot && (
        <section className={styles.stepCard}>
          <h2 className={styles.stepHeading}>
            <span className={styles.stepNumber}>5</span> Confirm
          </h2>
          {(() => {
            const arrival = formatBookingArrivalTime(selectedSlot.slotStart, salonTimezone);
            return (
              <p className={styles.summaryLine}>
                <strong>{services.find((s) => s.id === selectedServiceId)?.name}</strong> —{" "}
                {arrival.date}, {arrival.time}
                {!arrival.isDeviceLocalTimezone && " (shop's local time)"}
                {selectedStaffId && <>
                  {" "}with {staffOptions.find((s) => s.id === selectedStaffId)?.displayName}
                </>}
              </p>
            );
          })()}
          {selectedStyleName && <p className={styles.summaryLine}>Style: {selectedStyleName}</p>}
          {cancellationPolicy && (
            <p className={styles.summaryLine}>
              Free cancellation up to{" "}
              {formatFreeCancellationWindow(cancellationPolicy.effectiveFreeCancellationWindowMinutes)} before your
              appointment.
            </p>
          )}
          {isCustomerSession &&
            creditsBalance !== null &&
            creditsBalance > 0 &&
            (() => {
              const servicePrice = services.find((s) => s.id === selectedServiceId)?.price ?? 0;
              const maxRedeemable = Math.min(creditsBalance, computeMaxRedeemableCredits(servicePrice));
              if (maxRedeemable <= 0) return null;
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
                      ? `Applying ${formatMoney(creditsToRedeem, currency, countryCode)} in FastQue Credits — the final payable amount is confirmed by FastQue after the booking is created.`
                      : "Slide to apply credits"}
                  </p>
                </div>
              );
            })()}
          <div
            className={styles.summaryLine}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              border: "1px solid var(--bc-border)",
              borderRadius: 12,
            }}
          >
            <strong>Payment</strong>
            {paymentInfo?.onlinePaymentAvailable ? (
              <>
                <span>Pay Online with UPI</span>
                <span>
                  Online UPI payment is available. FastQue will show the shop QR and the exact server-confirmed amount
                  after your booking is created.
                </span>
              </>
            ) : paymentInfoError ? (
              <>
                <span>Pay at shop</span>
                <span>Online payment details could not be loaded. You can still confirm this booking and pay at the shop.</span>
              </>
            ) : paymentInfo ? (
              <>
                <span>Pay at shop</span>
                <span>Online payment is not configured for this shop. You can still confirm now and pay the shop directly.</span>
              </>
            ) : (
              <>
                <span>Payment option loading…</span>
                <span>You can still confirm the booking while FastQue checks whether online UPI is available.</span>
              </>
            )}
          </div>
          {submitError && <p className={styles.errorText}>{submitError}</p>}
          <div className={styles.confirmActions}>
            {isCustomerSession ? (
              <Button type="button" variant="primary" onClick={() => void handleConfirmBooking()} disabled={submitting}>
                {submitting ? "Booking…" : "Confirm booking"}
              </Button>
            ) : authStatus === "loading" ? (
              <p className={styles.summaryLine}>Loading…</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                <p className={styles.summaryLine}>
                  {authStatus === "authenticated"
                    ? "You are signed in with a shop/admin session. Continue as a customer to confirm this booking — your selected service, barber, date and time will stay selected."
                    : "Sign in to confirm this booking"}
                </p>
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
