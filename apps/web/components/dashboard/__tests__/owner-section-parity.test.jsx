import fs from "fs";
import path from "path";
import { OWNER_SECTIONS, WEBSITE_SECTION_IDS } from "../../../../mobile/lib/owner/owner-sections";

// The website's OwnerShopNav is the behaviour reference for the mobile owner hub. This test reads
// its real source, so adding, removing or reordering a website section fails here until the mobile
// registry (apps/mobile/lib/owner/owner-sections.ts) is updated to match.
const source = fs.readFileSync(path.join(__dirname, "..", "OwnerShopNav.tsx"), "utf8");
const block = source.slice(source.indexOf("const SHOP_SECTIONS"), source.indexOf("] as const;"));
const websiteIds = [...block.matchAll(/id:\s*"([a-z-]+)"/g)].map((match) => match[1]);

describe("mobile owner hub stays in parity with the website's shop-management nav", () => {
  it("parses the website's sections", () => {
    expect(websiteIds.length).toBeGreaterThanOrEqual(13);
  });

  it("offers exactly the same sections in the same order", () => {
    expect(OWNER_SECTIONS.map((section) => section.id)).toEqual(websiteIds);
    expect([...WEBSITE_SECTION_IDS]).toEqual(websiteIds);
  });
});
