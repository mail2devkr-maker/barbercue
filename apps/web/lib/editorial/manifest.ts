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

import { SALON_DISCOVERY_CATEGORIES } from "@barbercue/shared";

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
  // Per-service imagery (Runway, 2026-10-04) — one canonical image per service, rendered on the
  // landing page's "Popular services" grid via SERVICE_SHOWCASE below. Same truth boundary as every
  // other asset here: generic editorial photography, never a specific listed salon.
  {
    id: "service-classic-haircut",
    category: "barber",
    service: "classic haircut",
    kind: "editorial",
    src: "/editorial/services/barber/classic-haircut.webp",
    alt: "A barber cutting a client's hair with scissors and a comb in a bright, modern barbershop",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-taper",
    category: "barber",
    service: "taper haircut",
    kind: "editorial",
    src: "/editorial/services/barber/taper.webp",
    alt: "A barber using clippers to shape the back and sides of a client's curly hair in a modern barbershop",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-buzz-cut",
    category: "barber",
    service: "buzz cut",
    kind: "editorial",
    src: "/editorial/services/barber/buzz-cut.webp",
    alt: "A barber using clippers to give a client a close buzz cut in a bright barbershop",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-scissor-cut",
    category: "barber",
    service: "scissor cut",
    kind: "editorial",
    src: "/editorial/services/barber/scissor-cut.webp",
    alt: "A barber trimming a client's hair with shears and a comb in a barbershop chair",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-textured-crop",
    category: "barber",
    service: "textured crop",
    kind: "editorial",
    src: "/editorial/services/barber/textured-crop.webp",
    alt: "A barber trimming the sides of a client's textured crop haircut with scissors and a comb",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-pompadour",
    category: "barber",
    service: "pompadour",
    kind: "editorial",
    src: "/editorial/services/barber/pompadour.webp",
    alt: "A barber styling a client's pompadour with a blow dryer and round brush in a barbershop",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-quiff",
    category: "barber",
    service: "quiff",
    kind: "editorial",
    src: "/editorial/services/barber/quiff.webp",
    alt: "A smiling stylist styling a seated client's voluminous quiff hairstyle",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-undercut",
    category: "barber",
    service: "undercut",
    kind: "editorial",
    src: "/editorial/services/barber/undercut.webp",
    alt: "A barber using clippers on the sides of a client's hair for an undercut with longer hair left on top",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-updo",
    category: "hair",
    service: "updo",
    kind: "editorial",
    src: "/editorial/services/hair/updo.webp",
    alt: "A stylist pinning a client's braided updo in a bright salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-straight-styling",
    category: "hair",
    service: "straight styling",
    kind: "editorial",
    src: "/editorial/services/hair/straight-styling.webp",
    alt: "A stylist straightening a client's long hair with a flat iron in a salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-curls-waves",
    category: "hair",
    service: "curls and waves",
    kind: "editorial",
    src: "/editorial/services/hair/curls-waves.webp",
    alt: "A stylist curling a client's long hair into waves with a curling wand",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-hair-styling",
    category: "hair",
    service: "hair styling",
    kind: "editorial",
    src: "/editorial/services/hair/hair-styling.webp",
    alt: "A stylist styling a client's long wavy hair in a bright salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-blowout",
    category: "hair",
    service: "blowout",
    kind: "editorial",
    src: "/editorial/services/hair/blowout.webp",
    alt: "A stylist giving a client a blowout with a hair dryer and round brush in a salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-fringe-bangs",
    category: "hair",
    service: "fringe and bangs",
    kind: "editorial",
    src: "/editorial/services/hair/fringe-bangs.webp",
    alt: "A stylist cutting a client's fringe with scissors and a comb in a salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-layered-haircut",
    category: "hair",
    service: "layered haircut",
    kind: "editorial",
    src: "/editorial/services/hair/layered-haircut.webp",
    alt: "A stylist cutting layers into a client's long dark hair with scissors",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-womens-haircut",
    category: "hair",
    service: "women's haircut",
    kind: "editorial",
    src: "/editorial/services/hair/womens-haircut.webp",
    alt: "A stylist trimming a smiling client's shoulder-length hair with scissors in a salon",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-head-shave",
    category: "grooming",
    service: "head shave",
    kind: "editorial",
    src: "/editorial/services/grooming/head-shave.webp",
    alt: "A barber giving a client a head shave with a straight razor and shaving foam",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-hot-towel-shave",
    category: "grooming",
    service: "hot towel shave",
    kind: "editorial",
    src: "/editorial/services/grooming/hot-towel-shave.webp",
    alt: "A barber wrapping a client's face in a hot towel before a shave in a barbershop",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-moustache-grooming",
    category: "grooming",
    service: "moustache grooming",
    kind: "editorial",
    src: "/editorial/services/grooming/moustache-grooming.webp",
    alt: "A barber trimming a client's moustache with scissors and a comb",
    source: "ai-generated",
    width: 900,
    height: 672,
  },
  {
    id: "service-senior-haircut",
    category: "grooming",
    service: "senior haircut",
    kind: "editorial",
    src: "/editorial/services/grooming/senior-haircut.webp",
    alt: "A barber trimming an older client's grey hair with scissors in a barbershop",
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

// This category's flagship photo, keyed by the same `id` as `SALON_DISCOVERY_CATEGORIES` (the
// canonical id/label/query list, shared with apps/mobile's Search screen so the two clients can
// never drift onto two different category sets — see that module's own doc comment). `assetId` is
// a purely visual, web-only concern (mobile renders these as plain dropdown rows, no artwork), so
// it stays local here rather than in the shared list.
const CATEGORY_ASSET_IDS: Record<string, string> = {
  hair: "hair-flagship",
  barber: "barber-flagship",
  beard: "beard-flagship",
  nails: "nails-flagship",
  facial: "skincare-flagship",
  makeup: "makeup-flagship",
  "waxing-threading": "waxing-threading-flagship",
  "spa-massage": "spa-massage-flagship",
  "bridal-event": "bridal-event-flagship",
};

/**
 * The 8 principal customer-facing service categories, in landing/search discovery order. `query`
 * is the exact `service` search param this category's card/chip should link to — verified against
 * SalonsService.search()'s real `service` filter (matches Service.name OR Service.category,
 * case-insensitive contains), so every category is a truthful search, never a dead button, even
 * for a category with few or zero salons currently listed.
 */
export const SERVICE_CATEGORIES = SALON_DISCOVERY_CATEGORIES.map((category) => ({
  ...category,
  assetId: CATEGORY_ASSET_IDS[category.id] ?? category.id,
}));

/**
 * Landing "Popular services" grid, in display order. `id` is an EDITORIAL_ASSETS id; `query` is the
 * exact `service` search param the card links to. SalonsService.search() matches `service` against
 * Service.name OR Service.category (case-insensitive contains), so each query is the closest real
 * catalog service name (packages/shared catalog/service-catalog.ts): a style-level card with no catalog
 * equivalent of its own (taper, scissor cut, quiff…) falls back to its parent service term — "Fade",
 * "Haircut", "Styling" — rather than an invented name that would match no shop.
 */
export const SERVICE_SHOWCASE: readonly { id: string; label: string; query: string }[] = [
  { id: "service-classic-haircut", label: "Classic Haircut", query: "Classic Haircut" },
  { id: "service-taper", label: "Taper", query: "Fade" },
  { id: "service-buzz-cut", label: "Buzz Cut", query: "Buzz Cut" },
  { id: "service-scissor-cut", label: "Scissor Cut", query: "Haircut" },
  { id: "service-textured-crop", label: "Textured Crop", query: "Haircut" },
  { id: "service-pompadour", label: "Pompadour", query: "Styling" },
  { id: "service-quiff", label: "Quiff", query: "Styling" },
  { id: "service-undercut", label: "Undercut", query: "Haircut" },
  { id: "service-updo", label: "Updo", query: "Hairdo" },
  { id: "service-straight-styling", label: "Straight Styling", query: "Hair Ironing" },
  { id: "service-curls-waves", label: "Curls & Waves", query: "Hair Curling" },
  { id: "service-hair-styling", label: "Hair Styling", query: "Styling" },
  { id: "service-blowout", label: "Blowout", query: "Blow Dry" },
  { id: "service-fringe-bangs", label: "Fringe / Bangs", query: "Fringe" },
  { id: "service-layered-haircut", label: "Layered Haircut", query: "Haircut" },
  { id: "service-womens-haircut", label: "Women's Haircut", query: "Women's Haircut" },
  { id: "service-head-shave", label: "Head Shave", query: "Head Shave" },
  { id: "service-hot-towel-shave", label: "Hot-Towel Shave", query: "Shave" },
  { id: "service-moustache-grooming", label: "Moustache Grooming", query: "Moustache" },
  { id: "service-senior-haircut", label: "Senior Haircut", query: "Haircut" },
] as const;
