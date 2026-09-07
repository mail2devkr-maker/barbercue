import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
const MARK_SRC = "/brand/fastque-premium-3d-mark.png";

/**
 * FastQue branding uses the already-proven glossy 3D assets from /public/brand.
 *
 * The public landing header deliberately composes the full FQ mark and the existing wordmark/tagline
 * instead of relying on the separately generated header bitmap. That bitmap returned HTTP 200 in
 * production but failed to render visibly in the browser. Reusing these proven assets keeps the
 * approved 3D/gloss treatment while letting the full rounded FQ lower edge remain visible.
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
  /** Compose the full FQ mark with the proven glossy wordmark for the landing header. */
  headerArtwork?: boolean;
  className?: string;
}) {
  const alt = markOnly ? "FastQue" : "FastQue — Good Looks, Less Waiting";

  return (
    <span
      className={`${styles.root} ${compact ? styles.compact : ""} ${markOnly ? styles.markOnly : ""} ${headerArtwork ? styles.headerArtwork : ""} ${className}`.trim()}
      data-show-tagline={showTagline ? "true" : "false"}
      data-glass-host={transparent ? "true" : "false"}
    >
      {headerArtwork && !markOnly ? (
        <span className={styles.headerComposite}>
          {/* Full, proven FQ 3D mark. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.headerMarkArt}
            src={MARK_SRC}
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="sync"
            draggable={false}
          />
          {/* Crop only the already-proven FastQue wordmark/tagline from the canonical lockup. */}
          <span className={styles.headerWordCrop}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.headerWordArt}
              src={LOCKUP_SRC}
              alt={alt}
              loading="eager"
              decoding="sync"
              draggable={false}
            />
          </span>
        </span>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.art}
            src={markOnly ? MARK_SRC : LOCKUP_SRC}
            alt={alt}
            loading="eager"
            decoding="sync"
            draggable={false}
          />
        </>
      )}
    </span>
  );
}
