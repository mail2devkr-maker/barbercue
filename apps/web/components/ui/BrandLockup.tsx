import {
  FASTQUE_BRAND_ICON_DATA_URI,
  FASTQUE_BRAND_TAGLINE,
} from "@barbercue/shared";
import styles from "./brand-lockup.module.css";

export function BrandLockup({
  compact = false,
  showTagline = false,
  onDark = false,
  className = "",
}: {
  compact?: boolean;
  showTagline?: boolean;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${onDark ? styles.onDark : ""} ${className}`.trim()}
    >
      {/* The icon is a small shared data URI so web and mobile render the exact same approved
          artwork; no browser image optimisation is useful for an inline 128px brand mark. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.icon} src={FASTQUE_BRAND_ICON_DATA_URI} alt="" aria-hidden="true" />
      <span className={styles.copy}>
        <span className={styles.wordmark} aria-label="FastQue">
          <span className={styles.fast}>Fast</span>
          <span className={styles.que}>Que</span>
        </span>
        {showTagline && <span className={styles.tagline}>{FASTQUE_BRAND_TAGLINE}</span>}
      </span>
    </span>
  );
}
