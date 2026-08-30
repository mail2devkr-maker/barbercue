/**
 * BarberCue's own editorial visual library — the single source of truth for every non-salon,
 * brand-owned image used across the marketing/discovery surfaces (landing hero, service
 * discovery, category education, Style Advisor framing, the owner/"For Shops" section).
 *
 * Components reference an asset by semantic ID (getEditorialAsset("barber-flagship")), never by a
 * hard-coded file path — the same discipline this codebase already applies to API paths/constants
 * elsewhere (see @barbercue/shared's DASHBOARD_PATHS/DISCOVERY_PATHS). That keeps every usage site
 * one edit away from a real re-generated asset later, and keeps `apps/web/public/editorial/`
 * organized instead of anonymous images scattered through `/public`.
 *
 * TRUTH BOUNDARY (see ASSET_PROVENANCE.md and SERVICE_VISUAL_MANIFEST.md for the full policy):
 * every asset here is BarberCue-owned editorial/service-education artwork. None of it depicts, or
 * may ever be used to depict, a specific listed salon's actual premises — that is what
 * `SalonImage.tsx`'s owner-uploaded-photo-or-honest-empty-state contract is for, and this manifest
 * must never be wired into that component's fallback path.
 *
 * `source` is the honest label for what kind of artwork this actually is:
 *   - "abstract-placeholder": a hand-authored BarberCue vector mark — no longer used for any
 *     launch-facing flagship slot, kept only as historical/fallback inventory.
 *   - "ai-generated": an original BarberCue editorial photograph produced by an actual
 *     image-generation model (see ASSET_PROVENANCE.md for the per-asset record). Does not depict
 *     any specific listed salon — see the truth-boundary note above.
 */

export type EditorialAssetKind = "hero" | "result" | "process" | "equipment" | "editorial";

export type EditorialAssetSource = "abstract-placeholder" | "ai-generated";

export interface EditorialAsset {
  /** Semantic, stable ID — the only thing components should hard-code. */
  id: string;
  /** Top-level taxonomy bucket, matching public/editorial/services/<category>. */
  category:
    | "hero"
    | "barber"
    | "hair"
    | "beard"
    | "nails"
    | "skincare"
    | "waxing-threading"
    | "makeup"
    | "spa-massage"
    | "bridal-event"
    | "grooming"
    | "owner"
    | "fallback";
  /** Specific service within the category, when this asset is that granular. */
  service?: string;
  kind: EditorialAssetKind;
  /** Path under /public, always starting with /editorial/. */
  src: string;
  /** Meaningful alt text — never "image" or "beauty photo". Empty string only for decorative use. */
  alt: string;
  source: EditorialAssetSource;
  /** Natural width/height of the underlying SVG viewBox, for CLS-safe sizing. */
  width: number;
  height: number;
}

export const EDITORIAL_ASSETS: readonly EditorialAsset[] = [
  {
    id: "hero-editorial-band",
    category: "hero",
    kind: "hero",
    src: "/editorial/hero/barbercue-hero.webp",
    alt: "A barber sectioning a client's hair with a comb and clippers in a warm, modern barbershop",
    source: "ai-generated",
    width: 1680,
    height: 938,
  },
  {
    id: "barber-flagship",
    category: "barber",
    service: "barber & men's grooming",
    kind: "editorial",
    src: "/editorial/services/barber/precision-fade.webp",
    alt: "A barber giving a client a precision fade haircut with clippers in a wood-paneled barbershop",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "hair-flagship",
    category: "hair",
    service: "hair salon",
    kind: "editorial",
    src: "/editorial/services/hair/hair-salon-flagship.webp",
    alt: "A stylist blow-drying a client's hair with a round brush in a bright, plant-filled salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "beard-flagship",
    category: "beard",
    service: "beard grooming",
    kind: "editorial",
    src: "/editorial/services/beard/beard-grooming.webp",
    alt: "A barber trimming a client's beard with a precision trimmer beside a barbershop sink station",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "nails-flagship",
    category: "nails",
    service: "nail care",
    kind: "editorial",
    src: "/editorial/services/nails/manicure-flagship.webp",
    alt: "A nail technician filing a client's nails during a manicure at a salon table",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "skincare-flagship",
    category: "skincare",
    service: "facial & skincare",
    kind: "editorial",
    src: "/editorial/services/skincare/facial-flagship.webp",
    alt: "An esthetician applying a facial treatment with a brush to a relaxed client on a spa bed",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "waxing-threading-flagship",
    category: "waxing-threading",
    service: "waxing & threading",
    kind: "editorial",
    src: "/editorial/services/waxing-threading/threading-flagship.webp",
    alt: "A technician performing eyebrow threading on a reclined client",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "makeup-flagship",
    category: "makeup",
    service: "makeup",
    kind: "editorial",
    src: "/editorial/services/makeup/makeup-flagship.webp",
    alt: "A makeup artist applying blush to a client's cheek at a mirrored vanity",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "spa-massage-flagship",
    category: "spa-massage",
    service: "spa & massage",
    kind: "editorial",
    src: "/editorial/services/spa-massage/spa-flagship.webp",
    alt: "A massage therapist giving a client a back massage in a candlelit spa room",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "bridal-event-flagship",
    category: "bridal-event",
    service: "bridal & event beauty",
    kind: "editorial",
    src: "/editorial/services/bridal/bridal-event.webp",
    alt: "A makeup artist finishing a bride's look before an event",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "owner-workstation",
    category: "owner",
    kind: "editorial",
    src: "/editorial/owner/salon-owner-operations.webp",
    alt: "A salon owner reviewing bookings on a tablet on the floor of a busy barbershop",
    source: "ai-generated",
    width: 1400,
    height: 781,
  },
  {
    id: "barber-equipment-tools",
    category: "barber",
    kind: "equipment",
    src: "/editorial/equipment/barber-tools.webp",
    alt: "Barber clippers, shears, a comb, and a beard brush laid out on a wooden tray",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "process-hair-color",
    category: "hair",
    kind: "process",
    src: "/editorial/processes/hair-color.webp",
    alt: "A colorist applying hair color with foils to a client's hair",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "process-haircut",
    category: "barber",
    kind: "process",
    src: "/editorial/processes/haircut.webp",
    alt: "A barber combing and cutting a client's hair with scissors",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "process-manicure",
    category: "nails",
    kind: "process",
    src: "/editorial/processes/manicure.webp",
    alt: "A nail technician filing a client's nails with manicure tools laid out on the table",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "process-facial",
    category: "skincare",
    kind: "process",
    src: "/editorial/processes/facial.webp",
    alt: "An esthetician applying finishing cream to a client's face after a facial treatment",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "generic-editorial-pattern",
    category: "fallback",
    kind: "editorial",
    src: "/editorial/fallbacks/generic-editorial-pattern.svg",
    alt: "",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
] as const;

const ASSET_BY_ID = new Map(EDITORIAL_ASSETS.map((asset) => [asset.id, asset]));

/** Throws in dev if a component references an ID that doesn't exist — fail loudly, not with a broken <img>. */
export function getEditorialAsset(id: string): EditorialAsset {
  const asset = ASSET_BY_ID.get(id);
  if (!asset) {
    throw new Error(`No editorial asset registered for id "${id}". Check lib/editorial/manifest.ts.`);
  }
  return asset;
}

export function getEditorialAssetsByCategory(category: EditorialAsset["category"]): EditorialAsset[] {
  return EDITORIAL_ASSETS.filter((asset) => asset.category === category);
}

/**
 * The 8 principal customer-facing service categories, in landing/search discovery order. `query`
 * is the exact `service` search param this category's card/chip should link to — verified against
 * SalonsService.search()'s real `service` filter (matches Service.name OR Service.category,
 * case-insensitive contains), so every category is a truthful search, never a dead button, even
 * for a category with few or zero salons currently listed.
 */
export const SERVICE_CATEGORIES = [
  { id: "hair", label: "Hair", query: "hair", assetId: "hair-flagship" },
  { id: "barber", label: "Barber", query: "haircut", assetId: "barber-flagship" },
  { id: "beard", label: "Beard", query: "beard", assetId: "beard-flagship" },
  { id: "nails", label: "Nails", query: "nail", assetId: "nails-flagship" },
  { id: "facial", label: "Facial", query: "facial", assetId: "skincare-flagship" },
  { id: "makeup", label: "Makeup", query: "makeup", assetId: "makeup-flagship" },
  { id: "waxing-threading", label: "Waxing & Threading", query: "waxing", assetId: "waxing-threading-flagship" },
  { id: "spa-massage", label: "Spa & Massage", query: "massage", assetId: "spa-massage-flagship" },
  { id: "bridal-event", label: "Bridal & Event", query: "bridal", assetId: "bridal-event-flagship" },
] as const;
