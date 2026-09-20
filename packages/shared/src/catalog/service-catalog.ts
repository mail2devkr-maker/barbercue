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
    description: 'Everyday, high-frequency services for quick salon setup.',
  },
  {
    id: 'STANDARD',
    label: 'Standard Salon Services',
    description: 'Expanded grooming, colour, facial, waxing and styling services.',
  },
  {
    id: 'ADVANCED',
    label: 'Advance Salon Services',
    description: 'Premium, technical, bridal, nail-extension and intensive treatment services.',
  },
] as const;

export interface ServiceCatalogItem {
  id: string;
  name: string;
  category: string;
  defaultDurationMinutes: number;
  /** Suggested India onboarding price in rupees; editable by the salon owner before save. */
  defaultPriceInr: number;
  pack: ServicePackId;
}

// Every catalog service belongs to exactly one onboarding pack. Keeping the partition in one
// place lets web and mobile offer the same one-tap pack selection without duplicating business
// rules across clients.
const BASIC_SERVICE_IDS = new Set([
  'classic-haircut',
  'buzz-cut',
  'crew-cut',
  'kids-haircut',
  'hair-wash',
  'head-shave',
  'beard-trim',
  'beard-shape-line-up',
  'clean-shave',
  'moustache-trim',
  'womens-haircut',
  'hair-trim',
  'fringe-bangs-trim',
  'girls-kids-haircut',
  'shampoo-conditioning',
  'blow-dry',
  'hair-ironing',
  'basic-hairdo',
  'deep-conditioning',
  'head-massage',
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
  'foot-massage',
  'hand-massage',
  'head-neck-shoulder-massage',
]);

const ADVANCED_SERVICE_IDS = new Set([
  'balayage',
  'ombre',
  'keratin-treatment',
  'smoothening',
  'rebonding-straightening',
  'hair-botox',
  'anti-ageing-facial',
  'acne-control-facial',
  'full-body-wax',
  'bikini-wax',
  'spa-manicure',
  'spa-pedicure',
  'gel-polish',
  'nail-art',
  'nail-extensions',
  'nail-extension-removal',
  'hd-makeup',
  'airbrush-makeup',
  'engagement-makeup',
  'bridal-makeup',
  'groom-makeup-grooming',
  'bridal-hairdo',
  'pre-bridal-package',
  'body-scrub',
  'body-polish',
]);


// Curated FastQue onboarding suggestions for India. These are intentionally round, editable
// starting points rather than claims of a single nationwide market price. Keeping them beside the
// shared catalog gives web and mobile exactly the same defaults.
const SUGGESTED_PRICE_INR_BY_ID: Readonly<Record<string, number>> = {
  "classic-haircut": 250,
  "skin-fade": 350,
  "zero-fade": 300,
  "buzz-cut": 200,
  "crew-cut": 250,
  "kids-haircut": 200,
  "hair-wash": 150,
  "blow-dry-styling": 250,
  "hair-setting": 250,
  "head-shave": 200,
  "haircut-beard": 400,
  "beard-trim": 150,
  "beard-shape-line-up": 200,
  "clean-shave": 150,
  "premium-luxury-shave": 350,
  "moustache-trim": 100,
  "beard-colour": 300,
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
  "root-touch-up": 1200,
  "global-hair-colour": 2500,
  "highlights": 3000,
  "lowlights": 3000,
  "balayage": 4500,
  "ombre": 4500,
  "henna": 600,
  "hair-spa": 800,
  "deep-conditioning": 600,
  "head-massage": 300,
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

function packFor(id: string): ServicePackId {
  if (BASIC_SERVICE_IDS.has(id)) return 'BASIC';
  if (ADVANCED_SERVICE_IDS.has(id)) return 'ADVANCED';
  return 'STANDARD';
}

function item(
  category: string,
  id: string,
  name: string,
  defaultDurationMinutes: number,
): ServiceCatalogItem {
  const defaultPriceInr = SUGGESTED_PRICE_INR_BY_ID[id];
  if (defaultPriceInr === undefined) {
    throw new Error(`Missing suggested service price for catalog item: ${id}`);
  }
  return { category, id, name, defaultDurationMinutes, defaultPriceInr, pack: packFor(id) };
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

  item("Hair Colour", "root-touch-up", "Root Touch-Up", 75),
  item("Hair Colour", "global-hair-colour", "Global Hair Colour", 120),
  item("Hair Colour", "highlights", "Highlights", 120),
  item("Hair Colour", "lowlights", "Lowlights", 120),
  item("Hair Colour", "balayage", "Balayage", 180),
  item("Hair Colour", "ombre", "Ombre", 180),
  item("Hair Colour", "henna", "Henna", 90),

  item("Hair Care & Treatments", "hair-spa", "Hair Spa", 60),
  item("Hair Care & Treatments", "deep-conditioning", "Deep Conditioning", 45),
  item("Hair Care & Treatments", "head-massage", "Head Massage", 30),
  item("Hair Care & Treatments", "anti-dandruff-treatment", "Anti-Dandruff Treatment", 60),
  item("Hair Care & Treatments", "anti-hairfall-treatment", "Anti-Hairfall Treatment", 60),
  item("Hair Care & Treatments", "scalp-treatment", "Scalp Treatment", 60),
  item("Hair Care & Treatments", "keratin-treatment", "Keratin Treatment", 180),
  item("Hair Care & Treatments", "smoothening", "Smoothening", 180),
  item("Hair Care & Treatments", "rebonding-straightening", "Rebonding/Straightening", 240),
  item("Hair Care & Treatments", "hair-botox", "Hair Botox", 180),

  item("Facial & Skin", "cleanup", "Cleanup", 45),
  item("Facial & Skin", "fruit-facial", "Fruit Facial", 60),
  item("Facial & Skin", "gold-facial", "Gold Facial", 75),
  item("Facial & Skin", "diamond-facial", "Diamond Facial", 75),
  item("Facial & Skin", "hydrating-facial", "Hydrating Facial", 60),
  item("Facial & Skin", "brightening-facial", "Brightening Facial", 60),
  item("Facial & Skin", "anti-ageing-facial", "Anti-Ageing Facial", 75),
  item("Facial & Skin", "acne-control-facial", "Acne-Control Facial", 60),
  item("Facial & Skin", "de-tan", "De-Tan", 45),
  item("Facial & Skin", "bleach", "Bleach", 30),
  item("Facial & Skin", "face-polish", "Face Polish", 45),

  item("Threading", "eyebrows", "Eyebrows", 15),
  item("Threading", "upper-lip", "Upper Lip", 10),
  item("Threading", "chin", "Chin", 10),
  item("Threading", "forehead", "Forehead", 10),
  item("Threading", "side-face", "Side Face", 20),
  item("Threading", "full-face-threading", "Full Face Threading", 35),

  item("Waxing", "underarms", "Underarms", 15),
  item("Waxing", "half-arms", "Half Arms", 25),
  item("Waxing", "full-arms", "Full Arms", 35),
  item("Waxing", "half-legs", "Half Legs", 30),
  item("Waxing", "full-legs", "Full Legs", 45),
  item("Waxing", "full-face-wax", "Full Face Wax", 30),
  item("Waxing", "stomach", "Stomach", 30),
  item("Waxing", "back", "Back", 35),
  item("Waxing", "full-body-wax", "Full Body Wax", 120),
  item("Waxing", "bikini-wax", "Bikini Wax", 35),

  item("Hands, Feet & Nails", "manicure", "Manicure", 45),
  item("Hands, Feet & Nails", "pedicure", "Pedicure", 60),
  item("Hands, Feet & Nails", "spa-manicure", "Spa Manicure", 60),
  item("Hands, Feet & Nails", "spa-pedicure", "Spa Pedicure", 75),
  item("Hands, Feet & Nails", "nail-cut-file", "Nail Cut & File", 20),
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

  item("Spa / Body Care", "foot-massage", "Foot Massage", 30),
  item("Spa / Body Care", "hand-massage", "Hand Massage", 25),
  item("Spa / Body Care", "head-neck-shoulder-massage", "Head/Neck/Shoulder Massage", 40),
  item("Spa / Body Care", "back-massage", "Back Massage", 45),
  item("Spa / Body Care", "body-scrub", "Body Scrub", 60),
  item("Spa / Body Care", "body-polish", "Body Polish", 75),
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
