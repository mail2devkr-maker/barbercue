"use client";

import { useSyncExternalStore } from "react";
import {
  MAINTENANCE_ADVICE,
  MAINTENANCE_HEADLINE,
  MAINTENANCE_MESSAGE,
  MAINTENANCE_WINDOW_TEXT,
  isMaintenanceNoticeVisible,
} from "../../lib/maintenance-notice";
import styles from "./maintenance-notice.module.css";

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

const visibleNow = (): boolean => isMaintenanceNoticeVisible(Date.now());
// The static page always carries the notice (the server snapshot is "visible"); only a clock past the end of the window hides it.
const visibleOnServer = (): boolean => true;

/**
 * Advance announcement of the approved maintenance window.
 *  - "banner": the visible strip, placed inside the fixed site header.
 *  - "spacer": an invisible, in-flow copy that reserves the height the banner adds to that fixed header.
 *  - "inline": the owner dashboard's version, at the top of its content column.
 */
export function MaintenanceNotice({ variant = "banner" }: { variant?: "banner" | "spacer" | "inline" }) {
  const visible = useSyncExternalStore(subscribe, visibleNow, visibleOnServer);
  if (!visible) return null;

  const content = (
    <div className={styles.inner}>
      <strong>{MAINTENANCE_HEADLINE}:</strong> {MAINTENANCE_WINDOW_TEXT}. {MAINTENANCE_MESSAGE}{" "}
      <span className={styles.advice}>{MAINTENANCE_ADVICE}</span>
    </div>
  );

  if (variant === "spacer") {
    return (
      <div className={`${styles.bar} ${styles.spacer}`} aria-hidden="true">
        {content}
      </div>
    );
  }
  return (
    <div
      className={`${styles.bar} ${variant === "inline" ? styles.inline : ""}`}
      role="region"
      aria-label="Scheduled maintenance notice"
      data-testid="maintenance-notice"
    >
      {content}
    </div>
  );
}
