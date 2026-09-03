"use client";

import { useEffect, useState } from "react";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { RecentActivityItemDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import styles from "./activity-ticker.module.css";

// Issue #13 Mission H: real, privacy-safe "last 30 minutes" activity, directly below the cover
// photo. Anonymized — see RecentActivityItemDto's own doc comment for why "first name only" isn't
// buildable from this schema without inventing a value; "Someone booked X" is strictly more
// private than a first name would have been anyway, and still delivers the real "this shop is
// active right now" signal. Fetched once client-side on mount (a real snapshot at load time, not
// a fake perpetual-motion animation) — the CSS marquee below only animates the DOM that snapshot
// produced.
function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

function activityLabel(item: RecentActivityItemDto): string {
  if (item.type === "booking") {
    return item.serviceName ? `Someone booked ${item.serviceName}` : "Someone booked an appointment";
  }
  return item.serviceName ? `Someone joined the queue for ${item.serviceName}` : "Someone joined the queue";
}

export function ActivityTicker({ salonId }: { salonId: string }) {
  const [items, setItems] = useState<RecentActivityItemDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<RecentActivityItemDto[]>(
      `${DISCOVERY_PATHS.salons}/${salonId}/booking/recent-activity`,
    )
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        // Fails closed to "no ticker" — never a fabricated fallback item.
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  if (items === null) return null; // loading — no layout shift once real data (or its absence) arrives

  if (items.length === 0) {
    return (
      <div className={styles.ticker}>
        <span className={styles.idleLabel}>Waiting for the next booking</span>
      </div>
    );
  }

  // Duplicated once so the marquee loop has no visible seam — standard CSS-marquee technique,
  // purely presentational (aria-hidden on the duplicate half).
  return (
    <div className={styles.ticker} aria-label="Recent shop activity">
      <div className={styles.track}>
        <div className={styles.trackInner}>
          {items.map((item, i) => (
            <span key={i} className={styles.item}>
              {activityLabel(item)} · {relativeTime(item.occurredAt)}
            </span>
          ))}
        </div>
        <div className={styles.trackInner} aria-hidden="true">
          {items.map((item, i) => (
            <span key={i} className={styles.item}>
              {activityLabel(item)} · {relativeTime(item.occurredAt)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
