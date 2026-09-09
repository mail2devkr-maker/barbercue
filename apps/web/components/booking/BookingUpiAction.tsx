"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { buildBookingUpiUri, canLaunchBookingUpi, UPI_FALLBACK_NOTICE, UPI_PAYMENT_NOTICE,
  type BookingDetailDto, type BookingPaymentInfoDto } from "@barbercue/shared";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Button } from "../ui/Button";

// User-agent capability is immutable during a page visit; SSR keeps the safe QR fallback.
const subscribeToBrowser = () => () => {};
const mobileBrowserSnapshot = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const serverBrowserSnapshot = () => false;

export function BookingUpiAction({ booking, paymentInfo }: {
  booking: BookingDetailDto | null;
  paymentInfo: BookingPaymentInfoDto | null;
}) {
  const mobileBrowser = useSyncExternalStore(subscribeToBrowser, mobileBrowserSnapshot, serverBrowserSnapshot);
  const [notice, setNotice] = useState<string | null>(null);
  const opening = useRef(false);
  if (!booking || !['CONFIRMED', 'PENDING_PAYMENT'].includes(booking.status)
    || !paymentInfo?.onlinePaymentAvailable || !paymentInfo.paymentQrImageUrl) return null;

  function pay() {
    if (!mobileBrowser || opening.current) return;
    opening.current = true;
    try {
      const uri = buildBookingUpiUri(booking, paymentInfo, newIdempotencyKey());
      if (!uri) { setNotice(UPI_FALLBACK_NOTICE); return; }
      // Browser handlers cannot prove success, or even handler availability. Always retain QR.
      setNotice(`${UPI_PAYMENT_NOTICE} ${UPI_FALLBACK_NOTICE}`);
      window.location.assign(uri);
    } catch {
      setNotice(UPI_FALLBACK_NOTICE);
    } finally {
      opening.current = false;
    }
  }

  async function copyVpa() {
    try {
      await navigator.clipboard.writeText(paymentInfo!.upiVpa!);
      setNotice(`UPI ID copied. ${UPI_PAYMENT_NOTICE}`);
    } catch {
      setNotice('Select and copy the displayed UPI ID, or scan the QR from your phone.');
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowWrap: "anywhere" }}>
      {mobileBrowser && canLaunchBookingUpi(booking, paymentInfo) && (
        <Button type="button" onClick={pay}>Pay Now with UPI</Button>
      )}
      {!mobileBrowser && <span>Pay from your phone: scan the shop QR or use the UPI ID in your UPI app.</span>}
      {paymentInfo.upiVpa && <span>UPI ID: <strong>{paymentInfo.upiVpa}</strong>{" "}
        <Button type="button" variant="outline" onClick={() => void copyVpa()}>Copy UPI ID</Button></span>}
      {paymentInfo.upiPayeeName && <span>Payee: {paymentInfo.upiPayeeName}</span>}
      <span role="status">{notice ?? UPI_PAYMENT_NOTICE}</span>
      {booking.payableAmount === 0 && <span>No amount is due for this booking. Do not send a UPI payment.</span>}
    </div>
  );
}
