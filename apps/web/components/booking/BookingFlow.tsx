"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ServiceStep } from "./ServiceStep";
import { StaffStep } from "./StaffStep";
import { DateStep } from "./DateStep";
import { SlotStep } from "./SlotStep";
import { CancelBookingDialog } from "./CancelBookingDialog";
import { CheckInPanel, canCheckIn } from "../queue/CheckInPanel";

export function BookingFlow({
  salonId,
  services,
  operatingHours,
  selectedStyleName,
  currency,
  countryCode,
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
}) {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | undefined>(undefined);
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
  const [cancelResult, setCancelResult] = useState<CancelBookingResponseDto | null>(null);

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
    const booking = cancelResult?.booking ?? confirmedBooking;
    return (
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>
          {booking.status === "CANCELLED" ? "Booking cancelled" : "Booking confirmed"}
        </h2>
        <p>
          <strong>{booking.serviceName}</strong> at {booking.salonName}
        </p>
        <p style={{ color: "#6B6357" }}>{new Date(booking.slotStart).toLocaleString()}</p>
        {booking.selectedStyleName && (
          <p style={{ color: "#6B6357" }}>Style: {booking.selectedStyleName}</p>
        )}
        <p>
          Status: <strong>{booking.status}</strong>
          {booking.status === "PENDING_PAYMENT" && booking.prepaymentRequiredAmount !== null && (
            <> — prepayment of {formatMoney(booking.prepaymentRequiredAmount, currency, countryCode)} required</>
          )}
        </p>
        {cancelResult && (
          <p>
            {cancelResult.chargeAmount > 0
              ? `A cancellation charge of ${formatMoney(cancelResult.chargeAmount, currency, countryCode)} has been added to your account.`
              : "No cancellation charge was applied."}
          </p>
        )}
        {(booking.status === "CONFIRMED" || booking.status === "PENDING_PAYMENT") && (
          <button
            type="button"
            onClick={() => setShowCancelDialog(true)}
            style={{ padding: "8px 16px", marginRight: 8 }}
          >
            Cancel this booking
          </button>
        )}
        <Link href="/account/bookings" style={{ marginLeft: 8 }}>
          View my bookings
        </Link>
        {canCheckIn(booking) && <CheckInPanel booking={booking} />}
        {showCancelDialog && (
          <CancelBookingDialog
            booking={booking}
            onClose={() => setShowCancelDialog(false)}
            onCancelled={(result) => {
              setCancelResult(result);
              setShowCancelDialog(false);
            }}
          />
        )}
      </section>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 24 }}>
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
        <section>
          <h2 style={{ fontSize: "1.1rem" }}>5. Confirm</h2>
          <p style={{ color: "#6B6357" }}>
            {services.find((s) => s.id === selectedServiceId)?.name} —{" "}
            {new Date(selectedSlot.slotStart).toLocaleString()}
            {selectedStaffId && <> with {staffOptions.find((s) => s.id === selectedStaffId)?.displayName}</>}
          </p>
          {selectedStyleName && (
            <p style={{ color: "#6B6357" }}>Style: {selectedStyleName}</p>
          )}
          {submitError && <p style={{ color: "#E24B4A" }}>{submitError}</p>}
          <button
            type="button"
            onClick={() => void handleConfirmBooking()}
            disabled={submitting}
            style={{ padding: "10px 20px", background: "#B0413E", color: "#fff", border: "none", borderRadius: 8 }}
          >
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
        </section>
      )}
    </div>
  );
}
