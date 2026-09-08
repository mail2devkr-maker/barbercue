import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
const MARK_SRC = "/brand/fastque-premium-3d-mark.png";
const HEADER_LOCKUP_SRC = "/brand/fastque-final-canonical-logo-v2.webp";

/**
 * FastQue branding uses the owner-approved glossy 3D artwork from /public/brand.
 *
 * The public landing header intentionally renders ONE canonical image only. No separate FQ mark,
 * no CSS crop and no layered composition: this permanently avoids the old/new FQ overlap while
 * preserving the approved 3D shadow, glow, rounded corners and tagline exactly as one artwork.
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
  /** Presentation hint for glass/watermark hosts; the approved artwork pixels remain untouched. */
  transparent?: boolean;
  /** Use the single owner-approved canonical header artwork. */
  headerArtwork?: boolean;
  className?: string;
}) {
  const src = markOnly ? MARK_SRC : headerArtwork ? HEADER_LOCKUP_SRC : LOCKUP_SRC;
  const alt = markOnly ? "FastQue" : "FastQue — Good Looks, Less Waiting";

  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${markOnly ? styles.markOnly : ""} ${headerArtwork ? styles.headerArtwork : ""} ${className}`.trim()}
      data-show-tagline={showTagline ? "true" : "false"}
      data-glass-host={transparent ? "true" : "false"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.art}
        src={src}
        alt={alt}
        loading="eager"
        decoding="sync"
        draggable={false}
      />
    </span>
  );
}
