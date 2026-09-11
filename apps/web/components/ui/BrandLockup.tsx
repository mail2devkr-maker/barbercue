import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
const MARK_SRC = "/brand/fastque-premium-3d-mark.png";
// The v3 canonical asset bakes its own near-black rectangle into the pixels, which reads as a
// pasted image card on every light or glass header that uses it. This artwork carries the same
// approved 3D mark, wordmark and tagline with a real alpha channel instead, so it sits directly in
// a header with no visible bounding box regardless of what's behind it.
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
