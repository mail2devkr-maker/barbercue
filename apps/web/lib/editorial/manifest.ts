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
 *   - "abstract-placeholder": a hand-authored BarberCue vector mark (this launch's actual
 *     inventory — see ASSET_PROVENANCE.md). Never claims to be a photograph.
 *   - "ai-generated": reserved for a future real photographic/illustrative asset produced by an
 *     actual image-generation model. Do not set this without a corresponding, verifiable
 *     ASSET_PROVENANCE.md entry — see that file's "no uncertain-provenance imagery" rule.
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
    src: "/editorial/hero/hero-editorial-band.svg",
    alt: "",
    source: "abstract-placeholder",
    width: 1200,
    height: 900,
  },
  {
    id: "barber-flagship",
    category: "barber",
    service: "barber & men's grooming",
    kind: "editorial",
    src: "/editorial/services/barber/barber-flagship.svg",
    alt: "BarberCue editorial mark for barber and men's grooming services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "hair-flagship",
    category: "hair",
    service: "hair salon",
    kind: "editorial",
    src: "/editorial/services/hair/hair-flagship.svg",
    alt: "BarberCue editorial mark for hair salon services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "beard-flagship",
    category: "beard",
    service: "beard grooming",
    kind: "editorial",
    src: "/editorial/services/beard/beard-flagship.svg",
    alt: "BarberCue editorial mark for beard grooming services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "nails-flagship",
    category: "nails",
    service: "nail care",
    kind: "editorial",
    src: "/editorial/services/nails/nails-flagship.svg",
    alt: "BarberCue editorial mark for nail care services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "skincare-flagship",
    category: "skincare",
    service: "facial & skincare",
    kind: "editorial",
    src: "/editorial/services/skincare/skincare-flagship.svg",
    alt: "BarberCue editorial mark for facial and skincare services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "waxing-threading-flagship",
    category: "waxing-threading",
    service: "waxing & threading",
    kind: "editorial",
    src: "/editorial/services/waxing-threading/waxing-threading-flagship.svg",
    alt: "BarberCue editorial mark for waxing and threading services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "makeup-flagship",
    category: "makeup",
    service: "makeup",
    kind: "editorial",
    src: "/editorial/services/makeup/makeup-flagship.svg",
    alt: "BarberCue editorial mark for makeup services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "spa-massage-flagship",
    category: "spa-massage",
    service: "spa & massage",
    kind: "editorial",
    src: "/editorial/services/spa-massage/spa-massage-flagship.svg",
    alt: "BarberCue editorial mark for spa and massage services",
    source: "abstract-placeholder",
    width: 400,
    height: 300,
  },
  {
    id: "owner-workstation",
    category: "owner",
    kind: "editorial",
    src: "/editorial/owner/owner-workstation.svg",
    alt: "Stylized illustration of a BarberCue owner dashboard showing bookings and live queue",
    source: "abstract-placeholder",
    width: 560,
    height: 420,
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
] as const;
