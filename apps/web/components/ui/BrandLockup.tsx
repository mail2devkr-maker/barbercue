import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
const MARK_SRC = "/brand/fastque-premium-3d-mark.png";

/**
 * The owner-approved FastQue 3D artwork is served as a real public PNG. Keeping the artwork out
 * of a TS data URI gives Next a normal image request, browser caching, and an independently
 * inspectable 200/image/png response instead of silently falling back to alt text on decode.
 */
export function BrandLockup({
  compact = false,
  showTagline = false,
  markOnly = false,
  className = "",
}: {
  compact?: boolean;
  showTagline?: boolean;
  markOnly?: boolean;
  className?: string;
}) {
  const src = markOnly ? MARK_SRC : LOCKUP_SRC;
  const alt = markOnly ? "FastQue" : "FastQue — Good Looks, Less Waiting";

  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${markOnly ? styles.markOnly : ""} ${className}`.trim()}
      data-show-tagline={showTagline ? "true" : "false"}
    >
      {/* The canonical PNG carries the approved dimensional lockup and tagline as one artwork. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.art} src={src} alt={alt} loading="eager" decoding="sync" draggable={false} />
    </span>
  );
}
