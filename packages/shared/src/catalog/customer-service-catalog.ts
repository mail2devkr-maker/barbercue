import { SALON_DISCOVERY_CATEGORIES } from './salon-discovery-filters';
import { SERVICE_CATALOG, type ServiceCatalogItem } from './service-catalog';

/**
 * The customer-facing "All Services" catalogue — what a customer can BROWSE, grouped by the same
 * nine discovery categories the website's search chips use. It is derived from the existing sources
 * of truth, never a second hand-typed list:
 *
 *  - categories:   SALON_DISCOVERY_CATEGORIES (id / label / search keyword),
 *  - services:     SERVICE_CATALOG (the owner onboarding menu, 145 presets), collapsed so that the
 *                  separate "Gents X" / "Ladies X" variants of one service become ONE customer card,
 *  - style cards:  PHOTOGRAPHED_SERVICES below — the website landing page's 20 photographed services,
 *                  which carry their own dedicated editorial photo.
 *
 * Browsing the catalogue is NOT a promise that any particular shop offers a service. A tap opens the
 * normal shop search for that service, which is where real availability (and an honest empty state)
 * lives. No prices are shown here: the catalogue has no reliable customer-facing price, and the
 * owner-onboarding suggested prices are editable starting points, not market prices.
 *
 * Photos are FastQue's own editorial photography (apps/web/public/editorial). `photoPath` is a path
 * under that library's public root (e.g. "services/barber/taper.webp"); a service without a dedicated
 * photo uses its category's photo and says so via `dedicatedPhoto: false`.
 */

export interface CustomerServiceEntry {
  /** Stable, unique id (kebab-case). */
  id: string;
  /** Customer-facing name, never prefixed with a salon audience ("Facial", not "Gents Facial"). */
  name: string;
  /** The exact `service` search keyword sent to the shop search. */
  query: string;
  categoryId: string;
  /** Path under the editorial library root, no leading slash. */
  photoPath: string;
  /** True only when this service has its own photograph rather than its category's. */
  dedicatedPhoto: boolean;
}

export interface CustomerServiceCategory {
  id: string;
  label: string;
  /** The category's flagship photograph. */
  photoPath: string;
  services: CustomerServiceEntry[];
}

/** Category flagship photographs, keyed by SALON_DISCOVERY_CATEGORIES id. */
export const CUSTOMER_CATEGORY_PHOTOS: Readonly<Record<string, string>> = {
  hair: 'services/hair/hair-salon-flagship.webp',
  barber: 'services/barber/precision-fade.webp',
  beard: 'services/beard/beard-grooming.webp',
  nails: 'services/nails/manicure-flagship.webp',
  facial: 'services/skincare/facial-flagship.webp',
  makeup: 'services/makeup/makeup-flagship.webp',
  'waxing-threading': 'services/waxing-threading/threading-flagship.webp',
  'spa-massage': 'services/spa-massage/spa-flagship.webp',
  'bridal-event': 'services/bridal/bridal-event.webp',
};

/**
 * Services that have their own photograph (the website's landing "Popular services" set). `query`
 * is the closest real catalogue term — a style card with no catalogue equivalent of its own (Taper,
 * Quiff…) falls back to its parent service term rather than an invented name that would match no shop.
 */
export const PHOTOGRAPHED_SERVICES: readonly Omit<CustomerServiceEntry, 'dedicatedPhoto'>[] = [
  { id: 'classic-haircut', name: 'Classic Haircut', query: 'Classic Haircut', categoryId: 'barber', photoPath: 'services/barber/classic-haircut.webp' },
  { id: 'taper', name: 'Taper', query: 'Fade', categoryId: 'barber', photoPath: 'services/barber/taper.webp' },
  { id: 'buzz-cut', name: 'Buzz Cut', query: 'Buzz Cut', categoryId: 'barber', photoPath: 'services/barber/buzz-cut.webp' },
  { id: 'scissor-cut', name: 'Scissor Cut', query: 'Haircut', categoryId: 'barber', photoPath: 'services/barber/scissor-cut.webp' },
  { id: 'textured-crop', name: 'Textured Crop', query: 'Haircut', categoryId: 'barber', photoPath: 'services/barber/textured-crop.webp' },
  { id: 'pompadour', name: 'Pompadour', query: 'Styling', categoryId: 'barber', photoPath: 'services/barber/pompadour.webp' },
  { id: 'quiff', name: 'Quiff', query: 'Styling', categoryId: 'barber', photoPath: 'services/barber/quiff.webp' },
  { id: 'undercut', name: 'Undercut', query: 'Haircut', categoryId: 'barber', photoPath: 'services/barber/undercut.webp' },
  { id: 'senior-haircut', name: 'Senior Haircut', query: 'Haircut', categoryId: 'barber', photoPath: 'services/grooming/senior-haircut.webp' },
  { id: 'head-shave', name: 'Head Shave', query: 'Head Shave', categoryId: 'beard', photoPath: 'services/grooming/head-shave.webp' },
  { id: 'hot-towel-shave', name: 'Hot-Towel Shave', query: 'Shave', categoryId: 'beard', photoPath: 'services/grooming/hot-towel-shave.webp' },
  { id: 'moustache-grooming', name: 'Moustache Grooming', query: 'Moustache', categoryId: 'beard', photoPath: 'services/grooming/moustache-grooming.webp' },
  { id: 'womens-haircut', name: "Women's Haircut", query: "Women's Haircut", categoryId: 'hair', photoPath: 'services/hair/womens-haircut.webp' },
  { id: 'layered-haircut', name: 'Layered Haircut', query: 'Haircut', categoryId: 'hair', photoPath: 'services/hair/layered-haircut.webp' },
  { id: 'fringe-bangs', name: 'Fringe / Bangs', query: 'Fringe', categoryId: 'hair', photoPath: 'services/hair/fringe-bangs.webp' },
  { id: 'hair-styling', name: 'Hair Styling', query: 'Styling', categoryId: 'hair', photoPath: 'services/hair/hair-styling.webp' },
  { id: 'blowout', name: 'Blowout', query: 'Blow Dry', categoryId: 'hair', photoPath: 'services/hair/blowout.webp' },
  { id: 'straight-styling', name: 'Straight Styling', query: 'Hair Ironing', categoryId: 'hair', photoPath: 'services/hair/straight-styling.webp' },
  { id: 'curls-waves', name: 'Curls & Waves', query: 'Hair Curling', categoryId: 'hair', photoPath: 'services/hair/curls-waves.webp' },
  { id: 'updo', name: 'Updo', query: 'Hairdo', categoryId: 'hair', photoPath: 'services/hair/updo.webp' },
];

/** SERVICE_CATALOG category -> discovery category. "Makeup & Occasion" is split by name below. */
const CATALOG_CATEGORY_TO_DISCOVERY: Readonly<Record<string, string>> = {
  "Men's Hair & Grooming": 'barber',
  'Beard & Shaving': 'beard',
  "Women's Hair": 'hair',
  'Hair Colour': 'hair',
  'Hair Care & Treatments': 'hair',
  'Facial & Skin': 'facial',
  Threading: 'waxing-threading',
  Waxing: 'waxing-threading',
  'Hands, Feet & Nails': 'nails',
  'Makeup & Occasion': 'makeup',
  'Spa / Body Care': 'spa-massage',
};

const BRIDAL_OR_EVENT = /bridal|engagement|groom|saree draping/i;

function discoveryCategoryFor(item: ServiceCatalogItem): string | null {
  if (item.category === 'Makeup & Occasion') return BRIDAL_OR_EVENT.test(item.name) ? 'bridal-event' : 'makeup';
  return CATALOG_CATEGORY_TO_DISCOVERY[item.category] ?? null;
}

/** "Gents Fruit Facial" / "Ladies Fruit Facial" -> "Fruit Facial". Audience is a salon concern. */
export function customerServiceName(catalogName: string): string {
  return catalogName.replace(/^(gents|ladies)\s+/i, '').trim();
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizedKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildCustomerCatalog(): CustomerServiceCategory[] {
  const categories = SALON_DISCOVERY_CATEGORIES.map<CustomerServiceCategory>((category) => ({
    id: category.id,
    label: category.label,
    photoPath: CUSTOMER_CATEGORY_PHOTOS[category.id],
    services: [],
  }));
  const byId = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();

  const add = (entry: CustomerServiceEntry) => {
    const category = byId.get(entry.categoryId);
    if (!category) return;
    // One card per service across the whole catalogue: the first (photographed) entry wins.
    const key = normalizedKey(entry.name);
    if (seen.has(key)) return;
    seen.add(key);
    category.services.push(entry);
  };

  // Dedicated-photo services first, so a catalogue preset with the same name never replaces them.
  for (const showcase of PHOTOGRAPHED_SERVICES) add({ ...showcase, dedicatedPhoto: true });

  for (const item of SERVICE_CATALOG) {
    const categoryId = discoveryCategoryFor(item);
    if (!categoryId) continue;
    const name = customerServiceName(item.name);
    add({
      id: slug(name),
      name,
      query: name,
      categoryId,
      photoPath: CUSTOMER_CATEGORY_PHOTOS[categoryId],
      dedicatedPhoto: false,
    });
  }

  // A service name that appears under two categories (it should not) keeps a unique id per category.
  const ids = new Set<string>();
  for (const category of categories) {
    for (const service of category.services) {
      let id = service.id;
      if (ids.has(id)) id = `${category.id}-${id}`;
      ids.add(id);
      service.id = id;
    }
  }
  return categories.filter((category) => category.services.length > 0);
}

export const CUSTOMER_SERVICE_CATEGORIES: readonly CustomerServiceCategory[] = buildCustomerCatalog();

/** Case-insensitive name filter used by the catalogue's secondary in-screen search. */
export function filterCustomerServices(
  categories: readonly CustomerServiceCategory[],
  term: string,
): CustomerServiceCategory[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [...categories];
  return categories
    .map((category) => ({ ...category, services: category.services.filter((s) => s.name.toLowerCase().includes(needle)) }))
    .filter((category) => category.services.length > 0);
}
