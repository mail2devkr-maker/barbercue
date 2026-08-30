"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BOOKING_PATHS,
  DISCOVERY_PATHS,
  SALON_BOOKING_INFO_PATHS,
  type AvailabilitySlotDto,
  type BookingDetailDto,
  type CancelBookingResponseDto,
  type OperatingHoursDto,
  type ServiceDto,
  type StaffOptionDto,
  formatMoney,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";
import { ServiceStep } from "./ServiceStep";
import { StaffStep } from "./StaffStep";
import { DateStep } from "./DateStep";
import { SlotStep } from "./SlotStep";
import { CancelBookingDialog } from "./CancelBookingDialog";
import { RescheduleBookingDialog } from "./RescheduleBookingDialog";
import { BookingActionsBar } from "./BookingActionsBar";
import { CheckInPanel, canCheckIn } from "../queue/CheckInPanel";
import styles from "./booking.module.css";

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
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(initialServiceId ?? null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | undefined>(initialStaffId);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlotDto | null>(null);

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
        }),
      });
      setConfirmedBooking(booking);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not create the booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedBooking) {
    const booking = confirmedBooking;
    const cancelled = booking.status === "CANCELLED";
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
          <p className={styles.summaryLine}>{new Date(booking.slotStart).toLocaleString()}</p>
          {booking.selectedStyleName && <p className={styles.summaryLine}>Style: {booking.selectedStyleName}</p>}
          <p className={styles.summaryLine}>
            <span className={`${styles.statusBadge} ${statusClass}`}>{booking.status.replace(/_/g, " ")}</span>
            {booking.status === "PENDING_PAYMENT" && booking.prepaymentRequiredAmount !== null && (
              <> — prepayment of {formatMoney(booking.prepaymentRequiredAmount, currency, countryCode)} required</>
            )}
          </p>
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
          {submitError && <p className={styles.errorText}>{submitError}</p>}
          <div className={styles.confirmActions}>
            <Button type="button" variant="primary" onClick={() => void handleConfirmBooking()} disabled={submitting}>
              {submitting ? "Booking…" : "Confirm booking"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
