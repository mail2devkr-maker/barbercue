import fs from "fs";
import path from "path";
import { OWNER_SECTIONS, WEBSITE_SECTION_IDS } from "../../../../mobile/lib/owner/owner-sections";
import { NAV_ITEMS } from "../../owner/owner-nav";

// The website's owner dashboard is the behaviour reference for the mobile owner hub. This test reads
// the website's real navigation (owner-nav.ts), its real shop-controls list and its real route
// folders, so a website section that disappears (or a mobile section the website cannot reach) fails
// here until the two products are brought back in line.
const APP = path.join(__dirname, "..", "..", "..", "app", "(dashboard)", "dashboard", "salons", "[salonId]");
const shopControls = fs.readFileSync(path.join(__dirname, "..", "..", "owner", "ShopControls.tsx"), "utf8");

// A mobile section id -> the website page that serves it (under /dashboard/salons/:salonId/).
const WEBSITE_PAGE = {
  queue: "queue",
  settings: "settings",
  bookings: "bookings",
  newAppointment: "bookings/new",
  schedule: "schedule",
  customers: "customers",
  analytics: "analytics",
  cancellations: "cancellations",
  invoices: "invoices",
  reviews: "reviews",
  verification: "verification",
  services: "services",
  hours: "hours",
  photos: "photos",
  chairs: "chairs",
  staff: "staff",
};

// The website's schedule section is labelled "Calendar" and lives at /schedule.
const navPaths = new Set(NAV_ITEMS.map((item) => item.path).filter(Boolean));
const controlPaths = new Set([...shopControls.matchAll(/path:\s*"([a-z-]+)/g)].map((match) => match[1]));

describe("mobile owner hub stays in parity with the website's owner dashboard", () => {
  it("keeps the mobile registry and its website list identical", () => {
    expect(OWNER_SECTIONS.map((section) => section.id)).toEqual([...WEBSITE_SECTION_IDS]);
  });

  it("every mobile section has a real page on the website", () => {
    for (const section of OWNER_SECTIONS) {
      const page = WEBSITE_PAGE[section.id];
      expect({ id: section.id, mapped: Boolean(page) }).toEqual({ id: section.id, mapped: true });
      expect({ id: section.id, exists: fs.existsSync(path.join(APP, ...page.split("/"), "page.tsx")) }).toEqual({
        id: section.id,
        exists: true,
      });
    }
  });

  it("every mobile section is reachable on the website from its navigation or shop controls", () => {
    for (const section of OWNER_SECTIONS) {
      const root = WEBSITE_PAGE[section.id].split("/")[0];
      const reachable = navPaths.has(root) || controlPaths.has(root);
      expect({ id: section.id, reachable }).toEqual({ id: section.id, reachable: true });
    }
  });
});
