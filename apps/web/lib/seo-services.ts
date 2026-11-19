/**
 * Public SEO catalogue: every beauty / grooming service and shop type FastQue gets a landing page
 * for (/services/<slug> and /<country>/<city>/services/<slug>). `query` is what the discovery API
 * search matches against salon service names; `aka` are the other ways people type it into Google
 * (English, Hindi, Hinglish) and appear in the page copy so the page answers those searches too.
 */
export interface SeoService {
  slug: string;
  name: string;
  category: SeoCategory;
  /** Text sent to the discovery API `service` filter. */
  query: string;
  /** Other names people search for (shown on the page and in metadata keywords). */
  aka: readonly string[];
  /** One-line description used in the page intro and meta description. */
  blurb: string;
}

export const SEO_CATEGORIES = [
  "Hair",
  "Beard & Grooming",
  "Hair Colour & Treatments",
  "Skin & Facial",
  "Threading & Waxing",
  "Nails, Hands & Feet",
  "Makeup & Bridal",
  "Spa & Massage",
] as const;
export type SeoCategory = (typeof SEO_CATEGORIES)[number];

const s = (
  slug: string,
  name: string,
  category: SeoCategory,
  query: string,
  aka: string[],
  blurb: string,
): SeoService => ({ slug, name, category, query, aka, blurb });

export const SEO_SERVICES: readonly SeoService[] = [
  // Hair
  s("haircut", "Haircut", "Hair", "haircut", ["hair cut", "baal katwana", "hair cutting near me", "salon haircut"], "Haircuts for men, women and kids at salons and barbershops near you."),
  s("mens-haircut", "Men's Haircut", "Hair", "haircut", ["gents haircut", "boys haircut", "barber near me", "men's hair cutting"], "Classic cuts, fades and modern styles for men at barbershops near you."),
  s("womens-haircut", "Women's Haircut", "Hair", "haircut", ["ladies haircut", "girls haircut", "layer cut", "step cut"], "Layer cuts, step cuts, bob and trims at ladies and unisex salons near you."),
  s("kids-haircut", "Kids Haircut", "Hair", "kids", ["baby haircut", "children's haircut", "bacchon ka haircut"], "Gentle, quick haircuts for children at family-friendly salons."),
  s("skin-fade", "Skin Fade", "Hair", "fade", ["fade haircut", "zero fade", "low fade", "high fade", "taper fade"], "Skin, low, mid and high fades by barbers who specialise in fades."),
  s("buzz-cut", "Buzz Cut", "Hair", "buzz", ["crew cut", "army cut", "short haircut"], "Clean buzz and crew cuts done quickly at barbershops near you."),
  s("hair-styling", "Hair Styling", "Hair", "styling", ["blow dry", "hair setting", "party hairstyle", "hair styling near me"], "Blow-dry, setting and party hairstyles at salons near you."),
  s("hair-wash", "Hair Wash", "Hair", "wash", ["shampoo and conditioning", "hair wash near me"], "Shampoo, conditioning and wash-and-dry at salons near you."),
  s("hair-straightening", "Hair Straightening", "Hair Colour & Treatments", "straighten", ["hair rebonding", "permanent straightening", "smoothening"], "Rebonding, straightening and smoothening at professional salons."),
  s("hair-smoothening", "Hair Smoothening", "Hair Colour & Treatments", "smooth", ["keratin smoothening", "frizz treatment"], "Frizz-free smoothening treatments at salons near you."),
  s("keratin-treatment", "Keratin Treatment", "Hair Colour & Treatments", "keratin", ["keratin hair treatment", "brazilian keratin"], "Keratin treatments for smooth, shiny, manageable hair."),
  s("botox-hair-treatment", "Hair Botox", "Hair Colour & Treatments", "botox", ["hair botox treatment", "cysteine treatment"], "Hair botox and cysteine repair treatments at salons near you."),
  s("hair-spa", "Hair Spa", "Hair Colour & Treatments", "spa", ["hair spa near me", "hair spa treatment", "baalon ka spa"], "Nourishing hair spa treatments for dry, damaged or frizzy hair."),
  s("hair-colour", "Hair Colour", "Hair Colour & Treatments", "colour", ["hair color", "hair dye", "global colour", "baal rangna"], "Global colour, root touch-up and fashion shades at salons near you."),
  s("highlights", "Hair Highlights", "Hair Colour & Treatments", "highlight", ["balayage", "streaks", "ombre"], "Highlights, balayage, streaks and ombre by colour specialists."),
  s("henna-mehendi-hair", "Henna for Hair", "Hair Colour & Treatments", "henna", ["mehendi for hair", "natural hair colour"], "Natural henna and mehendi hair colouring at salons near you."),
  s("dandruff-treatment", "Anti-Dandruff Treatment", "Hair Colour & Treatments", "dandruff", ["dandruff treatment near me", "scalp treatment"], "Scalp and anti-dandruff treatments at salons near you."),
  s("hair-fall-treatment", "Hair Fall Treatment", "Hair Colour & Treatments", "hair fall", ["hair loss treatment", "hair regrowth"], "Hair-fall control and scalp-strengthening treatments."),
  s("head-massage", "Head Massage", "Spa & Massage", "massage", ["champi", "oil head massage", "sir ki malish"], "Relaxing oil head massage (champi) at salons and barbershops."),
  // Beard & grooming
  s("beard-trim", "Beard Trim", "Beard & Grooming", "beard", ["beard trimming", "beard styling", "dadhi trim"], "Beard trims, line-ups and styling by barbers near you."),
  s("beard-styling", "Beard Styling", "Beard & Grooming", "beard", ["beard shape", "beard design", "french beard"], "Beard shaping and designs for every face shape."),
  s("shave", "Shave", "Beard & Grooming", "shave", ["clean shave", "hot towel shave", "razor shave", "dadhi banana"], "Clean, hot-towel and razor shaves at barbershops near you."),
  s("moustache-trim", "Moustache Trim", "Beard & Grooming", "moustache", ["mustache trim", "moonch"], "Moustache trims and styling at barbershops near you."),
  s("beard-colour", "Beard Colour", "Beard & Grooming", "beard colour", ["beard dye", "beard color"], "Beard and moustache colouring at barbershops near you."),
  s("mens-grooming", "Men's Grooming", "Beard & Grooming", "grooming", ["grooming salon for men", "men's salon", "gents parlour"], "Complete grooming for men: hair, beard, skin and more."),
  s("groom-package", "Groom Package", "Makeup & Bridal", "groom", ["dulha makeup", "groom makeup", "wedding grooming for men"], "Wedding-day grooming packages for the groom."),
  // Skin
  s("facial", "Facial", "Skin & Facial", "facial", ["facial near me", "fruit facial", "gold facial", "diamond facial"], "Fruit, gold, diamond and hydrating facials at salons near you."),
  s("cleanup", "Cleanup", "Skin & Facial", "clean", ["face cleanup", "skin cleanup", "clean up"], "Quick face cleanups for fresh, clear skin."),
  s("de-tan", "De-Tan", "Skin & Facial", "tan", ["detan", "tan removal", "d-tan pack"], "De-tan face and body treatments at salons near you."),
  s("bleach", "Bleach", "Skin & Facial", "bleach", ["face bleach", "skin bleach"], "Face and body bleach at salons and beauty parlours near you."),
  s("hydrafacial", "Hydrafacial", "Skin & Facial", "hydra", ["hydra facial", "hydrating facial"], "Hydrafacial and deep-hydration skin treatments."),
  s("face-massage", "Face Massage", "Skin & Facial", "massage", ["face massage near me"], "Relaxing face massage at salons near you."),
  s("acne-treatment", "Acne Treatment", "Skin & Facial", "acne", ["pimple treatment", "acne facial"], "Acne and pimple-care facials at salons near you."),
  // Threading & waxing
  s("threading", "Threading", "Threading & Waxing", "thread", ["eyebrow threading", "upper lip threading", "face threading", "aibro"], "Eyebrow, upper-lip and full-face threading near you."),
  s("eyebrow-shaping", "Eyebrow Shaping", "Threading & Waxing", "eyebrow", ["eyebrows", "brow shaping", "eyebrow design"], "Eyebrow shaping and design at beauty parlours near you."),
  s("waxing", "Waxing", "Threading & Waxing", "wax", ["full body wax", "arms and legs wax", "rica wax", "chocolate wax"], "Full-body, arms, legs and underarm waxing near you."),
  s("full-body-waxing", "Full Body Waxing", "Threading & Waxing", "full body", ["full body wax near me"], "Full-body waxing with regular, Rica and chocolate wax."),
  s("face-waxing", "Face Waxing", "Threading & Waxing", "face wax", ["upper lip wax", "chin wax"], "Face, upper-lip and chin waxing at salons near you."),
  s("bikini-wax", "Bikini Wax", "Threading & Waxing", "bikini", ["brazilian wax", "bikini line wax"], "Bikini and Brazilian waxing at ladies salons near you."),
  // Nails, hands & feet
  s("manicure", "Manicure", "Nails, Hands & Feet", "manicure", ["manicure near me", "spa manicure"], "Classic and spa manicures at salons near you."),
  s("pedicure", "Pedicure", "Nails, Hands & Feet", "pedicure", ["pedicure near me", "spa pedicure", "foot spa"], "Classic and spa pedicures at salons near you."),
  s("nail-art", "Nail Art", "Nails, Hands & Feet", "nail", ["nail design", "nail paint", "nail studio"], "Nail art, designs and polish at nail studios and salons."),
  s("nail-extensions", "Nail Extensions", "Nails, Hands & Feet", "extension", ["acrylic nails", "gel nails", "artificial nails"], "Acrylic, gel and press-on nail extensions near you."),
  s("gel-polish", "Gel Polish", "Nails, Hands & Feet", "gel", ["gel nail polish", "gel manicure"], "Long-lasting gel polish at nail studios near you."),
  // Makeup & bridal
  s("makeup", "Makeup", "Makeup & Bridal", "makeup", ["makeup artist near me", "party makeup", "makeup salon"], "Party, engagement and occasion makeup by artists near you."),
  s("bridal-makeup", "Bridal Makeup", "Makeup & Bridal", "bridal", ["dulhan makeup", "wedding makeup", "bride makeup", "HD bridal makeup"], "Bridal, HD and airbrush wedding makeup by salons near you."),
  s("party-makeup", "Party Makeup", "Makeup & Bridal", "party", ["function makeup", "reception makeup"], "Party and function makeup at salons near you."),
  s("hd-makeup", "HD Makeup", "Makeup & Bridal", "hd", ["airbrush makeup", "hd makeup near me"], "HD and airbrush makeup for weddings and events."),
  s("saree-draping", "Saree Draping", "Makeup & Bridal", "saree", ["saree draping near me", "dupatta setting"], "Saree draping and dupatta setting for functions."),
  s("mehendi", "Mehendi", "Makeup & Bridal", "mehendi", ["mehndi", "henna design", "bridal mehendi"], "Bridal and party mehendi designs near you."),
  s("pre-bridal-package", "Pre-Bridal Package", "Makeup & Bridal", "bridal", ["pre bridal", "bridal package"], "Pre-bridal skin, hair and body packages before the wedding."),
  // Spa & massage
  s("body-massage", "Body Massage", "Spa & Massage", "massage", ["massage near me", "full body massage", "aroma massage"], "Relaxing full-body and aroma massage at spas near you."),
  s("body-polishing", "Body Polishing", "Spa & Massage", "polish", ["body polish", "body scrub"], "Body polishing and scrubs for smooth, glowing skin."),
  s("foot-massage", "Foot Massage", "Spa & Massage", "foot", ["foot reflexology", "pairon ki malish"], "Foot massage and reflexology at spas and salons near you."),
];

/** The shop types people search for ("beauty parlour near me", "unisex salon in Noida"). */
export interface SeoShopType {
  slug: string;
  name: string;
  plural: string;
  aka: readonly string[];
}

export const SEO_SHOP_TYPES: readonly SeoShopType[] = [
  { slug: "salons", name: "Salon", plural: "Salons", aka: ["salon near me", "hair salon", "best salon"] },
  { slug: "barbershops", name: "Barbershop", plural: "Barbershops", aka: ["barber shop", "barber near me", "gents salon", "nai ki dukan"] },
  { slug: "beauty-parlours", name: "Beauty Parlour", plural: "Beauty Parlours", aka: ["beauty parlor", "ladies parlour", "beauty salon", "parlour near me"] },
  { slug: "unisex-salons", name: "Unisex Salon", plural: "Unisex Salons", aka: ["unisex salon near me", "family salon"] },
  { slug: "spas", name: "Spa", plural: "Spas", aka: ["spa near me", "day spa", "massage centre"] },
  { slug: "nail-studios", name: "Nail Studio", plural: "Nail Studios", aka: ["nail salon", "nail art studio", "nail bar"] },
  { slug: "makeup-studios", name: "Makeup Studio", plural: "Makeup Studios", aka: ["makeup artist", "bridal studio"] },
];

export const seoServiceBySlug = (slug: string): SeoService | undefined =>
  SEO_SERVICES.find((x) => x.slug === slug);

export const seoServicesInCategory = (category: SeoCategory): SeoService[] =>
  SEO_SERVICES.filter((x) => x.category === category);

/** Related services shown at the bottom of a service page (same category, then neighbours). */
export function relatedSeoServices(service: SeoService, max = 8): SeoService[] {
  return SEO_SERVICES.filter((x) => x.category === service.category && x.slug !== service.slug).slice(0, max);
}

/**
 * The discovery query for "shops in this city that offer this service". Shared by the city
 * service page and the sitemap so both hit the same cached request.
 */
export function citySalonsWithServicePath(city: { slug: string; countryCode: string }, query: string): string {
  return `salons?city=${city.slug}&countryCode=${city.countryCode}&service=${encodeURIComponent(query)}&limit=50`;
}
