"use client";

import { useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerBookingDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { formatShopDate, formatShopTime } from "./format";
import { InvoiceAction } from "./InvoiceActions";
import { Banner, Btn, BtnLink, Dialog } from "./parts";
import { CancelAppointmentDialog } from "./StaffHome";
import { SlotPicker } from "./SlotPicker";
import ui from "./owner.module.css";

const ACTOR_TEXT: Record<string, string> = {
  CUSTOMER: "the customer",
  OWNER: "the shop owner",
  STAFF: "a barber",
  SYSTEM: "the system",
  ADMIN: "FastQue support",
};

/**
 * What the shop can do with one booking: call the customer, cancel it (the customer is notified that
 * THE SHOP cancelled), move it to another real free time (the customer is notified), or - once the
 * service is done - invoice it. Each action is also enforced on the server; this only decides what
 * to offer.
 */
export function ShopBookingActions({ booking, onOutcome }: { booking: OwnerBookingDetailDto; onOutcome?: (message: string) => void }) {
  const salonId = booking.salonId;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const live = booking.status === "CONFIRMED" || booking.status === "PENDING_PAYMENT";
  const phone = booking.customerPhone ?? booking.guestPhone ?? null;
  const label = `${booking.serviceName} · ${formatShopDate(booking.slotStart, booking.salonTimezone)} ${formatShopTime(booking.slotStart, booking.salonTimezone)}`;

  return (
    <div className={ui.stackSm} style={{ marginTop: 12 }}>
      {notice && <Banner tone="ok">{notice}</Banner>}
      {booking.status === "CANCELLED" && (
        <div className={ui.cardSub}>
          Cancelled by <strong>{booking.cancelledByActor ? ACTOR_TEXT[booking.cancelledByActor] : "—"}</strong>
          {booking.cancelledByActor ? "" : " (not recorded for this older booking)"}
          {booking.cancellationReason ? ` · reason: “${booking.cancellationReason}”` : ""}
        </div>
      )}
      <div className={ui.rowWrap}>
        {phone && (
          <a className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`} href={`tel:${phone}`}>
            Call customer
          </a>
        )}
        {live && (
          <>
            <Btn small onClick={() => setMoveOpen(true)}>
              Reschedule
            </Btn>
            <Btn small variant="danger" onClick={() => setCancelOpen(true)}>
              Cancel appointment
            </Btn>
          </>
        )}
        {booking.status === "COMPLETED" && <InvoiceAction salonId={salonId} bookingId={booking.id} />}
        {booking.status === "CANCELLED" && booking.cancellationChargeAmount !== null && booking.customerId && (
          <BtnLink small href={`/dashboard/salons/${salonId}/customers/${booking.customerId}`}>
            Review cancellation charge
          </BtnLink>
        )}
      </div>

      {cancelOpen && (
        <CancelAppointmentDialog
          salonId={salonId}
          bookingId={booking.id}
          label={label}
          onClose={() => setCancelOpen(false)}
          onDone={(message) => {
            setNotice(message);
            // The list reloads (and remounts this card), so the outcome is also handed to the page,
            // which keeps it on screen. Without a page to hand it to, reload as a backstop.
            if (onOutcome) onOutcome(message);
            else window.setTimeout(() => window.location.reload(), 1600);
          }}
        />
      )}
      {moveOpen && (
        <RescheduleDialog
          booking={booking}
          onClose={() => setMoveOpen(false)}
          onDone={(message) => {
            setNotice(message);
            if (onOutcome) onOutcome(message);
            else window.setTimeout(() => window.location.reload(), 1600);
          }}
        />
      )}
    </div>
  );
}

function RescheduleDialog({ booking, onClose, onDone }: { booking: OwnerBookingDetailDto; onClose: () => void; onDone: (message: string) => void }) {
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serviceIds = booking.services.map((s) => s.serviceId);

  async function submit() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ notification: { inApp: string } }>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${booking.salonId}/bookings/${booking.id}/reschedule`,
        { method: "POST", headers: { "Idempotency-Key": newIdempotencyKey() }, body: JSON.stringify({ slotStart: slot }) },
      );
      onDone(
        result.notification.inApp === "NO_ACCOUNT"
          ? "Appointment moved. This guest has no FastQue account, so no notification was sent."
          : "Appointment moved and the customer was told about the new time.",
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not move the appointment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Move this appointment" onClose={onClose}>
      <p>
        {booking.serviceName}, now {formatShopDate(booking.slotStart, booking.salonTimezone)} at {formatShopTime(booking.slotStart, booking.salonTimezone)}. Pick a new free time; the customer is notified of the change.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      <SlotPicker salonId={booking.salonId} serviceIds={serviceIds} staffId={booking.preferredStaffId ?? undefined} timeZone={booking.salonTimezone} value={slot} onChange={setSlot} idPrefix="mv" />
      <div className={ui.dialogActions}>
        <Btn variant="quiet" onClick={onClose}>
          Keep current time
        </Btn>
        <Btn variant="primary" disabled={!slot || busy} onClick={() => void submit()}>
          {busy ? "Moving…" : "Move appointment"}
        </Btn>
      </div>
    </Dialog>
  );
}
