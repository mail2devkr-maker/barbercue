import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
const MARK_SRC = "/brand/fastque-premium-3d-mark.png";
// This is the owner-approved NEW premium FastQue lockup (mark + wordmark + tagline, real alpha
// channel, no baked-in rectangle) — the correct source of truth for the header. A prior revision
// briefly swapped this for the older fastque-final-canonical-logo-v3.webp design while chasing a
// tagline-legibility complaint; an owner review corrected that as a regression (the old design,
// not the approved new one) and asked for the same fix via sizing/breathing room instead — see
// brand-lockup.module.css's own comment on the width clamp used here.
const HEADER_LOCKUP_SRC = "/brand/fastque-premium-3d-lockup-transparent.png";

/**
 * FastQue branding uses the owner-approved glossy 3D artwork from /public/brand.
 *
 * The public landing header intentionally renders ONE canonical image only. No separate FQ mark,
 * no CSS crop and no layered composition: this permanently avoids the old/new FQ overlap while
 * preserving the approved 3D shadow, glow and tagline exactly as one artwork, now on a transparent
 * background instead of a baked-in rectangle.
 */
export function BrandLockup({
  compact = false,
  showTagline = false,
  markOnly = false,
  transparent = false,
  headerArtwork = false,
  canonicalArtwork = false,
  className = "",
}: {
  compact?: boolean;
  showTagline?: boolean;
  markOnly?: boolean;
  /** Presentation hint for glass/watermark hosts; the approved artwork pixels remain untouched. */
  transparent?: boolean;
  /** Use the single owner-approved canonical header artwork. */
  headerArtwork?: boolean;
  /** Select the approved header asset without changing the host's presentation. */
  canonicalArtwork?: boolean;
  className?: string;
}) {
  const src = markOnly ? MARK_SRC : headerArtwork || canonicalArtwork ? HEADER_LOCKUP_SRC : LOCKUP_SRC;
  const alt = markOnly ? "FastQue" : "FastQue — Good Looks, Less Waiting";

  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${markOnly ? styles.markOnly : ""} ${headerArtwork ? styles.headerArtwork : ""} ${canonicalArtwork ? styles.canonicalArtwork : ""} ${className}`.trim()}
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
