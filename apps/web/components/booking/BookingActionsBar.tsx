"use client";

import { useState } from "react";
import Link from "next/link";
import type { BookingDetailDto } from "@barbercue/shared";
import { directionsUrl, rebookUrl, salonPageUrl, shareOrCopy, whatsappShareUrl } from "../../lib/booking-actions";
import styles from "./booking.module.css";

const CANCELLABLE_STATUSES = new Set(["CONFIRMED", "PENDING_PAYMENT"]);

/** Directions/Share/Book again/Reschedule — the convenience actions available on any booking row,
 * shared by "my bookings", the next-chair card, and the post-confirm view so the four never drift
 * apart into subtly different implementations. */
export function BookingActionsBar({
  booking,
  onReschedule,
}: {
  booking: BookingDetailDto;
  onReschedule?: (booking: BookingDetailDto) => void;
}) {
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  async function handleShare() {
    const result = await shareOrCopy({
      title: booking.salonName,
      text: `Book at ${booking.salonName} on BarberCue`,
      url: salonPageUrl(booking),
    });
    if (result === "shared") setShareStatus(null);
    else if (result === "copied") setShareStatus("Link copied to clipboard.");
    else if (result === "unsupported") setShareStatus("Sharing isn't supported on this browser.");
    else setShareStatus(null);
  }

  return (
    <div className={styles.actionsBar}>
      <a href={directionsUrl(booking)} target="_blank" rel="noopener noreferrer" className={styles.actionLink}>
        Get Directions
      </a>
      <button type="button" className={styles.actionLink} onClick={() => void handleShare()}>
        Share
      </button>
      <a
        href={whatsappShareUrl(`Check out ${booking.salonName} on BarberCue: ${salonPageUrl(booking)}`)}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.actionLink}
      >
        Share on WhatsApp
      </a>
      <Link href={rebookUrl(booking)} className={styles.actionLink}>
        Book again
      </Link>
      {onReschedule && CANCELLABLE_STATUSES.has(booking.status) && (
        <button type="button" className={styles.actionLink} onClick={() => onReschedule(booking)}>
          Reschedule
        </button>
      )}
      {shareStatus && <span className={styles.shareStatus}>{shareStatus}</span>}
    </div>
  );
}
