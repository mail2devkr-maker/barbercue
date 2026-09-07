import styles from "./brand-lockup.module.css";

const LOCKUP_SRC = "/brand/fastque-premium-3d-lockup.png";
// Same approved artwork, same pixels — only the canonical PNG's flat dark canvas removed in favor
// of real alpha transparency (derived losslessly, never redrawn/recompressed/flattened). Used only
// where the lockup sits on a dark, non-opaque surface (the public landing header's glass nav) —
// every other call site keeps the canonical opaque-canvas asset unchanged, since the wordmark's
// lighter tones were designed against a solid dark backing and untested elsewhere.
const LOCKUP_TRANSPARENT_SRC = "/brand/fastque-premium-3d-lockup-transparent.png";
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
  transparent = false,
  className = "",
}: {
  compact?: boolean;
  showTagline?: boolean;
  markOnly?: boolean;
  /** Use the alpha-transparent lockup variant instead of the canonical opaque-canvas one. */
  transparent?: boolean;
  className?: string;
}) {
  const src = markOnly ? MARK_SRC : transparent ? LOCKUP_TRANSPARENT_SRC : LOCKUP_SRC;
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
