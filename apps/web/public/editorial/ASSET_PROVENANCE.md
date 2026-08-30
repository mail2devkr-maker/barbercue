# BarberCue Editorial Asset Provenance

This file is the authoritative provenance record for every file under `apps/web/public/editorial/`.
Every production asset referenced from `apps/web/lib/editorial/manifest.ts` must have a row here.
No asset of uncertain license or web-scraped origin may ever be added to this directory.

## Honest status of this launch

**No AI-generated photographic or illustrative imagery exists in this codebase yet.** This
environment has no working image-generation tool and no configured/funded image-generation API key
(the backend's own `GEMINI_API_KEY` is present but empty/unfunded — see
`apps/backend/src/style-advisor/*` and `ARCHITECTURE.md` §19 for the pre-existing, separately
documented state of that integration). Per the mission's own instruction for this exact situation,
this launch ships with the **asset architecture, the typed manifest, and hand-authored abstract
BarberCue vector marks** in their place — never downloaded web imagery, never a false "AI-generated"
label on placeholder art.

Every row below is one of these two honest categories:

- **`abstract-placeholder`** — an original SVG vector mark authored directly for this repository
  (by the engineer/agent working this ticket, using code, not an image model). Built from simple
  geometric shapes and line art in BarberCue's own palette (ivory `#FBF4E7`/`#FFFDF9`, ink
  `#1C1A17`, terracotta `#B0413E`, gold `#A8791F`), echoing the visual language already established
  in `components/landing/HeroVisual.tsx`'s chair illustration. These are **not** photographs and
  must never be captioned or presented as such.
- **`ai-generated`** — reserved for a future asset actually produced by a real image-generation
  model, once one is available/funded. **No rows currently use this label.** When one is added, the
  row must record the generation system, the exact prompt (or a link to it in
  `SERVICE_VISUAL_MANIFEST.md`), and the generation date.

## Provenance table

| Filename | Asset ID | Type | Generation system | Date | Service / category | Usage surface | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hero/hero-editorial-band.svg` | `hero-editorial-band` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Landing hero | Landing page hero background | Decorative pattern combining scissors/comb/hair-strand/leaf/lipstick/thread motifs across all 8 categories; `alt=""` |
| `services/barber/barber-flagship.svg` | `barber-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Barber & men's grooming | Landing service discovery, category education | Scissors + comb motif |
| `services/hair/hair-flagship.svg` | `hair-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Hair salon | Landing service discovery, category education | Flowing strand + round brush motif |
| `services/beard/beard-flagship.svg` | `beard-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Beard grooming | Landing service discovery, category education | Beard silhouette + trimmer motif |
| `services/nails/nails-flagship.svg` | `nails-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Nail care | Landing service discovery, category education | Polish bottle + painted-nail motif |
| `services/skincare/skincare-flagship.svg` | `skincare-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Facial & skincare | Landing service discovery, category education | Face oval + glow-arc + roller motif |
| `services/waxing-threading/waxing-threading-flagship.svg` | `waxing-threading-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Waxing & threading | Landing service discovery, category education | Brow arch + thread spool motif |
| `services/makeup/makeup-flagship.svg` | `makeup-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Makeup | Landing service discovery, category education | Lipstick + brush motif |
| `services/spa-massage/spa-massage-flagship.svg` | `spa-massage-flagship` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Spa & massage | Landing service discovery, category education | Leaf + ripple motif |
| `owner/owner-workstation.svg` | `owner-workstation` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Owner / "For Shops" | Landing "For Shops" section | Stylized dashboard-panel illustration; does not depict real product UI pixel-for-pixel |
| `fallbacks/generic-editorial-pattern.svg` | `generic-editorial-pattern` | abstract-placeholder | hand-authored SVG (code) | 2026-08-30 | Brand-generic | Reserved for truly generic, non-salon-specific empty/decorative states only | **Never** wired into `SalonImage.tsx`'s per-salon fallback — that component's existing neutral "BC" panel (no image at all) is the correct, already-truthful behavior for a salon with no uploaded photo, and must stay that way |

## The truth boundary (binding rule, not a suggestion)

1. Real salon-uploaded photography always comes first on a salon's own listing/profile/gallery.
2. If a salon has no photo, `SalonImage.tsx` shows its existing neutral "BC" badge + "No photo yet"
   state — never one of these editorial marks, and never a future AI-generated "luxury salon
   interior" standing in for a real one.
3. Everything in this directory is BarberCue's own editorial/service-education library — for
   category browsing, service explanation, and marketing sections — and must never be presented as
   if it were a photograph of any specific listed business.

## Remaining backlog (explicitly not complete — see the final mission report)

No `equipment/` or `processes/` assets exist yet. No photographic/illustrative `ai-generated`
imagery exists yet for any service, equipment item, or process step named in the mission's
taxonomy. `SERVICE_VISUAL_MANIFEST.md` records the full target taxonomy and the exact prompts to
use once a real image-generation capability is available; this file will gain new rows at that
time, never before.
