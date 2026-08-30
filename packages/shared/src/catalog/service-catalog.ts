/**
 * Reusable owner service presets. `suggestedPriceInr` (Issue 4) is a starting point pre-filled
 * into the owner's price field during onboarding — a rough India/INR market estimate, never
 * authoritative: the owner always sees, can edit, and must confirm the actual price before it's
 * saved (ServiceCatalogPicker never submits a price the owner hasn't looked at). Durations are the
 * same kind of operational starting point, also editable.
 */
export interface ServiceCatalogItem {
  id: string;
  name: string;
  category: string;
  defaultDurationMinutes: number;
  suggestedPriceInr: number;
}

function item(
  category: string,
  id: string,
  name: string,
  defaultDurationMinutes: number,
  suggestedPriceInr: number,
): ServiceCatalogItem {
  return { category, id, name, defaultDurationMinutes, suggestedPriceInr };
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
  item("Men's Hair & Grooming", "classic-haircut", "Classic Haircut", 30, 150),
  item("Men's Hair & Grooming", "skin-fade", "Skin Fade", 45, 250),
  item("Men's Hair & Grooming", "zero-fade", "Zero Fade", 40, 200),
  item("Men's Hair & Grooming", "buzz-cut", "Buzz Cut", 25, 100),
  item("Men's Hair & Grooming", "crew-cut", "Crew Cut", 30, 150),
  item("Men's Hair & Grooming", "kids-haircut", "Kids Haircut", 30, 120),
  item("Men's Hair & Grooming", "hair-wash", "Hair Wash", 15, 80),
  item("Men's Hair & Grooming", "blow-dry-styling", "Blow Dry/Styling", 30, 150),
  item("Men's Hair & Grooming", "hair-setting", "Hair Setting", 30, 150),
  item("Men's Hair & Grooming", "head-shave", "Head Shave", 25, 100),
  item("Men's Hair & Grooming", "haircut-beard", "Haircut + Beard", 50, 250),

  item("Beard & Shaving", "beard-trim", "Beard Trim", 20, 100),
  item("Beard & Shaving", "beard-shape-line-up", "Beard Shape/Line-up", 25, 120),
  item("Beard & Shaving", "clean-shave", "Clean Shave", 25, 80),
  item("Beard & Shaving", "premium-luxury-shave", "Premium/Luxury Shave", 40, 300),
  item("Beard & Shaving", "moustache-trim", "Moustache Trim", 15, 50),
  item("Beard & Shaving", "beard-colour", "Beard Colour", 35, 300),

  item("Women's Hair", "womens-haircut", "Women's Haircut", 45, 400),
  item("Women's Hair", "hair-trim", "Hair Trim", 30, 250),
  item("Women's Hair", "fringe-bangs-trim", "Fringe/Bangs Trim", 20, 150),
  item("Women's Hair", "girls-kids-haircut", "Girls/Kids Haircut", 30, 200),
  item("Women's Hair", "shampoo-conditioning", "Shampoo & Conditioning", 25, 200),
  item("Women's Hair", "blow-dry", "Blow Dry", 35, 300),
  item("Women's Hair", "hair-ironing", "Hair Ironing", 35, 350),
  item("Women's Hair", "hair-curling", "Hair Curling", 45, 400),
  item("Women's Hair", "basic-hairdo", "Basic Hairdo", 45, 400),
  item("Women's Hair", "party-hairdo", "Party Hairdo", 60, 700),

  item("Hair Colour", "root-touch-up", "Root Touch-Up", 75, 600),
  item("Hair Colour", "global-hair-colour", "Global Hair Colour", 120, 1500),
  item("Hair Colour", "highlights", "Highlights", 120, 2000),
  item("Hair Colour", "lowlights", "Lowlights", 120, 2000),
  item("Hair Colour", "balayage", "Balayage", 180, 3500),
  item("Hair Colour", "ombre", "Ombre", 180, 3500),
  item("Hair Colour", "henna", "Henna", 90, 500),

  item("Hair Care & Treatments", "hair-spa", "Hair Spa", 60, 600),
  item("Hair Care & Treatments", "deep-conditioning", "Deep Conditioning", 45, 500),
  item("Hair Care & Treatments", "head-massage", "Head Massage", 30, 300),
  item("Hair Care & Treatments", "anti-dandruff-treatment", "Anti-Dandruff Treatment", 60, 700),
  item("Hair Care & Treatments", "anti-hairfall-treatment", "Anti-Hairfall Treatment", 60, 800),
  item("Hair Care & Treatments", "scalp-treatment", "Scalp Treatment", 60, 800),
  item("Hair Care & Treatments", "keratin-treatment", "Keratin Treatment", 180, 3000),
  item("Hair Care & Treatments", "smoothening", "Smoothening", 180, 3500),
  item("Hair Care & Treatments", "rebonding-straightening", "Rebonding/Straightening", 240, 4000),
  item("Hair Care & Treatments", "hair-botox", "Hair Botox", 180, 3500),

  item("Facial & Skin", "cleanup", "Cleanup", 45, 400),
  item("Facial & Skin", "fruit-facial", "Fruit Facial", 60, 600),
  item("Facial & Skin", "gold-facial", "Gold Facial", 75, 1200),
  item("Facial & Skin", "diamond-facial", "Diamond Facial", 75, 1500),
  item("Facial & Skin", "hydrating-facial", "Hydrating Facial", 60, 800),
  item("Facial & Skin", "brightening-facial", "Brightening Facial", 60, 800),
  item("Facial & Skin", "anti-ageing-facial", "Anti-Ageing Facial", 75, 1500),
  item("Facial & Skin", "acne-control-facial", "Acne-Control Facial", 60, 900),
  item("Facial & Skin", "de-tan", "De-Tan", 45, 400),
  item("Facial & Skin", "bleach", "Bleach", 30, 300),
  item("Facial & Skin", "face-polish", "Face Polish", 45, 500),

  item("Threading", "eyebrows", "Eyebrows", 15, 50),
  item("Threading", "upper-lip", "Upper Lip", 10, 30),
  item("Threading", "chin", "Chin", 10, 30),
  item("Threading", "forehead", "Forehead", 10, 30),
  item("Threading", "side-face", "Side Face", 20, 60),
  item("Threading", "full-face-threading", "Full Face Threading", 35, 150),

  item("Waxing", "underarms", "Underarms", 15, 100),
  item("Waxing", "half-arms", "Half Arms", 25, 200),
  item("Waxing", "full-arms", "Full Arms", 35, 350),
  item("Waxing", "half-legs", "Half Legs", 30, 250),
  item("Waxing", "full-legs", "Full Legs", 45, 450),
  item("Waxing", "full-face-wax", "Full Face Wax", 30, 200),
  item("Waxing", "stomach", "Stomach", 30, 250),
  item("Waxing", "back", "Back", 35, 350),
  item("Waxing", "full-body-wax", "Full Body Wax", 120, 1500),
  item("Waxing", "bikini-wax", "Bikini Wax", 35, 400),

  item("Hands, Feet & Nails", "manicure", "Manicure", 45, 300),
  item("Hands, Feet & Nails", "pedicure", "Pedicure", 60, 400),
  item("Hands, Feet & Nails", "spa-manicure", "Spa Manicure", 60, 600),
  item("Hands, Feet & Nails", "spa-pedicure", "Spa Pedicure", 75, 700),
  item("Hands, Feet & Nails", "nail-cut-file", "Nail Cut & File", 20, 100),
  item("Hands, Feet & Nails", "nail-polish", "Nail Polish", 20, 100),
  item("Hands, Feet & Nails", "gel-polish", "Gel Polish", 45, 500),
  item("Hands, Feet & Nails", "gel-removal", "Gel Removal", 30, 200),
  item("Hands, Feet & Nails", "nail-art", "Nail Art", 60, 700),
  item("Hands, Feet & Nails", "nail-extensions", "Nail Extensions", 120, 1500),
  item("Hands, Feet & Nails", "nail-extension-removal", "Nail Extension Removal", 45, 400),

  item("Makeup & Occasion", "party-makeup", "Party Makeup", 75, 1500),
  item("Makeup & Occasion", "hd-makeup", "HD Makeup", 120, 2500),
  item("Makeup & Occasion", "airbrush-makeup", "Airbrush Makeup", 120, 3500),
  item("Makeup & Occasion", "engagement-makeup", "Engagement Makeup", 150, 4000),
  item("Makeup & Occasion", "bridal-makeup", "Bridal Makeup", 180, 8000),
  item("Makeup & Occasion", "groom-makeup-grooming", "Groom Makeup/Grooming", 90, 2000),
  item("Makeup & Occasion", "eye-makeup", "Eye Makeup", 45, 500),
  item("Makeup & Occasion", "saree-draping", "Saree Draping", 30, 300),
  item("Makeup & Occasion", "bridal-hairdo", "Bridal Hairdo", 120, 2500),
  item("Makeup & Occasion", "pre-bridal-package", "Pre-Bridal Package", 240, 8000),

  item("Spa / Body Care", "foot-massage", "Foot Massage", 30, 400),
  item("Spa / Body Care", "hand-massage", "Hand Massage", 25, 300),
  item("Spa / Body Care", "head-neck-shoulder-massage", "Head/Neck/Shoulder Massage", 40, 500),
  item("Spa / Body Care", "back-massage", "Back Massage", 45, 700),
  item("Spa / Body Care", "body-scrub", "Body Scrub", 60, 1200),
  item("Spa / Body Care", "body-polish", "Body Polish", 75, 1800),
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
