import styles from "./brand-lockup.module.css";

// Pixel-faithful web rendering of the owner-approved premium FastQue identity. The artwork is
// served as a lossless PNG derived directly from the approved source rather than reconstructed
// with CSS/text, so the sculpted FQ emblem, dimensional FastQue lettering, ribbon-Q treatment,
// trademark and gold tagline remain visually consistent everywhere BrandLockup is used.
const FASTQUE_APPROVED_PREMIUM_LOCKUP_SRC = "/brand/fastque-premium-lockup.png";

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
