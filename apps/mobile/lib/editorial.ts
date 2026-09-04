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
} as const;
