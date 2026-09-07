import styles from "./brand-lockup.module.css";

// Pixel-faithful web rendering of the owner-approved premium FastQue identity. Keep a versioned
// URL so browsers/CDNs cannot keep serving an older cached raster after the approved artwork is
// replaced under the same public path.
const FASTQUE_APPROVED_PREMIUM_LOCKUP_SRC =
  "/brand/fastque-premium-lockup.png?v=20260908-watermark";

export function BrandLockup({
  compact = false,
  showTagline = false,
  className = "",
}: {
  compact?: boolean;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${className}`.trim()}
      data-show-tagline={showTagline ? "true" : "false"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.art}
        src={FASTQUE_APPROVED_PREMIUM_LOCKUP_SRC}
        alt="FastQue — Good Looks, Less Waiting"
      />
    </span>
  );
}
