import fs from "fs";
import path from "path";
import { NAV_GROUPS, NAV_ITEMS, activeItemId, hrefFor, navItemsFor } from "../owner-nav";

// The dashboard's own promise: EVERY visible menu entry leads to a real page. This walks the app
// directory, so a menu item pointing at a page that does not exist (a dead link) fails the build.
const SALON_DIR = path.join(__dirname, "../../../app/(dashboard)/dashboard/salons/[salonId]");
const APP_DIR = path.join(__dirname, "../../../app");

function pageExists(relative) {
  return fs.existsSync(path.join(SALON_DIR, relative, "page.tsx"));
}

describe("owner navigation", () => {
  it("has unique ids and only known groups", () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(NAV_GROUPS.map((g) => g.id));
    for (const item of NAV_ITEMS) expect(groups.has(item.group)).toBe(true);
  });

  it("every salon-scoped menu item points at a page that exists", () => {
    for (const item of NAV_ITEMS.filter((i) => i.path !== undefined)) {
      expect({ id: item.id, exists: pageExists(item.path) }).toEqual({ id: item.id, exists: true });
    }
  });

  it("every site-level menu item points at a real route", () => {
    for (const item of NAV_ITEMS.filter((i) => i.href)) {
      const route = item.href.replace(/^\//, "");
      const candidates = ["(public)", "(customer)", "(auth)", ""].map((group) => path.join(APP_DIR, group, route, "page.tsx"));
      expect({ id: item.id, exists: candidates.some((p) => fs.existsSync(p)) }).toEqual({ id: item.id, exists: true });
    }
  });

  it("the actions the menu promises exist as pages: in-shop appointment form and the notification centre", () => {
    expect(pageExists("bookings/new")).toBe(true);
    expect(pageExists("notifications")).toBe(true);
  });

  it("lists a capability-gated entry only when the server says the feature is usable", () => {
    const gated = NAV_ITEMS.filter((i) => i.requiresFeature);
    expect(gated.map((i) => i.id)).toContain("demo-data");
    const ids = (kind, status) => navItemsFor(kind, status ? { [gated[0].requiresFeature]: { status, reasonCode: null, updatedAt: null } } : undefined).map((i) => i.id);
    for (const item of gated) {
      const withStatus = (kind, status) => navItemsFor(kind, { [item.requiresFeature]: { status, reasonCode: null, updatedAt: null } }).map((i) => i.id);
      expect(navItemsFor("owner").map((i) => i.id)).not.toContain(item.id);
      expect(withStatus("owner", "DISABLED")).not.toContain(item.id);
      expect(withStatus("owner", "UNCONFIGURED")).not.toContain(item.id);
      expect(withStatus("owner", "ENABLED")).toContain(item.id);
      expect(withStatus("owner", "SANDBOX")).toContain(item.id);
      expect(withStatus("staff", "ENABLED")).not.toContain(item.id);
    }
    expect(ids("owner")).not.toContain("demo-data");
  });

  it("does not list modules FastQue does not have (no inventory, payroll, orders, leave or salary rules)", () => {
    const labels = NAV_ITEMS.map((i) => i.label.toLowerCase()).join(" | ");
    for (const absent of ["inventory", "payroll", "orders", "delivery", "leave", "salary"]) expect(labels).not.toContain(absent);
  });

  it("gives a barber the operational menu only; billing, analytics and settings stay owner-only", () => {
    const staff = navItemsFor("staff").map((i) => i.id);
    for (const id of ["overview", "queue", "in-service", "notifications", "help"]) expect(staff).toContain(id);
    for (const id of ["bookings", "customers", "analytics", "revenue", "payments", "invoices", "settings", "staff", "payment-qr", "cancellations"]) {
      expect(staff).not.toContain(id);
    }
    // Entries that need a server capability are listed only when the shop has it (lib/capabilities.ts).
    expect(navItemsFor("owner").length).toBe(NAV_ITEMS.filter((i) => !i.requiresFeature).length);
  });

  // An owner who clicks a menu entry must stay in the signed-in owner area. /account/* is the CUSTOMER
  // area (gated to customer accounts) and the public site would end up in front of an owner, so the
  // dashboard menu never links to either in the same tab.
  it("never sends an owner into the customer account area, and opens public pages in a new tab", () => {
    for (const item of NAV_ITEMS.filter((i) => i.href)) {
      expect({ id: item.id, intoCustomerArea: item.href.startsWith("/account") }).toEqual({ id: item.id, intoCustomerArea: false });
      expect({ id: item.id, newTab: item.newTab === true }).toEqual({ id: item.id, newTab: true });
    }
    expect(NAV_ITEMS.find((i) => i.id === "account")).toBeUndefined();
  });

  it("the first entry is the dashboard home of the selected shop", () => {
    const home = NAV_ITEMS[0];
    expect(home).toMatchObject({ id: "overview", label: "Dashboard", group: "HOME", path: "" });
    expect(hrefFor(home, "shop-7")).toBe("/dashboard/salons/shop-7");
    expect(NAV_GROUPS[0]).toMatchObject({ id: "HOME", label: "Home" });
  });

  it("puts Analytics in the left navigation, once", () => {
    expect(NAV_ITEMS.filter((i) => i.id === "analytics")).toHaveLength(1);
    expect(NAV_ITEMS.find((i) => i.id === "analytics").group).toBe("BUSINESS");
  });

  it("builds hrefs and tells apart items that share a page by their view/tab", () => {
    const salon = "s1";
    const byId = (id) => NAV_ITEMS.find((i) => i.id === id);
    expect(hrefFor(byId("overview"), salon)).toBe("/dashboard/salons/s1");
    expect(hrefFor(byId("queue"), salon)).toBe("/dashboard/salons/s1/queue?view=waiting");
    expect(hrefFor(byId("help"), salon)).toBe("/contact-us");
    const items = NAV_ITEMS;
    expect(activeItemId("/dashboard/salons/s1", "", salon, items)).toBe("overview");
    expect(activeItemId("/dashboard/salons/s1/queue", "view=in-service", salon, items)).toBe("in-service");
    expect(activeItemId("/dashboard/salons/s1/queue", "view=waiting", salon, items)).toBe("queue");
    expect(activeItemId("/dashboard/salons/s1/queue", "view=history", salon, items)).toBe("queue");
    expect(activeItemId("/dashboard/salons/s1/team", "tab=schedule", salon, items)).toBe("staff-schedule");
    expect(activeItemId("/dashboard/salons/s1/team", "tab=performance", salon, items)).toBe("staff-performance");
    expect(activeItemId("/dashboard/salons/s1/bookings/new", "", salon, items)).toBe("bookings");
    expect(activeItemId("/dashboard/salons/s1/customers/abc", "", salon, items)).toBe("customers");
    expect(activeItemId("/dashboard/salons/other/queue", "", salon, items)).toBeNull();
  });
});
