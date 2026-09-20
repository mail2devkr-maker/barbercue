import { SalonType } from '../enums';

/**
 * Reusable owner service presets. FastQue supplies India-oriented suggested starting prices and
 * durations to make onboarding fast. Both are editable before the owner saves the services; they
 * are convenience defaults, not enforced market prices.
 */
export type ServicePackId = 'BASIC' | 'STANDARD' | 'ADVANCED';

export interface ServicePackDefinition {
  id: ServicePackId;
  label: string;
  description: string;
}

export const SERVICE_CATALOG_PACKS: readonly ServicePackDefinition[] = [
  {
    id: 'BASIC',
    label: 'Basic Salon Services',
    description:
      'Essential small-barber services: haircuts, fades, shaving, beard/moustache grooming, basic hair colour and head massage — with lower suggested prices.',
  },
  {
    id: 'STANDARD',
    label: 'Standard Salon Services',
    description:
      'Everything in Basic plus wider unisex hair, facial, threading, waxing, manicure/pedicure, party styling and body-care services — with mid-range suggested prices.',
  },
  {
    id: 'ADVANCED',
    label: 'Advance Salon Services',
    description:
      'The complete FastQue beauty catalog, including separate Gents/Ladies variants for shared services plus technical hair treatments, premium facials, full-body waxing, advanced nails, bridal/HD makeup and intensive body care — with premium suggested prices.',
  },
] as const;

export interface ServiceCatalogItem {
  id: string;
  name: string;
  category: string;
  defaultDurationMinutes: number;
  /**
   * Intended salon audience for preset filtering. UNISEX services are shown to all salon types;
   * GENTS/LADIES-specific services are hidden from the opposite salon type.
   */
  salonAudience: SalonType;
  /**
   * Lowest salon tier where this service appears. Packs are nested:
   * BASIC ⊂ STANDARD ⊂ ADVANCED.
   */
  pack: ServicePackId;
  /**
   * Suggested India onboarding prices by salon tier. Only packs where the service is available
   * are populated. Owners can edit the suggested value before saving.
   */
  defaultPriceInrByPack: Readonly<Partial<Record<ServicePackId, number>>>;
  /**
   * Backward-compatible suggested price at the service's minimum tier.
   */
  defaultPriceInr: number;
}

// The sets below define the minimum tier for a service. Packs are intentionally nested so common
// services such as Haircut can appear in Basic, Standard and Advance with different suggested
// prices, while premium-only services appear only where they make sense.
const BASIC_SERVICE_IDS = new Set([
  // Essential gents barber services.
  'classic-haircut',
  'skin-fade',
  'zero-fade',
  'buzz-cut',
  'crew-cut',
  'kids-haircut',
  'hair-wash',
  'blow-dry-styling',
  'hair-setting',
  'head-shave',
  'haircut-beard',
  'beard-trim',
  'beard-shape-line-up',
  'clean-shave',
  'moustache-trim',
  'beard-colour',

  // Essential ladies-parlour services.
  'womens-haircut',
  'hair-trim',
  'fringe-bangs-trim',
  'girls-kids-haircut',
  'shampoo-conditioning',
  'blow-dry',
  'basic-hairdo',
  'cleanup',
  'de-tan',
  'bleach',
  'eyebrows',
  'upper-lip',
  'chin',
  'forehead',
  'side-face',
  'underarms',
  'half-arms',
  'full-arms',
  'half-legs',
  'full-legs',
  'manicure',
  'pedicure',
  'nail-cut-file',
  'nail-polish',

  // Core unisex colour/care offered by many neighbourhood shops.
  'root-touch-up',
  'global-hair-colour',
  'henna',
  'head-massage',
]);

const STANDARD_SERVICE_IDS = new Set([
  // Premium men's grooming beyond the essential barber set.
  'premium-luxury-shave',

  // Expanded ladies/unisex hair styling.
  'hair-ironing',
  'hair-curling',
  'party-hairdo',

  // Broader colour services; balayage/ombre remain Advance.
  'highlights',
  'lowlights',

  // Non-technical hair care. Chemical/technical transformations remain Advance.
  'hair-spa',
  'deep-conditioning',
  'anti-dandruff-treatment',
  'anti-hairfall-treatment',
  'scalp-treatment',

  // Mainstream facial / skin services. Specialist intensive facials remain Advance.
  'fruit-facial',
  'gold-facial',
  'diamond-facial',
  'hydrating-facial',
  'brightening-facial',
  'face-polish',

  // Expanded threading / waxing.
  'full-face-threading',
  'full-face-wax',
  'stomach',
  'back',

  // Nail care below the advanced extension/art tier.
  'gel-removal',

  // Occasion services below bridal/HD/airbrush tier.
  'party-makeup',
  'eye-makeup',
  'saree-draping',

  // Mainstream massage/body care.
  'foot-massage',
  'hand-massage',
  'head-neck-shoulder-massage',
  'back-massage',
]);


// Curated FastQue onboarding suggestions for India. These are intentionally round, editable
// starting points rather than claims of a single nationwide market price. Keeping them beside the
// shared catalog gives web and mobile exactly the same defaults.
const STANDARD_REFERENCE_PRICE_INR_BY_ID: Readonly<Record<string, number>> = {
  "classic-haircut": 100,
  "skin-fade": 200,
  "zero-fade": 200,
  "buzz-cut": 100,
  "crew-cut": 150,
  "kids-haircut": 100,
  "hair-wash": 100,
  "blow-dry-styling": 150,
  "hair-setting": 150,
  "head-shave": 100,
  "haircut-beard": 200,
  "beard-trim": 100,
  "beard-shape-line-up": 100,
  "clean-shave": 100,
  "premium-luxury-shave": 350,
  "moustache-trim": 50,
  "beard-colour": 200,
  "womens-haircut": 500,
  "hair-trim": 350,
  "fringe-bangs-trim": 200,
  "girls-kids-haircut": 300,
  "shampoo-conditioning": 250,
  "blow-dry": 400,
  "hair-ironing": 400,
  "hair-curling": 600,
  "basic-hairdo": 700,
  "party-hairdo": 1200,
  "root-touch-up": 600,
  "global-hair-colour": 1000,
  "highlights": 3000,
  "lowlights": 3000,
  "balayage": 4500,
  "ombre": 4500,
  "henna": 400,
  "hair-spa": 800,
  "deep-conditioning": 600,
  "head-massage": 200,
  "anti-dandruff-treatment": 800,
  "anti-hairfall-treatment": 900,
  "scalp-treatment": 1000,
  "keratin-treatment": 4000,
  "smoothening": 3500,
  "rebonding-straightening": 4500,
  "hair-botox": 5000,
  "cleanup": 500,
  "fruit-facial": 700,
  "gold-facial": 1000,
  "diamond-facial": 1200,
  "hydrating-facial": 1000,
  "brightening-facial": 1000,
  "anti-ageing-facial": 1500,
  "acne-control-facial": 1200,
  "de-tan": 500,
  "bleach": 400,
  "face-polish": 700,
  "eyebrows": 50,
  "upper-lip": 30,
  "chin": 30,
  "forehead": 30,
  "side-face": 60,
  "full-face-threading": 150,
  "underarms": 150,
  "half-arms": 250,
  "full-arms": 400,
  "half-legs": 350,
  "full-legs": 600,
  "full-face-wax": 250,
  "stomach": 350,
  "back": 500,
  "full-body-wax": 1800,
  "bikini-wax": 800,
  "manicure": 500,
  "pedicure": 700,
  "spa-manicure": 800,
  "spa-pedicure": 1000,
  "nail-cut-file": 150,
  "nail-polish": 200,
  "gel-polish": 600,
  "gel-removal": 300,
  "nail-art": 800,
  "nail-extensions": 1800,
  "nail-extension-removal": 500,
  "party-makeup": 2000,
  "hd-makeup": 3500,
  "airbrush-makeup": 4000,
  "engagement-makeup": 5000,
  "bridal-makeup": 8000,
  "groom-makeup-grooming": 2500,
  "eye-makeup": 800,
  "saree-draping": 500,
  "bridal-hairdo": 2500,
  "pre-bridal-package": 6000,
  "foot-massage": 400,
  "hand-massage": 300,
  "head-neck-shoulder-massage": 500,
  "back-massage": 700,
  "body-scrub": 1000,
  "body-polish": 1500
};

const PACK_RANK: Readonly<Record<ServicePackId, number>> = {
  BASIC: 0,
  STANDARD: 1,
  ADVANCED: 2,
};

const LADIES_ONLY_UNPREFIXED_IDS = new Set(['balayage', 'ombre']);

const MIN_PACK_OVERRIDE_BY_ID: Readonly<Partial<Record<string, ServicePackId>>> = {
  // Small gents barbers generally do not offer waxing/nail care in the Basic pack.
  'gents-underarms': 'STANDARD',
  'gents-half-arms': 'STANDARD',
  'gents-full-arms': 'STANDARD',
  'gents-half-legs': 'STANDARD',
  'gents-full-legs': 'STANDARD',
  'gents-stomach': 'STANDARD',
  'gents-back': 'STANDARD',
  'gents-full-body-wax': 'ADVANCED',
  'gents-manicure': 'STANDARD',
  'gents-pedicure': 'STANDARD',
  'gents-nail-cut-file': 'STANDARD',
  // Basic gents pack stays focused on barbering/colour/head massage.
  'gents-cleanup': 'STANDARD',
  'gents-de-tan': 'STANDARD',
  'gents-bleach': 'STANDARD',
};

const AUDIENCE_REFERENCE_PRICE_INR_BY_ID: Readonly<Record<string, number>> = {
  // Hair colour — ladies references assume a typical medium-length starting service.
  'gents-root-touch-up': 300,
  'ladies-root-touch-up': 700,
  'gents-global-hair-colour': 500,
  'ladies-global-hair-colour': 1200,
  'gents-highlights': 800,
  'ladies-highlights': 2500,
  'gents-lowlights': 800,
  'ladies-lowlights': 2500,
  'gents-henna': 250,
  'ladies-henna': 500,

  // Hair care / treatments.
  'gents-hair-spa': 500,
  'ladies-hair-spa': 900,
  'gents-deep-conditioning': 350,
  'ladies-deep-conditioning': 700,
  'gents-head-massage': 150,
  'ladies-head-massage': 250,
  'gents-anti-dandruff-treatment': 500,
  'ladies-anti-dandruff-treatment': 900,
  'gents-anti-hairfall-treatment': 600,
  'ladies-anti-hairfall-treatment': 1000,
  'gents-scalp-treatment': 700,
  'ladies-scalp-treatment': 1100,
  'gents-keratin-treatment': 1500,
  'ladies-keratin-treatment': 4000,
  'gents-smoothening': 1800,
  'ladies-smoothening': 3500,
  'gents-rebonding-straightening': 2000,
  'ladies-rebonding-straightening': 4500,
  'gents-hair-botox': 2000,
  'ladies-hair-botox': 5000,

  // Facial / skin.
  'gents-cleanup': 400,
  'ladies-cleanup': 500,
  'gents-fruit-facial': 600,
  'ladies-fruit-facial': 700,
  'gents-gold-facial': 800,
  'ladies-gold-facial': 1000,
  'gents-diamond-facial': 1000,
  'ladies-diamond-facial': 1200,
  'gents-hydrating-facial': 800,
  'ladies-hydrating-facial': 1000,
  'gents-brightening-facial': 800,
  'ladies-brightening-facial': 1000,
  'gents-anti-ageing-facial': 1200,
  'ladies-anti-ageing-facial': 1500,
  'gents-acne-control-facial': 900,
  'ladies-acne-control-facial': 1200,
  'gents-de-tan': 400,
  'ladies-de-tan': 500,
  'gents-bleach': 300,
  'ladies-bleach': 400,
  'gents-face-polish': 500,
  'ladies-face-polish': 700,

  // Threading / waxing that both audiences may request.
  'gents-eyebrows': 100,
  'ladies-eyebrows': 50,
  'gents-full-face-threading': 250,
  'ladies-full-face-threading': 150,
  'gents-underarms': 200,
  'ladies-underarms': 150,
  'gents-half-arms': 350,
  'ladies-half-arms': 250,
  'gents-full-arms': 550,
  'ladies-full-arms': 400,
  'gents-half-legs': 500,
  'ladies-half-legs': 350,
  'gents-full-legs': 800,
  'ladies-full-legs': 600,
  'gents-stomach': 500,
  'ladies-stomach': 350,
  'gents-back': 750,
  'ladies-back': 500,
  'gents-full-body-wax': 2500,
  'ladies-full-body-wax': 1800,

  // Hands / feet.
  'gents-manicure': 450,
  'ladies-manicure': 500,
  'gents-pedicure': 650,
  'ladies-pedicure': 700,
  'gents-spa-manicure': 750,
  'ladies-spa-manicure': 800,
  'gents-spa-pedicure': 950,
  'ladies-spa-pedicure': 1000,
  'gents-nail-cut-file': 120,
  'ladies-nail-cut-file': 150,

  // Spa / body care.
  'gents-foot-massage': 450,
  'ladies-foot-massage': 400,
  'gents-hand-massage': 350,
  'ladies-hand-massage': 300,
  'gents-head-neck-shoulder-massage': 550,
  'ladies-head-neck-shoulder-massage': 500,
  'gents-back-massage': 800,
  'ladies-back-massage': 700,
  'gents-body-scrub': 1200,
  'ladies-body-scrub': 1000,
  'gents-body-polish': 1800,
  'ladies-body-polish': 1500,
};

function baseServiceId(id: string): string {
  if (id.startsWith('gents-')) return id.slice('gents-'.length);
  if (id.startsWith('ladies-')) return id.slice('ladies-'.length);
  return id;
}

function packFor(id: string): ServicePackId {
  const override = MIN_PACK_OVERRIDE_BY_ID[id];
  if (override) return override;
  const baseId = baseServiceId(id);
  if (BASIC_SERVICE_IDS.has(baseId)) return 'BASIC';
  if (STANDARD_SERVICE_IDS.has(baseId)) return 'STANDARD';
  // Anything not explicitly offered by Basic or Standard is an Advance-only beauty service.
  return 'ADVANCED';
}

function salonAudienceFor(category: string, id: string): SalonType {
  if (id.startsWith('gents-')) return SalonType.GENTS;
  if (id.startsWith('ladies-')) return SalonType.LADIES;
  if (LADIES_ONLY_UNPREFIXED_IDS.has(id)) return SalonType.LADIES;
  if (category === "Men's Hair & Grooming" || category === 'Beard & Shaving') {
    return SalonType.GENTS;
  }
  if (
    category === "Women's Hair" ||
    category === 'Threading' ||
    category === 'Waxing' ||
    category === 'Hands, Feet & Nails'
  ) {
    return SalonType.LADIES;
  }
  if (category === 'Makeup & Occasion') {
    return id === 'groom-makeup-grooming' ? SalonType.GENTS : SalonType.LADIES;
  }
  // Hair colour/care, facial/skin and spa/body-care services are intentionally shared.
  return SalonType.UNISEX;
}


function roundSuggestedPrice(value: number): number {
  if (value < 100) return Math.max(20, Math.round(value / 10) * 10);
  if (value < 500) return Math.round(value / 50) * 50;
  return Math.round(value / 100) * 100;
}

function pricesFor(id: string, minimumPack: ServicePackId): Readonly<Partial<Record<ServicePackId, number>>> {
  const reference =
    AUDIENCE_REFERENCE_PRICE_INR_BY_ID[id] ??
    STANDARD_REFERENCE_PRICE_INR_BY_ID[baseServiceId(id)];
  if (reference === undefined) {
    throw new Error(`Missing suggested service price for catalog item: ${id}`);
  }

  if (minimumPack === 'BASIC') {
    return {
      BASIC: roundSuggestedPrice(reference * 0.5),
      STANDARD: reference,
      ADVANCED: roundSuggestedPrice(reference * 2),
    };
  }
  if (minimumPack === 'STANDARD') {
    return {
      STANDARD: reference,
      ADVANCED: roundSuggestedPrice(reference * 1.5),
    };
  }
  return { ADVANCED: reference };
}

function item(
  category: string,
  id: string,
  name: string,
  defaultDurationMinutes: number,
): ServiceCatalogItem {
  const pack = packFor(id);
  const salonAudience = salonAudienceFor(category, id);
  const defaultPriceInrByPack = pricesFor(id, pack);
  const defaultPriceInr = defaultPriceInrByPack[pack];
  if (defaultPriceInr === undefined) {
    throw new Error(`Missing minimum-pack price for catalog item: ${id}`);
  }
  return {
    category,
    id,
    name,
    defaultDurationMinutes,
    salonAudience,
    defaultPriceInrByPack,
    defaultPriceInr,
    pack,
  };
}

function genderPair(
  category: string,
  baseId: string,
  name: string,
  gentsDurationMinutes: number,
  ladiesDurationMinutes: number,
): readonly ServiceCatalogItem[] {
  return [
    item(category, `gents-${baseId}`, `Gents ${name}`, gentsDurationMinutes),
    item(category, `ladies-${baseId}`, `Ladies ${name}`, ladiesDurationMinutes),
  ];
}

export function serviceAvailableInPack(item: ServiceCatalogItem, pack: ServicePackId): boolean {
  return PACK_RANK[pack] >= PACK_RANK[item.pack];
}

export function serviceAvailableForSalonType(
  item: ServiceCatalogItem,
  salonType: SalonType,
): boolean {
  return (
    salonType === SalonType.UNISEX ||
    item.salonAudience === SalonType.UNISEX ||
    item.salonAudience === salonType
  );
}

export function suggestedServicePriceInr(item: ServiceCatalogItem, pack: ServicePackId): number {
  const price = item.defaultPriceInrByPack[pack];
  if (price === undefined) {
    throw new Error(`${item.name} is not available in ${pack} pack`);
  }
  return price;
}

export const SERVICE_CATALOG_CATEGORIES = [
  "Men's Hair & Grooming",
  "Beard & Shaving",
  "Women's Hair",
  "Hair Colour",
  "Hair Care & Treatments",
  "Facial & Skin",
  "Threading",
  "Waxing",
  "Hands, Feet & Nails",
  "Makeup & Occasion",
  "Spa / Body Care",
] as const;

export const SERVICE_CATALOG: readonly ServiceCatalogItem[] = [
  item("Men's Hair & Grooming", "classic-haircut", "Classic Haircut", 30),
  item("Men's Hair & Grooming", "skin-fade", "Skin Fade", 45),
  item("Men's Hair & Grooming", "zero-fade", "Zero Fade", 40),
  item("Men's Hair & Grooming", "buzz-cut", "Buzz Cut", 25),
  item("Men's Hair & Grooming", "crew-cut", "Crew Cut", 30),
  item("Men's Hair & Grooming", "kids-haircut", "Kids Haircut", 30),
  item("Men's Hair & Grooming", "hair-wash", "Hair Wash", 15),
  item("Men's Hair & Grooming", "blow-dry-styling", "Blow Dry/Styling", 30),
  item("Men's Hair & Grooming", "hair-setting", "Hair Setting", 30),
  item("Men's Hair & Grooming", "head-shave", "Head Shave", 25),
  item("Men's Hair & Grooming", "haircut-beard", "Haircut + Beard", 50),

  item("Beard & Shaving", "beard-trim", "Beard Trim", 20),
  item("Beard & Shaving", "beard-shape-line-up", "Beard Shape/Line-up", 25),
  item("Beard & Shaving", "clean-shave", "Clean Shave", 25),
  item("Beard & Shaving", "premium-luxury-shave", "Premium/Luxury Shave", 40),
  item("Beard & Shaving", "moustache-trim", "Moustache Trim", 15),
  item("Beard & Shaving", "beard-colour", "Beard Colour", 35),

  item("Women's Hair", "womens-haircut", "Women's Haircut", 45),
  item("Women's Hair", "hair-trim", "Hair Trim", 30),
  item("Women's Hair", "fringe-bangs-trim", "Fringe/Bangs Trim", 20),
  item("Women's Hair", "girls-kids-haircut", "Girls/Kids Haircut", 30),
  item("Women's Hair", "shampoo-conditioning", "Shampoo & Conditioning", 25),
  item("Women's Hair", "blow-dry", "Blow Dry", 35),
  item("Women's Hair", "hair-ironing", "Hair Ironing", 35),
  item("Women's Hair", "hair-curling", "Hair Curling", 45),
  item("Women's Hair", "basic-hairdo", "Basic Hairdo", 45),
  item("Women's Hair", "party-hairdo", "Party Hairdo", 60),

  ...genderPair("Hair Colour", "root-touch-up", "Root Touch-Up", 45, 75),
  ...genderPair("Hair Colour", "global-hair-colour", "Global Hair Colour", 60, 120),
  ...genderPair("Hair Colour", "highlights", "Highlights", 75, 150),
  ...genderPair("Hair Colour", "lowlights", "Lowlights", 75, 150),
  item("Hair Colour", "balayage", "Balayage", 180),
  item("Hair Colour", "ombre", "Ombre", 180),
  ...genderPair("Hair Colour", "henna", "Henna", 45, 90),

  ...genderPair("Hair Care & Treatments", "hair-spa", "Hair Spa", 45, 60),
  ...genderPair("Hair Care & Treatments", "deep-conditioning", "Deep Conditioning", 30, 45),
  ...genderPair("Hair Care & Treatments", "head-massage", "Head Massage", 30, 30),
  ...genderPair("Hair Care & Treatments", "anti-dandruff-treatment", "Anti-Dandruff Treatment", 45, 60),
  ...genderPair("Hair Care & Treatments", "anti-hairfall-treatment", "Anti-Hairfall Treatment", 45, 60),
  ...genderPair("Hair Care & Treatments", "scalp-treatment", "Scalp Treatment", 45, 60),
  ...genderPair("Hair Care & Treatments", "keratin-treatment", "Keratin Treatment", 90, 180),
  ...genderPair("Hair Care & Treatments", "smoothening", "Smoothening", 120, 180),
  ...genderPair("Hair Care & Treatments", "rebonding-straightening", "Rebonding/Straightening", 150, 240),
  ...genderPair("Hair Care & Treatments", "hair-botox", "Hair Botox", 120, 180),

  ...genderPair("Facial & Skin", "cleanup", "Cleanup", 40, 45),
  ...genderPair("Facial & Skin", "fruit-facial", "Fruit Facial", 55, 60),
  ...genderPair("Facial & Skin", "gold-facial", "Gold Facial", 65, 75),
  ...genderPair("Facial & Skin", "diamond-facial", "Diamond Facial", 65, 75),
  ...genderPair("Facial & Skin", "hydrating-facial", "Hydrating Facial", 55, 60),
  ...genderPair("Facial & Skin", "brightening-facial", "Brightening Facial", 55, 60),
  ...genderPair("Facial & Skin", "anti-ageing-facial", "Anti-Ageing Facial", 65, 75),
  ...genderPair("Facial & Skin", "acne-control-facial", "Acne-Control Facial", 55, 60),
  ...genderPair("Facial & Skin", "de-tan", "De-Tan", 40, 45),
  ...genderPair("Facial & Skin", "bleach", "Bleach", 25, 30),
  ...genderPair("Facial & Skin", "face-polish", "Face Polish", 40, 45),

  ...genderPair("Threading", "eyebrows", "Eyebrows", 15, 15),
  item("Threading", "upper-lip", "Upper Lip", 10),
  item("Threading", "chin", "Chin", 10),
  item("Threading", "forehead", "Forehead", 10),
  item("Threading", "side-face", "Side Face", 20),
  ...genderPair("Threading", "full-face-threading", "Full Face Threading", 35, 35),

  ...genderPair("Waxing", "underarms", "Underarms", 20, 15),
  ...genderPair("Waxing", "half-arms", "Half Arms", 30, 25),
  ...genderPair("Waxing", "full-arms", "Full Arms", 45, 35),
  ...genderPair("Waxing", "half-legs", "Half Legs", 40, 30),
  ...genderPair("Waxing", "full-legs", "Full Legs", 60, 45),
  item("Waxing", "full-face-wax", "Full Face Wax", 30),
  ...genderPair("Waxing", "stomach", "Stomach", 40, 30),
  ...genderPair("Waxing", "back", "Back", 50, 35),
  ...genderPair("Waxing", "full-body-wax", "Full Body Wax", 150, 120),
  item("Waxing", "bikini-wax", "Bikini Wax", 35),

  ...genderPair("Hands, Feet & Nails", "manicure", "Manicure", 45, 45),
  ...genderPair("Hands, Feet & Nails", "pedicure", "Pedicure", 60, 60),
  ...genderPair("Hands, Feet & Nails", "spa-manicure", "Spa Manicure", 60, 60),
  ...genderPair("Hands, Feet & Nails", "spa-pedicure", "Spa Pedicure", 75, 75),
  ...genderPair("Hands, Feet & Nails", "nail-cut-file", "Nail Cut & File", 20, 20),
  item("Hands, Feet & Nails", "nail-polish", "Nail Polish", 20),
  item("Hands, Feet & Nails", "gel-polish", "Gel Polish", 45),
  item("Hands, Feet & Nails", "gel-removal", "Gel Removal", 30),
  item("Hands, Feet & Nails", "nail-art", "Nail Art", 60),
  item("Hands, Feet & Nails", "nail-extensions", "Nail Extensions", 120),
  item("Hands, Feet & Nails", "nail-extension-removal", "Nail Extension Removal", 45),

  item("Makeup & Occasion", "party-makeup", "Party Makeup", 75),
  item("Makeup & Occasion", "hd-makeup", "HD Makeup", 120),
  item("Makeup & Occasion", "airbrush-makeup", "Airbrush Makeup", 120),
  item("Makeup & Occasion", "engagement-makeup", "Engagement Makeup", 150),
  item("Makeup & Occasion", "bridal-makeup", "Bridal Makeup", 180),
  item("Makeup & Occasion", "groom-makeup-grooming", "Groom Makeup/Grooming", 90),
  item("Makeup & Occasion", "eye-makeup", "Eye Makeup", 45),
  item("Makeup & Occasion", "saree-draping", "Saree Draping", 30),
  item("Makeup & Occasion", "bridal-hairdo", "Bridal Hairdo", 120),
  item("Makeup & Occasion", "pre-bridal-package", "Pre-Bridal Package", 240),

  ...genderPair("Spa / Body Care", "foot-massage", "Foot Massage", 30, 30),
  ...genderPair("Spa / Body Care", "hand-massage", "Hand Massage", 25, 25),
  ...genderPair("Spa / Body Care", "head-neck-shoulder-massage", "Head/Neck/Shoulder Massage", 40, 40),
  ...genderPair("Spa / Body Care", "back-massage", "Back Massage", 45, 45),
  ...genderPair("Spa / Body Care", "body-scrub", "Body Scrub", 60, 60),
  ...genderPair("Spa / Body Care", "body-polish", "Body Polish", 75, 75),
] as const;

/** Match services consistently without changing the owner's display spelling. */
export function normalizeServiceIdentity(name: string, category: string | null | undefined): string {
  const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedCategory = (category ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${normalizedCategory}::${normalizedName}`;
}
