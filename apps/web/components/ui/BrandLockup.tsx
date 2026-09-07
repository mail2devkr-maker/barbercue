import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
const HEADER_LOCKUP_SRC = "/brand/fastque-premium-3d-header.png";
const MARK_SRC = "/brand/fastque-premium-3d-mark.png";

/**
 * The owner-approved FastQue 3D artwork is served as a real public image. Keeping the artwork out
 * of a TS data URI gives Next a normal image request, browser caching, and an independently
 * inspectable image response instead of silently falling back to alt text on decode.
 *
 * Important: even on translucent/glass hosts we keep the approved artwork intact. The landing
 * header can opt into the dedicated full-FQ lockup so the complete rounded emblem and lower glow
 * remain visible without bringing in the unrelated icon row from the original source artwork.
 */
export function BrandLockup({
  compact = false,
  showTagline = false,
  markOnly = false,
  transparent = false,
  headerArtwork = false,
  className = "",
}: {
  compact?: boolean;
  showTagline?: boolean;
  markOnly?: boolean;
  /** Presentation hint for glass/watermark hosts; the approved 3D artwork itself remains intact. */
  transparent?: boolean;
  /** Use the owner-approved full-FQ header lockup with the complete emblem visible. */
  headerArtwork?: boolean;
  className?: string;
}) {
  const src = markOnly ? MARK_SRC : headerArtwork ? HEADER_LOCKUP_SRC : LOCKUP_SRC;
  const alt = markOnly ? "FastQue" : "FastQue — Good Looks, Less Waiting";

  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${markOnly ? styles.markOnly : ""} ${className}`.trim()}
      data-show-tagline={showTagline ? "true" : "false"}
      data-glass-host={transparent ? "true" : "false"}
    >
      {/* The selected image carries the approved dimensional lockup and tagline as one artwork. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.art} src={src} alt={alt} loading="eager" decoding="sync" draggable={false} />
    </span>
  );
}
