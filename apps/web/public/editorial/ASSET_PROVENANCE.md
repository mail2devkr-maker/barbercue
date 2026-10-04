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

## Provenance table — `ai-generated` (20 assets, per-service imagery, 2026-10-04)

One canonical image per service, shown on the landing page's "Popular services" grid
(`SERVICE_SHOWCASE` in `lib/editorial/manifest.ts`). Generated in Runway (task type
`gemini_3_1_flash_lite_image`, 1200×896 JPEG), fetched from the owner's own Runway task outputs by
task ID, re-encoded locally to WebP (quality 82, `fit: cover` to 900×672 — an exact 4:3 downscale, no
metadata). No signed/temporary Runway URL is referenced anywhere in the repo or at runtime. Same truth
boundary as above: generic editorial photography, never a specific listed salon. Each image was
reviewed at contact-sheet scale and the two flagged ones (razor, shelf text) at close-up scale.

| Filename | Asset ID | Runway task ID |
| --- | --- | --- |
| `services/barber/classic-haircut.webp` | `service-classic-haircut` | `356dc07a-3b7f-471a-a6ff-7b4069422b09` |
| `services/barber/taper.webp` | `service-taper` | `42883dcd-ec7f-4b9f-ab4a-5edcd73af186` |
| `services/barber/buzz-cut.webp` | `service-buzz-cut` | `8a87f850-809a-4394-abc6-b7efe6697fcc` |
| `services/barber/scissor-cut.webp` | `service-scissor-cut` | `5ca8c4b6-8772-4d20-837c-588e2c6d75b3` |
| `services/barber/textured-crop.webp` | `service-textured-crop` | `1aef4de3-696c-465d-b925-026df5377636` |
| `services/barber/pompadour.webp` | `service-pompadour` | `0c23ab9a-3a01-4357-80df-90997358d2c6` |
| `services/barber/quiff.webp` | `service-quiff` | `4e43503d-2f1e-4cb8-8d52-764a55712cf8` |
| `services/barber/undercut.webp` | `service-undercut` | `c8e7ab99-978e-4b09-9bb4-feeed8e57598` |
| `services/hair/updo.webp` | `service-updo` | `eae1477d-1cbb-44fb-9084-21721502acb1` |
| `services/hair/straight-styling.webp` | `service-straight-styling` | `36f72d64-2547-4314-a827-8183b5ecbb0e` |
| `services/hair/curls-waves.webp` | `service-curls-waves` | `02cf35c7-1536-4805-899a-1a60544552db` |
| `services/hair/hair-styling.webp` | `service-hair-styling` | `7be71f5d-9554-4ba1-a7d2-729e769bed4e` |
| `services/hair/blowout.webp` | `service-blowout` | `ff64d750-67c6-426e-b345-edaa8880ef05` |
| `services/hair/fringe-bangs.webp` | `service-fringe-bangs` | `06a40128-e57b-4d48-8225-8d71ca99c760` |
| `services/hair/layered-haircut.webp` | `service-layered-haircut` | `9524b798-f144-4b4b-9dee-244112a8b802` |
| `services/hair/womens-haircut.webp` | `service-womens-haircut` | `5e1ab38f-950e-4e4f-94b3-c5af9bda1404` |
| `services/grooming/head-shave.webp` | `service-head-shave` | `6b6a1688-3b2c-4681-b6cd-1decc487d9df` |
| `services/grooming/hot-towel-shave.webp` | `service-hot-towel-shave` | `d181db64-a812-4474-a9f9-aa5c5e643543` |
| `services/grooming/moustache-grooming.webp` | `service-moustache-grooming` | `21fd1cde-3e52-47da-b70c-3221addc05ee` |
| `services/grooming/senior-haircut.webp` | `service-senior-haircut` | `5c858612-310a-46a1-8091-080de0d98b26` |

Review notes:
- `undercut`: the source image showed a legible third-party brand sign on the back shelf. Only that
  sign region (≈114×54 px at the top-right) was blurred in the local copy before encoding, so no
  third-party brand is named on FastQue's page; no regeneration was done. Small product packaging
  beneath it is not legible at the rendered card size.
- `head-shave`: straight-razor technique reviewed at close-up (skin held taut, correct grip, hands
  anatomically sound) and accepted.
- `taper`: shows clippers resting at the cape/neckline rather than mid-cut; accepted as a generic
  barbering visual, flagged for replacement if a better taper shot is generated later.
- Alternate/re-generated Runway outputs of the same services were deliberately not imported.

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
