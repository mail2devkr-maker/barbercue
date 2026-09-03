"use client";

import { useState } from "react";
import styles from "./salon-image.module.css";

/**
 * The one place a salon photo is rendered, so discovery cards, the profile hero and the owner's
 * own photo manager all behave identically.
 *
 * A plain <img>, not next/image, on purpose: photos are owner-supplied URLs on arbitrary hosts,
 * and next/image would need every one of those hosts pre-declared in `remotePatterns` — an
 * allow-list nobody can maintain for real salons. Optimisation is recovered with native lazy
 * loading, async decoding and a fixed aspect ratio that reserves space before the bytes land, so
 * a slow image never reflows the page around it.
 *
 * There is no placeholder photograph. A shop with no picture shows a neutral panel that says so —
 * a stock image of someone else's salon would misrepresent the business.
 */
export function SalonImage({
  url,
  alt,
  aspectRatio = "4 / 3",
  rounded = 12,
  priority = false,
}: {
  url: string | null;
  alt: string;
  aspectRatio?: string;
  rounded?: number;
  /** Set only for a hero above the fold — everything else stays lazy. */
  priority?: boolean;
}) {
  // A URL that 404s or is hotlink-blocked must degrade to the same honest empty state rather than
  // leaving a broken-image glyph on a premium page.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;

  return (
    <div
      className={styles.frame}
      style={{
        aspectRatio,
        borderRadius: rounded,
      }}
    >
      {showImage ? (
        /* next/image would require every remote host to be pre-declared in `remotePatterns`,
           which cannot be maintained for owner-supplied URLs on arbitrary hosts. Lazy loading,
           async decoding and the reserved aspect ratio above recover what the rule protects. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          onError={() => setFailedUrl(url)}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className={styles.image}
        />
      ) : (
        <span
          role="img"
          aria-label={alt}
          className={styles.fallback}
        >
          <span className={styles.mark} aria-hidden="true" />
          <strong>{url ? "Photo unavailable" : "Shop photos coming soon"}</strong>
          <span>FastQue shop profile</span>
        </span>
      )}
    </div>
  );
}
