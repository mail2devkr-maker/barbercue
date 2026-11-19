// Automated SEO quality checks (super SEO pass / issue #429). Pure logic plus source scans: no
// browser, no network.
import fs from "node:fs";
import path from "node:path";
import { buildSalonJsonLd, salonKindLabel, salonSchemaType } from "../seo-salon";
import { cityFaq, cityIntro } from "../seo-city";
import { citySalonsWithServicePath } from "../seo-services";

const APP = path.join(__dirname, "..", "..", "app");
const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

const baseSalon = {
  id: "s1",
  publicId: "FQ1",
  name: "Raj Hair Studio",
  slug: "raj-hair-studio",
  citySlug: "hajipur-bihar",
  localitySlug: undefined,
  addressLine: "Station Road",
  countryCode: "IN",
  currency: "INR",
  postalCode: "844101",
  lat: null,
  lng: null,
  coverPhotoUrl: null,
  ratingAverage: 4.8,
  ratingCount: 12,
  priceMin: 100,
  priceMax: 300,
  description: null,
  phone: null,
  services: [{ id: "a", name: "Haircut", price: 100 }],
  photos: [],
  operatingHours: [
    { dayOfWeek: 1, openTime: "10:00", closeTime: "19:00", isClosed: false },
    { dayOfWeek: 0, openTime: "", closeTime: "", isClosed: true },
  ],
  salonType: "GENTS",
  salonTypeConfirmed: true,
};

describe("salon structured data", () => {
  const ld = buildSalonJsonLd(baseSalon, "https://fastque.com/in/hajipur-bihar/raj-hair-studio", { name: "Hajipur", state: "Bihar" }, null);

  it("never self-publishes review stars (Google treats them as self-serving)", () => {
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
  });
  it("uses the real city name and state, not the URL slug", () => {
    expect(ld.address.addressLocality).toBe("Hajipur");
    expect(ld.address.addressRegion).toBe("Bihar");
    expect(JSON.stringify(ld)).not.toContain("hajipur-bihar\",\"addressRegion");
  });
  it("lists only open days and leaves out unknown values instead of inventing them", () => {
    expect(ld.openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "10:00", closes: "19:00" },
    ]);
    expect(ld).not.toHaveProperty("geo");
    expect(ld).not.toHaveProperty("telephone");
    expect(ld).not.toHaveProperty("image");
    expect(JSON.stringify(ld)).not.toContain("null");
  });
  it("describes the real services with their prices", () => {
    expect(ld.hasOfferCatalog.itemListElement[0]).toEqual({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: "Haircut" },
      price: 100,
      priceCurrency: "INR",
    });
  });
  it("picks the schema type and visible label from the shop's own type", () => {
    expect(salonSchemaType({ salonType: "LADIES", salonTypeConfirmed: true })).toBe("BeautySalon");
    expect(salonSchemaType({ salonType: "GENTS", salonTypeConfirmed: true })).toBe("HairSalon");
    expect(salonSchemaType({ salonType: "LADIES", salonTypeConfirmed: false })).toBe("HairSalon");
    expect(salonKindLabel({ salonType: "LADIES", salonTypeConfirmed: true })).toBe("Beauty parlour");
    expect(salonKindLabel({ salonType: "GENTS", salonTypeConfirmed: true })).toBe("Barbershop");
    expect(salonKindLabel({ salonType: "UNISEX", salonTypeConfirmed: true })).toBe("Unisex salon");
    expect(salonKindLabel({ salonType: "UNISEX", salonTypeConfirmed: false })).toBe("Salon");
  });
});

describe("city page copy", () => {
  it("answers the question first and uses the live shop count", () => {
    const intro = cityIntro({ name: "Jharsuguda", state: "Odisha", shopCount: 1, hasMore: false });
    expect(intro).toMatch(/^You can book a salon, barbershop or beauty parlour in Jharsuguda online on FastQue\./);
    expect(intro).toContain("1 salon in Jharsuguda, Odisha is listed below");
    expect(cityIntro({ name: "Noida", state: "Uttar Pradesh", shopCount: 50, hasMore: true })).toContain("50+ salons");
    expect(cityFaq({ name: "Jharsuguda", state: "Odisha", shopCount: 1, hasMore: false })[0].a).toContain("1 salon in Jharsuguda is listed");
    expect(cityFaq({ name: "Noida", state: "Uttar Pradesh", shopCount: 3, hasMore: false })[0].a).toContain("are listed");
  });
  it("is honest when a city has no shop yet", () => {
    expect(cityIntro({ name: "Patna", state: "Bihar", shopCount: 0, hasMore: false })).toMatch(/^No salons in Patna are listed/);
  });
  it("makes no unverifiable claims (free, best, #1, guaranteed)", () => {
    const text = JSON.stringify(cityFaq({ name: "Hajipur", state: "Bihar", shopCount: 3, hasMore: false }));
    expect(text).not.toMatch(/\bfree\b|\bbest\b|#1|guarantee/i);
  });
});

describe("indexing rules in the source", () => {
  const dynamicPages = [
    "(public)/[countryCode]/[citySlug]/page.tsx",
    "(public)/[countryCode]/[citySlug]/[salonSlug]/page.tsx",
    "(public)/[countryCode]/[citySlug]/areas/[localitySlug]/page.tsx",
    "(public)/[countryCode]/[citySlug]/services/[serviceSlug]/page.tsx",
    "(public)/services/[serviceSlug]/page.tsx",
  ];

  it("unknown cities, shops, areas and services are real 404s, not soft 404s", () => {
    for (const p of dynamicPages) {
      const src = read(p);
      const meta = src.slice(src.indexOf("export async function generateMetadata"), src.indexOf("export default"));
      expect(meta).toMatch(/notFound\(\)/);
      expect(meta).not.toMatch(/return \{\};/);
    }
  });

  it("no loading boundary above the public pages (it would stream a 200 before a 404)", () => {
    expect(fs.existsSync(path.join(APP, "loading.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(APP, "(public)", "loading.tsx"))).toBe(false);
  });

  it("private areas are noindex", () => {
    for (const p of ["(auth)/layout.tsx", "(customer)/layout.tsx", "employee/layout.tsx", "(dashboard)/layout.tsx"]) {
      expect(read(p)).toMatch(/robots: \{ index: false, follow: false \}/);
    }
  });

  it("thin city, area and service-in-city pages are noindex until a shop is listed", () => {
    expect(read("(public)/[countryCode]/[citySlug]/page.tsx")).toMatch(/robots: shopCount > 0 \? undefined : \{ index: false, follow: true \}/);
    expect(read("(public)/[countryCode]/[citySlug]/areas/[localitySlug]/page.tsx")).toMatch(/index: false, follow: true/);
    expect(read("(public)/[countryCode]/[citySlug]/services/[serviceSlug]/page.tsx")).toMatch(/index: false, follow: true/);
  });

  it("the root layout sets metadataBase and the production canonical host is fastque.com", () => {
    expect(read("layout.tsx")).toMatch(/metadataBase: new URL\(SITE_URL\)/);
    const seo = fs.readFileSync(path.join(__dirname, "..", "seo.ts"), "utf8");
    expect(seo).toMatch(/PRODUCTION_SITE_URL = "https:\/\/fastque\.com"/);
    expect(seo).not.toMatch(/railway\.app"/);
  });

  it("the sitemap never stamps every URL with today's date and has no first-50 cap", () => {
    const src = read("sitemap.ts");
    expect(src).not.toMatch(/lastModified: now/);
    expect(src).toMatch(/nextCursor/);
    expect(src).toMatch(/if \(salons\.length === 0\) return;/);
  });

  it("the sitemap and the service-in-city page use the same discovery query", () => {
    expect(citySalonsWithServicePath({ slug: "jharsuguda", countryCode: "IN" }, "hair cut")).toBe(
      "salons?city=jharsuguda&countryCode=IN&service=hair%20cut&limit=50",
    );
    expect(read("sitemap.ts")).toMatch(/citySalonsWithServicePath\(city, svc\.query\)/);
    expect(read("(public)/[countryCode]/[citySlug]/services/[serviceSlug]/page.tsx")).toMatch(/citySalonsWithServicePath\(city, query\)/);
  });
});
