# BarberCue Editorial Asset Provenance

This file is the authoritative provenance record for every file under `apps/web/public/editorial/`.
Every production asset referenced from `apps/web/lib/editorial/manifest.ts` must have a row here.
No asset of uncertain license or web-scraped origin may ever be added to this directory.

## Status as of 2026-08-30 (launch integration)

**16 original AI-generated BarberCue editorial photographs are now live.** A real image-generation
capability (Gemini 3 Pro Image, run via Runway's generation pipeline) became available externally
and produced a 16-image launch collection, delivered as a hosted-asset manifest committed to this
branch (`RUNWAY_LAUNCH_ASSETS.md`). Each image was downloaded, visually reviewed for anatomy/safety
defects (hands, tools near skin, extra/malformed limbs, unsafe technique), and — for the 16 approved
here — re-encoded to WebP and committed as local optimized copies. **Zero images were rejected** on
quality review; all 16 passed and are in production use.

Every row below is one of these two honest categories:

- **`abstract-placeholder`** — an original SVG vector mark authored directly for this repository (by
  the engineer/agent working this ticket, using code, not an image model). Built from simple
  geometric shapes and line art in BarberCue's own palette (ivory `#FBF4E7`/`#FFFDF9`, ink `#1C1A17`,
  terracotta `#B0413E`, gold `#A8791F`). These are **not** photographs and must never be captioned or
  presented as such. The original 10 marks from the pre-photography launch sprint remain on disk
  (listed under "Legacy / unused" below) but no longer back any manifest entry.
- **`ai-generated`** — an original BarberCue editorial photograph produced by an actual
  image-generation model. Does not depict, and must never be presented as depicting, any specific
  listed salon's real premises, staff, or clients — see the truth boundary below.

## Provenance table — `ai-generated` (16 assets, launch photography)

| Filename | Asset ID | Generation system | Date | Service / category | Usage surface | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `hero/barbercue-hero.webp` | `hero-editorial-band` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Landing hero | Landing hero visual card (`HeroVisual.tsx`), behind the "Live queue"/"Book ahead" product cards | Barber sectioning a client's hair with comb + clippers; generic composition, no specific salon depicted |
| `services/hair/hair-salon-flagship.webp` | `hair-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Hair salon | Landing service discovery, search category chips, Style Advisor badge | Stylist blow-drying a client's hair |
| `services/barber/precision-fade.webp` | `barber-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Barber & men's grooming | Landing service discovery, search category chips | Barber giving a precision fade with clippers |
| `services/beard/beard-grooming.webp` | `beard-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Beard grooming | Landing service discovery, search category chips | Barber trimming a client's beard |
| `services/nails/manicure-flagship.webp` | `nails-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Nail care | Landing service discovery, search category chips | Nail technician filing a client's nails |
| `services/skincare/facial-flagship.webp` | `skincare-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Facial & skincare | Landing service discovery, search category chips | Esthetician applying a facial mask; non-medical, fully modest draping |
| `services/waxing-threading/threading-flagship.webp` | `waxing-threading-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Waxing & threading | Landing service discovery, search category chips | Eyebrow threading, gloved technician |
| `services/makeup/makeup-flagship.webp` | `makeup-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Makeup | Landing service discovery, search category chips | Makeup artist applying blush at a vanity |
| `services/spa-massage/spa-flagship.webp` | `spa-massage-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Spa & massage | Landing service discovery, search category chips | Back massage, non-medical, modest draping |
| `services/bridal/bridal-event.webp` | `bridal-event-flagship` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Bridal & event beauty | Landing service discovery (new 9th category card), search category chips | Makeup artist finishing a bridal look |
| `owner/salon-owner-operations.webp` | `owner-workstation` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Owner / "For Shops" | Landing "For Shops" section | Owner reviewing bookings on a tablet on a busy shop floor |
| `equipment/barber-tools.webp` | `barber-equipment-tools` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Equipment (barber) | Salon profile "Services & pricing" section heading (small generic accent thumbnail) | Still life: clippers, shears, comb, beard brush on a tray |
| `processes/hair-color.webp` | `process-hair-color` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Process — hair color | Reserved for future process-education placement | Colorist applying foils |
| `processes/haircut.webp` | `process-haircut` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Process — haircut | Booking page masthead banner (`book/[salonSlug]/page.tsx`) | Barber combing and cutting with scissors; used generically, decoupled from the specific salon's identity block to preserve the truth boundary |
| `processes/manicure.webp` | `process-manicure` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Process — manicure | Reserved for future process-education placement | Nail technician filing, henna detail |
| `processes/facial.webp` | `process-facial` | Gemini 3 Pro Image (via Runway) | 2026-08-30 | Process — facial | Reserved for future process-education placement | Esthetician applying finishing cream |

All 16 were downloaded from signed CloudFront/S3 URLs recorded in `RUNWAY_LAUNCH_ASSETS.md`,
verified as genuine `image/png` responses (correct `Content-Type`, matching `Content-Length`,
same-day `Last-Modified`), visually reviewed at full resolution (including cropped close-ups of
hands/tools) for anatomy and safety defects, then re-encoded locally to WebP (quality 82, resized to
their delivery dimensions) — no raw multi-megabyte source file or remote signed URL is referenced at
runtime; every `src` in the manifest is a local, committed, optimized file.

## `abstract-placeholder` — still in active use

| Filename | Asset ID | Usage surface | Note |
| --- | --- | --- | --- |
| `fallbacks/generic-editorial-pattern.svg` | `generic-editorial-pattern` | Reserved for truly generic, non-salon-specific empty/decorative states | **Never** wired into `SalonImage.tsx`'s per-salon fallback — that component's existing neutral "BC" panel (no image at all) is the correct, already-truthful behavior for a salon with no uploaded photo |

## `abstract-placeholder` — legacy / unused (kept on disk, not referenced by the manifest)

These 10 hand-authored SVG marks from the pre-photography launch sprint remain in the repository for
historical/reference purposes but no longer back any `EDITORIAL_ASSETS` entry, having been superseded
by the real photography above: `hero/hero-editorial-band.svg`, `services/barber/barber-flagship.svg`,
`services/hair/hair-flagship.svg`, `services/beard/beard-flagship.svg`,
`services/nails/nails-flagship.svg`, `services/skincare/skincare-flagship.svg`,
`services/waxing-threading/waxing-threading-flagship.svg`, `services/makeup/makeup-flagship.svg`,
`services/spa-massage/spa-massage-flagship.svg`, `owner/owner-workstation.svg`.

## The truth boundary (binding rule, not a suggestion)

1. Real salon-uploaded photography always comes first on a salon's own listing/profile/gallery.
2. If a salon has no photo, `SalonImage.tsx` shows its existing neutral "BC" badge + "No photo yet"
   state — never one of these editorial assets, and never an AI-generated "luxury salon interior"
   standing in for a real one.
3. Everything in this directory is BarberCue's own editorial/service-education library — for category
   browsing, service explanation, and marketing sections — and must never be presented as if it were
   a photograph of any specific listed business. On the booking page banner in particular, the
   photograph and the real salon's name/address are kept visually and structurally separate for this
   reason.

## Remaining backlog (explicitly not complete)

The 16 assets above cover the 8 flagship service categories + bridal/event + owner + equipment + 4
process steps. `SERVICE_VISUAL_MANIFEST.md`'s full taxonomy (per-service variants beyond the
flagship, the remaining ~41 equipment items, and the remaining process sequences/steps) is still
pending — see that file's coverage table for the exact per-category count.
