// FastQue-owned editorial photography, reused from the exact same approved library
// apps/web/lib/editorial/manifest.ts already serves on the web landing page (see that file's own
// truth-boundary doc comment: brand-owned service-education photography, never depicting a
// specific listed salon — that's what SafeImage's owner-uploaded-photo contract is for). Mobile
// has no bundler-time access to apps/web/public, so these reference the same files by their live
// production URL rather than duplicating multi-hundred-KB image assets into the Expo bundle.
const EDITORIAL_BASE_URL = 'https://fastque.com/editorial';

export const EDITORIAL_ASSET_URL = {
  /** Barber sectioning a client's hair — the same image apps/web's landing hero uses. */
  heroBand: `${EDITORIAL_BASE_URL}/hero/barbercue-hero.webp`,
  /** Stylist blow-drying hair in a bright, plant-filled salon. */
  hairFlagship: `${EDITORIAL_BASE_URL}/services/hair/hair-salon-flagship.webp`,
  // Home's Popular Services row (visual-fidelity checkpoint) — real, already-provisioned editorial
  // photos from apps/web/lib/editorial/manifest.ts's SERVICE_CATEGORIES, mapped by subject rather
  // than duplicated per category, never a fetched/arbitrary stock image:
  /** A barber combing and cutting a client's hair with scissors (manifest id: process-haircut). */
  categoryHaircut: `${EDITORIAL_BASE_URL}/processes/haircut.webp`,
  /** A barber trimming a client's beard beside a barbershop sink station (manifest id: beard-flagship). */
  categoryBeardTrim: `${EDITORIAL_BASE_URL}/services/beard/beard-grooming.webp`,
  /** A barber giving a precision fade with clippers (manifest id: barber-flagship). */
  categoryFade: `${EDITORIAL_BASE_URL}/services/barber/precision-fade.webp`,
  /** Barber clippers, shears, comb and beard brush laid out on a tray (manifest id: barber-equipment-tools) —
   * no dedicated "shave" photo exists yet, so this stands in as the closest honest, real asset. */
  categoryShave: `${EDITORIAL_BASE_URL}/equipment/barber-tools.webp`,
  /** A nail technician filing a client's nails during a manicure (manifest id: nails-flagship). */
  categoryNails: `${EDITORIAL_BASE_URL}/services/nails/manicure-flagship.webp`,
  /** A massage therapist giving a client a back massage (manifest id: spa-massage-flagship). */
  categorySpa: `${EDITORIAL_BASE_URL}/services/spa-massage/spa-flagship.webp`,
} as const;
