"use client";

import { useState } from "react";

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
  const [failed, setFailed] = useState(false);
  const showImage = url !== null && !failed;

  return (
    <div
      style={{
        aspectRatio,
        borderRadius: rounded,
        overflow: "hidden",
        background: "var(--bc-surface, #FFFDF9)",
        border: "1px solid var(--bc-border, #E7E0D3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
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
          onError={() => setFailed(true)}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <span
          style={{ color: "var(--bc-muted, #6B6357)", fontSize: 13, padding: "0 12px", textAlign: "center" }}
        >
          No photo yet
        </span>
      )}
    </div>
  );
}
