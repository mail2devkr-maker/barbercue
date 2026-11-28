// Delhi NCR hub (region page) and the FastQue Work dark launch.
import fs from "node:fs";
import path from "node:path";
import { delhiNcrFaq, delhiNcrIntro, isDelhiNcrCity, regionTotal } from "../seo-region";

const APP = path.join(__dirname, "..", "..", "app");
const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

describe("Delhi NCR region page", () => {
  it("recognises NCR cities only in India", () => {
    expect(isDelhiNcrCity({ name: "Greater Noida", countryCode: "IN" })).toBe(true);
    expect(isDelhiNcrCity({ name: "New Delhi", countryCode: "in" })).toBe(true);
    expect(isDelhiNcrCity({ name: "Gautam Buddha Nagar", countryCode: "IN" })).toBe(true);
    expect(isDelhiNcrCity({ name: "Hajipur", countryCode: "IN" })).toBe(false);
    expect(isDelhiNcrCity({ name: "Noida", countryCode: "US" })).toBe(false);
  });

  it("uses the live counts and makes no unverifiable claims", () => {
    const cities = [
      { name: "Greater Noida", shopCount: 41, hasMore: false },
      { name: "Noida", shopCount: 31, hasMore: false },
      { name: "Delhi", shopCount: 1, hasMore: false },
    ];
    expect(regionTotal(cities)).toEqual({ total: 73, hasMore: false });
    const intro = delhiNcrIntro(cities);
    expect(intro).toMatch(/^You can book a salon, barbershop or beauty parlour in Delhi NCR online on FastQue\./);
    expect(intro).toContain("73 shops are listed across Greater Noida (41), Noida (31), Delhi (1)");
    const text = JSON.stringify(delhiNcrFaq(cities));
    expect(text).toContain("Delhi (1 shop)");
    expect(text + intro).not.toMatch(/\bfree\b|\bbest\b|#1|guarantee|top[- ]rated/i);
  });

  it("is honest when no NCR shop is listed and stays out of the index", () => {
    expect(delhiNcrIntro([])).toBe("No salons in Delhi NCR are listed on FastQue yet.");
    expect(read("(public)/delhi-ncr/page.tsx")).toMatch(/robots: region\.length > 0 \? undefined : \{ index: false, follow: true \}/);
  });

  it("is in the sitemap only when an NCR city has shops", () => {
    expect(read("sitemap.ts")).toMatch(/if \(ncrHasShops\) entries\.push\(\{ url: `\$\{SITE_URL\}\/delhi-ncr`/);
  });
});

describe("FastQue Work dark launch", () => {
  it("/work is a real 404 until the marketplace is switched on", () => {
    expect(read("(work)/layout.tsx")).toMatch(/if \(!workMarketplaceLinksEnabled\(\)\) notFound\(\);/);
  });
});
