import Image from "next/image";
import { getEditorialAsset } from "../../lib/editorial/manifest";

/**
 * The one place a BarberCue-owned editorial asset is rendered, so every discovery/landing surface
 * sources it the same way — by semantic manifest ID, never a hard-coded file path.
 *
 * Unlike SalonImage (owner-supplied photos on arbitrary hosts, so next/image's remotePatterns
 * allow-list can't cover them), every editorial asset is a local file under /public/editorial —
 * exactly what next/image is for: automatic responsive sizing, lazy loading below the fold, and a
 * reserved aspect ratio from the manifest's own width/height so nothing shifts while it loads.
 *
 * This component must never be pointed at a real salon's context (a listing card, a profile
 * gallery) — see ASSET_PROVENANCE.md's truth boundary. It exists for the editorial/marketing
 * surfaces named in the launch mission: landing hero, service discovery, category education, the
 * owner "For Shops" section.
 */
export function EditorialImage({
  id,
  className,
  priority = false,
  sizes,
  fill = false,
  width,
  height,
}: {
  id: string;
  className?: string;
  /** Set only for the true LCP image (the hero band) — every other usage stays lazy. */
  priority?: boolean;
  sizes?: string;
  /** Use with a positioned/aspect-ratio parent instead of intrinsic width/height. */
  fill?: boolean;
  /** Override the manifest's native dimensions for a smaller/larger rendering (e.g. a badge). */
  width?: number;
  height?: number;
}) {
  const asset = getEditorialAsset(id);

  if (fill) {
    return (
      <Image
        src={asset.src}
        alt={asset.alt}
        fill
        className={className}
        priority={priority}
        sizes={sizes ?? "100vw"}
      />
    );
  }

  return (
    <Image
      src={asset.src}
      alt={asset.alt}
      width={width ?? asset.width}
      height={height ?? asset.height}
      className={className}
      priority={priority}
      sizes={sizes}
    />
  );
}
